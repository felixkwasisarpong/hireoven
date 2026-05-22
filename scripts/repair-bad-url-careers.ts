/**
 * Repair careers URLs for companies whose most recent crawl logged
 * status='bad_url' OR a custom-ATS 404. Targeted alternative to the
 * full preview-careers-url-repairs sweep.
 *
 * For each candidate:
 *   1. Run discoverCareersUrl(apex domain).
 *   2. If discovery returns medium/high confidence on a careers-path URL,
 *      update careers_url + reset next_harvest_at so harvester retries soon.
 *   3. If discovery returns nothing usable, mark the company inactive with a
 *      note so the dashboard reflects the dead state.
 *
 * DRY RUN by default; --execute to write.
 *
 *   npx tsx scripts/repair-bad-url-careers.ts
 *   npx tsx scripts/repair-bad-url-careers.ts --execute
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"
import {
  discoverCareersUrl,
  type DiscoveryProbe,
} from "@/lib/companies/careers-url-discovery"
import { detectAtsFromUrl } from "@/lib/companies/detect-ats"

const execute = process.argv.includes("--execute")
const concurrency = Number(process.argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1]) || 8
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"

const CAREERS_PATH_RE =
  /\/(careers?|jobs?|positions?|opportunit|openings?|work-with-us|join(?:-us)?)\b/i

type Row = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  ats_type: string | null
}

async function probe(url: string, timeoutMs = 10000): Promise<{ ok: boolean; status: number | null; html: string | null }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept: "text/html,*/*;q=0.7", "accept-language": "en-US,en;q=0.9" },
    })
    let html: string | null = null
    try { html = await res.text() } catch {}
    return { ok: res.ok, status: res.status, html }
  } catch {
    return { ok: false, status: null, html: null }
  } finally {
    clearTimeout(t)
  }
}

const probeFn: DiscoveryProbe = async ({ url, signal }) => {
  if (signal?.aborted) return { ok: false, status: null, html: null }
  return probe(url)
}

async function runPool<T, R>(items: T[], n: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const queue = [...items]
  const out: R[] = []
  let done = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length) {
        const next = queue.shift()
        if (!next) break
        const r = await worker(next)
        out.push(r)
        done++
        if (done % 10 === 0) console.log(`  resolved ${done}/${items.length}`)
      }
    })
  )
  return out
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  const { rows } = await pool.query<Row>(`
    SELECT DISTINCT c.id, c.name, c.domain, c.careers_url, c.ats_type
    FROM companies c
    JOIN crawl_logs cl ON cl.company_id = c.id
    WHERE c.is_active = true
      AND c.status = 'active'
      AND c.duplicate_of_company_id IS NULL
      AND cl.crawled_at >= now() - interval '3 days'
      AND (cl.status = 'bad_url' OR cl.error_message ILIKE '%not_found_404%' OR cl.error_message ILIKE '%http_404%')
      AND cl.error_message NOT ILIKE 'greenhouse%'
      AND cl.error_message NOT ILIKE 'workday%'
      AND cl.error_message NOT ILIKE 'ashby%'
      AND cl.error_message NOT ILIKE 'lever%'
      AND cl.error_message NOT ILIKE 'icims%'
    ORDER BY c.name
  `)

  console.log(`Candidates: ${rows.length}\n`)

  type Result = { id: string; name: string; domain: string | null; old_url: string | null; new_url: string | null; ats_type: string | null; ats_identifier: string | null; action: "update" | "skip" }
  const results = await runPool<Row, Result>(rows, concurrency, async (r) => {
    if (!r.domain) {
      return { id: r.id, name: r.name, domain: null, old_url: r.careers_url, new_url: null, ats_type: null, ats_identifier: null, action: "skip" }
    }
    const discovered = await discoverCareersUrl({ domain: r.domain, probe: probeFn })
    let acceptable = false
    if (discovered.confidence === "high" || discovered.confidence === "medium") {
      try { acceptable = CAREERS_PATH_RE.test(new URL(discovered.url).pathname) } catch { acceptable = false }
    }
    if (acceptable) {
      const det = detectAtsFromUrl(discovered.url)
      return {
        id: r.id, name: r.name, domain: r.domain,
        old_url: r.careers_url, new_url: discovered.url,
        ats_type: det?.atsType ?? null, ats_identifier: det?.atsIdentifier ?? null,
        action: "update",
      }
    }
    // No-replacement → skip rather than deactivate. The bad_url status already
    // triggers a 30-day cooldown via lib/crawler/scheduling.ts, so these
    // companies naturally back off without losing their entry. Many are
    // bot-blocked rather than truly dead and would deserve a Playwright pass.
    return { id: r.id, name: r.name, domain: r.domain, old_url: r.careers_url, new_url: null, ats_type: null, ats_identifier: null, action: "skip" }
  })

  const byAction = {
    update: results.filter(r => r.action === "update").length,
    skip: results.filter(r => r.action === "skip").length,
  }
  console.log(`\n=== Summary ===`)
  console.log(`  update (discovery found careers URL): ${byAction.update}`)
  console.log(`  skip (left under bad_url cooldown):   ${byAction.skip}`)

  console.log(`\n--- updates ---`)
  for (const r of results.filter(x => x.action === "update")) {
    console.log(`  ${r.name.padEnd(35)} ${r.old_url} → ${r.new_url}`)
  }

  if (!execute) {
    console.log(`\nDry run only. Re-run with --execute to write.`)
    await pool.end()
    return
  }

  let updated = 0
  for (const r of results) {
    if (r.action === "update" && r.new_url) {
      await pool.query(
        `UPDATE companies
         SET careers_url    = $2,
             ats_type       = COALESCE($3, ats_type),
             ats_identifier = COALESCE($4, ats_identifier),
             next_harvest_at = now(),
             updated_at     = now()
         WHERE id = $1`,
        [r.id, r.new_url, r.ats_type, r.ats_identifier]
      )
      updated++
    }
  }
  console.log(`\nDone. Updated ${updated}; ${results.length - updated} left under bad_url cooldown.`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })

/**
 * Read-only measurement for the discover-from-domains pass: over a sample of
 * real-domain, unmatched companies, run domain → careers page → ATS detect →
 * live-job probe and report the funnel. No writes.
 *
 *   npx tsx scripts/measure-domain-ats-resolution.ts            # 30 companies
 *   npx tsx scripts/measure-domain-ats-resolution.ts --n=80 --random
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"
import { discoverCareersUrl, type DiscoveryProbe } from "@/lib/companies/careers-url-discovery"
import { resolveDirectAtsUrl } from "@/lib/companies/ats-url-resolver"

// Node 20.11's bundled undici throws an uncatchable ERR_INVALID_STATE in a
// microtask when some aborted response bodies resume after close. It's benign
// (the fetch already settled) and patched in newer Node; swallow it locally so
// the measurement completes. Does not affect the cron (prod runs patched Node).
process.on("uncaughtException", (e: unknown) => {
  if ((e as { code?: string })?.code === "ERR_INVALID_STATE") return
  throw e
})

const N = (() => {
  const a = process.argv.find((x) => x.startsWith("--n="))
  const n = a ? Number.parseInt(a.split("=")[1] ?? "", 10) : 30
  return Number.isFinite(n) && n > 0 ? n : 30
})()
const RANDOM = process.argv.includes("--random")
const UA = "Mozilla/5.0 (compatible; hireoven-discovery/1.0; +https://hireoven.com)"

async function plainFetchHtml(url: string, timeoutMs = 5_000) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), timeoutMs)
  try {
    const res = await fetch(url, { redirect: "follow", signal: c.signal, headers: { "user-agent": UA, accept: "text/html" } })
    const ct = res.headers.get("content-type") ?? ""
    if (!res.ok || !/text\/html|xml/i.test(ct)) {
      try { await res.body?.cancel() } catch { /* ignore */ }
      return { ok: false, status: res.status, html: null }
    }
    return { ok: true, status: res.status, html: (await res.text()).slice(0, 1_500_000) }
  } catch {
    return { ok: false, status: null, html: null }
  } finally {
    clearTimeout(t)
  }
}

async function main() {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ id: string; name: string; domain: string }>(
    `SELECT id, name, domain FROM companies
      WHERE ats_type IS NULL AND careers_discovery_attempted_at IS NULL
        AND duplicate_of_company_id IS NULL
        AND domain LIKE '%.%' AND domain NOT ILIKE '%.placeholder'
        AND domain NOT ILIKE 'adzuna-%' AND domain NOT ILIKE 'dice-%'
        AND domain NOT ILIKE '%.invalid' AND domain !~* '-discovered$'
        AND domain !~* '\\.(builtin|glassdoor)-discovery$'
      ORDER BY ${RANDOM ? "random()" : "job_count DESC NULLS LAST"}
      LIMIT $1`,
    [N]
  )

  console.log(`sample: ${rows.length} real-domain unmatched companies\n`)
  const counts = { careers: 0, ats: 0, jobs: 0 }
  const hits: string[] = []
  const limit = pLimit(8)

  await Promise.all(
    rows.map((co) =>
      limit(async () => {
        const deadline = AbortSignal.timeout(16_000)
        const probe: DiscoveryProbe = ({ url }) => plainFetchHtml(url)
        const careers = await discoverCareersUrl({ domain: co.domain, probe, maxAttempts: 5, signal: deadline })
        if (careers.confidence === "none" || !careers.url) return
        counts.careers += 1
        const resolved = await resolveDirectAtsUrl(careers.url, { companyName: co.name })
        if (!resolved) return
        const det = detectAdapter(resolved.directUrl)
        if (!det) return
        counts.ats += 1
        let jobCount = 0
        try {
          jobCount = (await det.adapter.fetchJobs({ slug: det.slug, ctx: { etag: null, lastModified: null, timeoutMs: 8_000 } })).jobs.length
        } catch { /* 0 */ }
        if (jobCount === 0) return
        counts.jobs += 1
        hits.push(`  ${co.name.slice(0, 28).padEnd(28)} ${det.adapter.name.padEnd(14)} ${jobCount} jobs  (${co.domain})`)
      })
    )
  )

  const pct = (n: number) => `${((n / rows.length) * 100).toFixed(0)}%`
  console.log(`careers page found : ${counts.careers}/${rows.length}  (${pct(counts.careers)})`)
  console.log(`ATS detected       : ${counts.ats}/${rows.length}  (${pct(counts.ats)})`)
  console.log(`>=1 live job (enroll): ${counts.jobs}/${rows.length}  (${pct(counts.jobs)})  <- real unlock rate\n`)
  if (hits.length) {
    console.log("would-enroll sample:")
    for (const h of hits.slice(0, 25)) console.log(h)
  }
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })

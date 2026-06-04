/**
 * GET /api/cron/careers-url-discovery
 *
 * Finds real career page URLs for companies whose careers_url is a LinkedIn
 * search (useless for crawling) or missing. Probes common career page paths
 * on the company's real domain. When a working URL is found, it's saved so
 * the generic crawler can scrape actual job listings on its next run.
 *
 * Processes a batch per run to stay within timeout limits.
 *
 * Env:
 *   CAREERS_DISCOVERY_BATCH   — companies per run (default: 50)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const maxDuration = 270

const BATCH = Number(process.env.CAREERS_DISCOVERY_BATCH ?? "50")
const PROBE_TIMEOUT_MS = 8_000
const USELESS_URL_RE = /linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|dice\.com/i

// Ordered by likelihood — subdomain patterns first as they're the most common
// for real career sites, then path variants.
function candidateUrls(domain: string): string[] {
  const bare = domain.replace(/^www\./, "")
  return [
    `https://careers.${bare}`,
    `https://jobs.${bare}`,
    `https://www.${bare}/careers`,
    `https://www.${bare}/jobs`,
    `https://${bare}/careers`,
    `https://${bare}/jobs`,
    `https://www.${bare}/careers/jobs`,
    `https://www.${bare}/join-us`,
    `https://www.${bare}/work-with-us`,
    `https://www.${bare}/open-positions`,
    `https://hiring.${bare}`,
    `https://apply.${bare}`,
  ]
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,*/*",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "follow",
    })
    if (!res.ok) return false
    // Make sure the final URL didn't redirect to a useless aggregator
    const finalUrl = res.url ?? url
    if (USELESS_URL_RE.test(finalUrl)) return false
    // Require some HTML content (not an API endpoint returning JSON)
    const ct = res.headers.get("content-type") ?? ""
    return ct.includes("text/html")
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pool = getPostgresPool()

  // Pick companies that have LinkedIn/useless careers_url and a real domain
  const { rows: companies } = await pool.query<{ id: string; name: string; domain: string }>(
    `SELECT id, name, domain
     FROM companies
     WHERE ats_type IS NULL
       AND domain IS NOT NULL
       AND domain NOT LIKE '%.placeholder'
       AND domain NOT LIKE '%-discovered'
       AND domain NOT LIKE '%.ats-placeholder'
       AND domain NOT LIKE '%.builtin-discovery'
       AND status != 'dead'
       AND (
         careers_url LIKE '%linkedin.com%' OR
         careers_url LIKE '%indeed.com%' OR
         careers_url LIKE '%glassdoor.com%' OR
         careers_url IS NULL
       )
       -- Skip recently attempted to avoid hammering the same domains
       AND (careers_discovery_attempted_at IS NULL OR careers_discovery_attempted_at < now() - interval '7 days')
     ORDER BY job_count DESC NULLS LAST
     LIMIT $1`,
    [BATCH]
  )

  const stats = { attempted: 0, found: 0, notFound: 0 }

  for (const company of companies) {
    stats.attempted++
    let found = false

    // Mark attempted regardless of outcome so we don't retry too soon
    await pool.query(
      `UPDATE companies SET careers_discovery_attempted_at = now(), updated_at = now() WHERE id = $1`,
      [company.id]
    )

    for (const candidate of candidateUrls(company.domain)) {
      const ok = await probeUrl(candidate)
      if (!ok) continue

      // Found a working career page — update the company
      await pool.query(
        `UPDATE companies
         SET careers_url = $1,
             crawl_allowed = true,
             updated_at = now()
         WHERE id = $2`,
        [candidate, company.id]
      )

      console.log(`[careers-url-discovery] Found: ${company.name} → ${candidate}`)
      found = true
      stats.found++
      break
    }

    if (!found) stats.notFound++
  }

  return NextResponse.json({ ok: true, ...stats })
}

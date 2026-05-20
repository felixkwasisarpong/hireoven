/**
 * Read-only: peek at the careers_url / direct_ats_url / domain of broken
 * low-job companies so we know whether recovery via resolveDirectAtsUrl
 * has anything to work from.
 *
 *   npx tsx scripts/debug-recovery-sample.ts lever 20
 *   npx tsx scripts/debug-recovery-sample.ts ashby 20
 *   npx tsx scripts/debug-recovery-sample.ts jazzhr 20
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"

async function main() {
  const atsType = process.argv[2]
  const sampleSize = Number.parseInt(process.argv[3] ?? "20", 10)
  if (!atsType) {
    console.error("usage: npx tsx scripts/debug-recovery-sample.ts <ats_type> [N]")
    process.exit(2)
  }

  const pool = getPostgresPool()
  try {
    const { rows } = await pool.query<{
      id: string
      name: string
      ats_type: string
      careers_url: string | null
      direct_ats_url: string | null
      domain: string | null
      last_status: string | null
      last_error: string | null
      active_job_count: number
    }>(
      `WITH base AS (
        SELECT c.id, c.name, c.ats_type, c.careers_url, c.direct_ats_url, c.domain,
               (SELECT count(*)::int FROM jobs j WHERE j.company_id = c.id AND j.is_active = true) AS active_job_count
        FROM companies c
        WHERE c.status = 'active' AND c.is_active = true AND c.duplicate_of_company_id IS NULL
          AND c.ats_type = $1
      ),
      latest_log AS (
        SELECT DISTINCT ON (cl.company_id)
               cl.company_id, cl.status, cl.error_message
        FROM crawl_logs cl
        ORDER BY cl.company_id, cl.crawled_at DESC
      )
      SELECT b.id, b.name, b.ats_type, b.careers_url, b.direct_ats_url, b.domain,
             l.status AS last_status, l.error_message AS last_error,
             b.active_job_count
      FROM base b
      LEFT JOIN latest_log l ON l.company_id = b.id
      WHERE b.active_job_count < 5
      ORDER BY random()
      LIMIT $2`,
      [atsType, sampleSize]
    )

    console.log(`Random sample (${rows.length}) of ${atsType} companies with <5 jobs:\n`)

    // categorize careers_url shape
    const buckets = { directAts: 0, vanity: 0, none: 0 }
    for (const r of rows) {
      const u = (r.careers_url ?? "").toLowerCase()
      if (!u) buckets.none += 1
      else if (
        u.includes("lever.co") || u.includes("greenhouse.io") || u.includes("ashbyhq.com") ||
        u.includes("smartrecruiters.com") || u.includes("workable.com") || u.includes("myworkdayjobs.com") ||
        u.includes("applytojob.com") || u.includes("jobvite.com") || u.includes("teamtailor.com") ||
        u.includes("recruitee.com") || u.includes("personio.com") || u.includes("bamboohr.com") ||
        u.includes("icims.com") || u.includes("successfactors") || u.includes("taleo.net") ||
        u.includes("oraclecloud.com") || u.includes("usajobs.gov") || u.includes("digitalcareers.infosys.com") ||
        u.includes("jobs.apple.com")
      ) buckets.directAts += 1
      else buckets.vanity += 1
    }
    console.log(`URL shapes: directAts=${buckets.directAts}, vanity=${buckets.vanity}, none=${buckets.none}\n`)

    for (const r of rows) {
      const recoveryHint =
        r.domain && r.careers_url && !r.careers_url.includes(r.domain.toLowerCase().replace(/^www\./, ""))
          ? "  ← domain differs from careers_url"
          : ""
      console.log(
        `- ${r.name} | jobs=${r.active_job_count} | last=${r.last_status ?? "—"}${recoveryHint}\n    domain=${r.domain ?? "∅"}\n    careers_url=${r.careers_url ?? "∅"}\n    direct_ats=${r.direct_ats_url ?? "∅"}\n    error=${r.last_error ?? "—"}`
      )
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

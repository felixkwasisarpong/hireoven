import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter, type AtsName } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"

const SUPPORTED_ATS_TYPES = [
  "greenhouse","lever","ashby","smartrecruiters","workable","workday",
  "recruitee","teamtailor","personio","bamboohr","jazzhr","jobvite",
  "icims","successfactors","taleo","oraclecloud","usajobs","infosys","apple",
]

const PEEK_QUERY = `
SELECT id, name, careers_url, direct_ats_url, domain, ats_type, ats_identifier,
       freshness_tier, next_harvest_at
FROM companies
WHERE status = 'active'
  AND is_active = true
  AND duplicate_of_company_id IS NULL
  AND careers_url IS NOT NULL
  AND (
    ats_type = ANY($2::text[])
    OR careers_url ILIKE 'https://boards.greenhouse.io/%'
    OR careers_url ILIKE 'https://job-boards.greenhouse.io/%'
    OR careers_url ILIKE 'https://jobs.lever.co/%'
    OR careers_url ILIKE 'https://jobs.ashbyhq.com/%'
    OR careers_url ILIKE 'https://jobs.smartrecruiters.com/%'
    OR careers_url ILIKE 'https://careers.smartrecruiters.com/%'
    OR careers_url ILIKE 'https://apply.workable.com/%'
    OR careers_url ILIKE 'https://jobs.workable.com/%'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.wd[0-9]{1,3}\\.myworkdayjobs\\.com/'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.recruitee\\.com/'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.teamtailor\\.com/'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.jobs\\.personio\\.(com|de)/'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.bamboohr\\.com/'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.applytojob\\.com/'
    OR careers_url ILIKE 'https://jobs.jobvite.com/%'
    OR careers_url ILIKE 'https://digitalcareers.infosys.com/%'
    OR careers_url ILIKE 'https://jobs.apple.com/%'
  )
  AND (next_harvest_at IS NULL OR next_harvest_at <= now())
ORDER BY next_harvest_at ASC NULLS FIRST
LIMIT $1
`

type Row = {
  id: string
  name: string
  careers_url: string
  direct_ats_url: string | null
  domain: string | null
  ats_type: string | null
  ats_identifier: string | null
  freshness_tier: string | null
  next_harvest_at: Date | null
}

function detectionFor(row: Row): {
  resolvedAdapter: AtsName | null
  reason: string
} {
  const detectionUrl = row.direct_ats_url?.trim() || row.careers_url
  const urlHit = detectAdapter(detectionUrl)
  if (urlHit) return { resolvedAdapter: urlHit.adapter.name, reason: "url" }

  const atsType = row.ats_type?.trim()
  const atsIdentifier = row.ats_identifier?.trim()
  if (!atsType || !atsIdentifier) {
    return {
      resolvedAdapter: null,
      reason: `no_url_match; ats_type=${atsType ?? "∅"}; ats_identifier=${
        atsIdentifier ? "set" : "∅"
      }`,
    }
  }

  const canonical = canonicalCareersUrl(atsType as AtsName, atsIdentifier)
  if (!canonical) {
    return {
      resolvedAdapter: null,
      reason: `no_url_match; canonical_url_failed for ats_type=${atsType}`,
    }
  }
  const canonHit = detectAdapter(canonical)
  if (!canonHit) {
    return {
      resolvedAdapter: null,
      reason: `no_url_match; canonical=${canonical} did not redetect`,
    }
  }
  return { resolvedAdapter: canonHit.adapter.name, reason: "canonical" }
}

async function main() {
  const limit = Number.parseInt(process.argv[2] ?? "200", 10)
  const pool = getPostgresPool()
  try {
    const { rows } = await pool.query<Row>(PEEK_QUERY, [limit, SUPPORTED_ATS_TYPES])
    console.log(`Eligible (peek) rows: ${rows.length}`)

    const matched: Row[] = []
    const mismatched: Array<Row & { mismatchReason: string }> = []
    for (const row of rows) {
      const det = detectionFor(row)
      if (det.resolvedAdapter) matched.push(row)
      else mismatched.push({ ...row, mismatchReason: det.reason })
    }

    console.log(`\n=== Matched: ${matched.length} ===`)
    const matchedByAts = new Map<string, number>()
    for (const r of matched) {
      const key = r.ats_type ?? "(null)"
      matchedByAts.set(key, (matchedByAts.get(key) ?? 0) + 1)
    }
    for (const [k, v] of [...matchedByAts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`)
    }

    console.log(`\n=== Mismatched: ${mismatched.length} ===`)
    const mismatchByAts = new Map<string, number>()
    for (const r of mismatched) {
      const key = r.ats_type ?? "(null)"
      mismatchByAts.set(key, (mismatchByAts.get(key) ?? 0) + 1)
    }
    for (const [k, v] of [...mismatchByAts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`)
    }

    console.log(`\n=== Sample mismatched rows (up to 25) ===`)
    for (const r of mismatched.slice(0, 25)) {
      console.log(
        `- ${r.name} | ats_type=${r.ats_type ?? "∅"} | ats_identifier=${
          r.ats_identifier ?? "∅"
        }\n    careers_url=${r.careers_url}\n    direct_ats_url=${r.direct_ats_url ?? "∅"}\n    reason=${r.mismatchReason}`
      )
    }

    console.log(`\n=== Mismatch reasons (rolled up) ===`)
    const reasonRollup = new Map<string, number>()
    for (const r of mismatched) {
      const rolled = r.mismatchReason
        .replace(/canonical=https?:\/\/[^ ]+/, "canonical=<url>")
      reasonRollup.set(rolled, (reasonRollup.get(rolled) ?? 0) + 1)
    }
    for (const [k, v] of [...reasonRollup.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${v.toString().padStart(4)}  ${k}`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

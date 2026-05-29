/**
 * Backfill logo_url for every active company that's currently NULL/empty.
 *
 * For each company we try a ranked list of candidate brand domains, probe
 * logo.dev for each, and write the first match.
 *
 * Candidate sources (in order):
 *   1. companies.domain itself (if it's already a real-looking domain)
 *   2. Extracted from ATS subdomain patterns:
 *        {tenant}.wdN.myworkdayjobs.com   → {tenant}.com
 *        {tenant}.applytojob.com          → {tenant}.com
 *        {tenant}.greenhouse.io           → {tenant}.com
 *        {tenant}.lever.co                → {tenant}.com
 *        {tenant}.ashbyhq.com             → {tenant}.com
 *        {tenant}.icims.com               → {tenant}.com
 *        {tenant}.smartrecruiters.com     → {tenant}.com
 *        {tenant}.bamboohr.com            → {tenant}.com
 *        {tenant}.rippling.com            → {tenant}.com
 *   3. Extracted from careers_url path for shared ATS hosts:
 *        jobs.lever.co/{tenant}           → {tenant}.com
 *        boards.greenhouse.io/{tenant}    → {tenant}.com
 *        jobs.ashbyhq.com/{tenant}        → {tenant}.com
 *        careers.smartrecruiters.com/{tenant} → {tenant}.com
 *   4. Normalized company name → {normalized}.com (last resort).
 *
 * Usage:
 *   npx tsx scripts/backfill-missing-logos.ts          # executes by default
 *   npx tsx scripts/backfill-missing-logos.ts --dry-run
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"

loadEnvConfig(process.cwd())

import { Pool } from "pg"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1]
const MAX_CANDIDATES_TO_PROBE = limitArg ? Number(limitArg) : Infinity

const TOKEN =
  process.env.LOGO_DEV_TOKEN ||
  process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ||
  ""

if (!TOKEN) {
  console.error("LOGO_DEV_TOKEN not set in env — aborting")
  process.exit(1)
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set in env — aborting")
  process.exit(1)
}

type Row = {
  id: string
  name: string
  domain: string
  careers_url: string | null
  ats_type: string | null
  ats_identifier: string | null
}

function normalizeBrand(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
}

function brandFromDomain(domain: string): string[] {
  const candidates: string[] = []
  const d = domain.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? ""
  if (!d) return candidates

  // 1. {tenant}.wdN.myworkdayjobs.com
  let m: RegExpMatchArray | null = d.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/)
  if (m?.[1]) candidates.push(`${m[1]}.com`)

  // 2. {tenant}.applytojob.com
  m = d.match(/^([a-z0-9-]+)\.applytojob\.com$/)
  if (m?.[1]) candidates.push(`${m[1]}.com`)

  // 3. {tenant}.greenhouse.io  (NOT boards.greenhouse.io — that's a shared host)
  m = d.match(/^([a-z0-9-]+)\.greenhouse\.io$/)
  if (m?.[1] && m[1] !== "boards" && m[1] !== "job-boards") candidates.push(`${m[1]}.com`)

  // 4. {tenant}.lever.co
  m = d.match(/^([a-z0-9-]+)\.lever(?:-jobs)?\.co$/)
  if (m?.[1] && m[1] !== "jobs") candidates.push(`${m[1]}.com`)

  // 5. {tenant}.ashbyhq.com
  m = d.match(/^([a-z0-9-]+)\.ashbyhq\.com$/)
  if (m?.[1] && m[1] !== "jobs") candidates.push(`${m[1]}.com`)

  // 6. {tenant}.icims.com — also handle careers-{brand}.icims.com
  m = d.match(/^(?:careers-)?([a-z0-9-]+)\.icims\.com$/)
  if (m?.[1]) candidates.push(`${m[1]}.com`)

  // 7. {tenant}.smartrecruiters.com
  m = d.match(/^([a-z0-9-]+)\.smartrecruiters\.com$/)
  if (m?.[1] && m[1] !== "careers") candidates.push(`${m[1]}.com`)

  // 8. {tenant}.bamboohr.com
  m = d.match(/^([a-z0-9-]+)\.bamboohr\.com$/)
  if (m?.[1]) candidates.push(`${m[1]}.com`)

  // 9. {tenant}.rippling.com
  m = d.match(/^([a-z0-9-]+)\.rippling\.com$/)
  if (m?.[1] && m[1] !== "ats") candidates.push(`${m[1]}.com`)

  // 10. domain itself, if it doesn't look like an ATS host
  const isAtsHost =
    /(\.myworkdayjobs\.com|\.applytojob\.com|\.greenhouse\.io|\.lever\.co|\.lever-jobs\.com|\.ashbyhq\.com|\.icims\.com|\.smartrecruiters\.com|\.bamboohr\.com|\.rippling\.com)$/.test(d)
  if (!isAtsHost && /\./.test(d)) candidates.push(d)

  return candidates
}

function brandFromCareersUrl(careersUrl: string | null): string[] {
  if (!careersUrl) return []
  const candidates: string[] = []
  let parsed: URL
  try {
    parsed = new URL(careersUrl)
  } catch {
    return candidates
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
  const path = parsed.pathname.replace(/^\/+/, "").split("/")
  const firstSegment = path[0]?.toLowerCase() ?? ""

  // Shared ATS hosts where the brand is in the path
  const sharedAtsPathRe = [
    { host: "jobs.lever.co" },
    { host: "boards.greenhouse.io" },
    { host: "job-boards.greenhouse.io" },
    { host: "jobs.ashbyhq.com" },
    { host: "careers.smartrecruiters.com" },
    { host: "boards.eu.greenhouse.io" },
  ]
  for (const ent of sharedAtsPathRe) {
    if (host === ent.host && firstSegment && /^[a-z0-9-]+$/.test(firstSegment)) {
      candidates.push(`${firstSegment}.com`)
    }
  }

  // Otherwise, if the host looks like the company itself (e.g. careers.acme.com),
  // strip the careers/jobs subdomain.
  if (!sharedAtsPathRe.some((e) => e.host === host)) {
    const stripped = host.replace(/^(careers|jobs|talent|hire|work|join)\./, "")
    if (stripped && stripped !== host && /\./.test(stripped)) {
      candidates.push(stripped)
    } else if (/\./.test(host)) {
      candidates.push(host)
    }
  }

  return candidates
}

function brandFromName(name: string): string[] {
  const stripped = name
    .toLowerCase()
    .replace(/\b(incorporated|inc|l\.?l\.?c\.?|llp|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|solutions|services|systems|us|usa|america|americas|north\s+america)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim()
  if (!stripped || stripped.length < 3) return []
  return [`${stripped}.com`]
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function buildCandidates(row: Row): string[] {
  const all = [
    ...brandFromDomain(row.domain),
    ...brandFromCareersUrl(row.careers_url),
    ...brandFromName(row.name),
  ]
  return dedupe(all).slice(0, MAX_CANDIDATES_TO_PROBE === Infinity ? 5 : MAX_CANDIDATES_TO_PROBE)
}

async function probeLogoDev(domain: string): Promise<boolean> {
  const url = `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(TOKEN)}`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, { method: "GET", signal: ctrl.signal })
    try { await res.arrayBuffer() } catch { /* ignore */ }
    clearTimeout(t)
    return res.status === 200
  } catch {
    return false
  }
}

function logoUrlFor(brand: string): string {
  return `https://img.logo.dev/${encodeURIComponent(brand)}?token=${encodeURIComponent(TOKEN)}&size=256&format=png`
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  const { rows } = await pool.query<Row>(
    `SELECT id, name, domain, careers_url, ats_type, ats_identifier
       FROM companies
      WHERE is_active = true
        AND duplicate_of_company_id IS NULL
        AND (logo_url IS NULL OR logo_url = '')
      ORDER BY job_count DESC NULLS LAST, name`
  )

  console.log(`[backfill-missing-logos] mode=${dryRun ? "dry-run" : "execute"} candidates=${rows.length}`)

  const limiter = pLimit(12)
  let hits = 0
  let fails = 0
  let processed = 0
  const failedSample: string[] = []

  await Promise.all(
    rows.map((row) =>
      limiter(async () => {
        processed += 1
        const candidates = buildCandidates(row)
        let matched: string | null = null
        for (const cand of candidates) {
          if (await probeLogoDev(cand)) {
            matched = cand
            break
          }
        }

        if (!matched) {
          fails += 1
          if (failedSample.length < 20) {
            failedSample.push(`  ${row.name} (${row.domain})  candidates=[${candidates.join(", ")}]`)
          }
          return
        }

        hits += 1
        const url = logoUrlFor(matched)
        if (!dryRun) {
          await pool
            .query(`UPDATE companies SET logo_url = $1, updated_at = now() WHERE id = $2`, [url, row.id])
            .catch((err) => console.warn(`[backfill-missing-logos] update failed for ${row.id}:`, err.message))
        } else if (hits <= 10) {
          console.log(`  would update ${row.name}: ${row.domain} → ${matched}`)
        }

        if (processed % 200 === 0) {
          console.log(`  progress: ${processed}/${rows.length}  hits=${hits}  fails=${fails}`)
        }
      })
    )
  )

  console.log(`\n[backfill-missing-logos] done`)
  console.log(`  processed: ${processed}`)
  console.log(`  hits:      ${hits}`)
  console.log(`  fails:     ${fails}`)
  if (failedSample.length > 0) {
    console.log(`\nFailure sample (first 20):`)
    for (const line of failedSample) console.log(line)
  }
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

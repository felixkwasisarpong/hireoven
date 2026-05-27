/**
 * Enrich companies that have active crawler jobs with no descriptions but
 * ats_type IS NULL. Strategy:
 *
 *   1. URL-detect the ATS from careers_url (free, no HTTP)
 *   2. If that fails, fetch the careers page HTML and signature-detect
 *   3. Set ats_type + ats_identifier on the company and reset next_harvest_at
 *      so the harvester picks it up on the next cycle and produces properly
 *      described jobs
 *
 * The old description-less crawler jobs are then retired in a follow-up pass
 * once the harvester has produced a replacement batch.
 *
 * Usage:
 *   npx tsx scripts/enrich-company-ats-from-url.ts            # dry-run
 *   npx tsx scripts/enrich-company-ats-from-url.ts --execute  # write to DB
 *   npx tsx scripts/enrich-company-ats-from-url.ts --execute --limit=200
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"
import pLimit from "p-limit"
import { detectAtsFromUrl } from "../lib/companies/detect-ats"
import { detectAtsFromHtml } from "../lib/companies/ats-signatures"
import { detectAdapter } from "../lib/harvester/adapters"

const args = process.argv.slice(2)
const EXECUTE = args.includes("--execute")
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity
const CONCURRENCY = 8
const FETCH_TIMEOUT_MS = 10_000

type CompanyRow = {
  id: string
  name: string
  careers_url: string
  no_desc_jobs: number
}

type AtsResult = {
  ats_type: string
  ats_identifier: string | null
  source: "url" | "html" | "apply_url"
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 hireoven-enricher/1.0"

async function fetchHtml(url: string): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,*/*;q=0.7" },
      signal: ctrl.signal,
      redirect: "follow",
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function detectAts(careersUrl: string): Promise<AtsResult | null> {
  // 1. URL detection (instant)
  const fromUrl = detectAtsFromUrl(careersUrl)
  if (fromUrl && fromUrl.confidence !== "low") {
    return { ats_type: fromUrl.atsType, ats_identifier: fromUrl.atsIdentifier ?? null, source: "url" }
  }

  // 2. For workday — also try detectAdapter which uses the harvester's own regex
  const fromAdapter = detectAdapter(careersUrl)
  if (fromAdapter) {
    return { ats_type: fromAdapter.adapter.name, ats_identifier: fromAdapter.slug, source: "url" }
  }

  // 3. HTML fetch + signature scan
  const html = await fetchHtml(careersUrl)
  if (!html) return null
  const fromHtml = detectAtsFromHtml({ url: careersUrl, html })
  if (fromHtml && fromHtml.confidence !== "low") {
    return { ats_type: fromHtml.atsType, ats_identifier: null, source: "html" }
  }

  return null
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! })

  // Companies with active crawler jobs that have no descriptions, unknown ats_type
  const { rows: companies } = await pool.query<CompanyRow>(`
    SELECT
      c.id,
      c.name,
      c.careers_url,
      COUNT(j.id)::int as no_desc_jobs
    FROM companies c
    JOIN jobs j ON j.company_id = c.id
    WHERE c.is_active = true
      AND c.ats_type IS NULL
      AND j.is_active = true
      AND j.source_ats IS NULL
      AND (j.description IS NULL OR j.description = '')
    GROUP BY c.id, c.name, c.careers_url
    HAVING COUNT(j.id) >= 1
    ORDER BY COUNT(j.id) DESC
    LIMIT ${Number.isFinite(LIMIT) ? LIMIT : 99999}
  `)

  console.log(`Found ${companies.length} companies to enrich`)

  const limit = pLimit(CONCURRENCY)
  let detected = 0
  let failed = 0
  let done = 0

  type PlanRow = { company: CompanyRow; result: AtsResult }
  const plan: PlanRow[] = []

  await Promise.all(
    companies.map((company) =>
      limit(async () => {
        const result = await detectAts(company.careers_url)
        done++
        if (done % 50 === 0) process.stderr.write(`  ${done}/${companies.length}\n`)
        if (result) {
          detected++
          plan.push({ company, result })
        } else {
          failed++
        }
      })
    )
  )

  console.log(`\nDetected: ${detected} | Failed: ${failed}`)

  // Summary by ATS type
  const counts: Record<string, number> = {}
  for (const { result } of plan) counts[result.ats_type] = (counts[result.ats_type] ?? 0) + 1
  console.log("By ATS:", counts)

  if (!EXECUTE) {
    console.log("\n--- DRY RUN (first 15) ---")
    for (const { company, result } of plan.slice(0, 15)) {
      console.log(
        `  [${result.ats_type.padEnd(16)}] (${result.source}) ${company.name.padEnd(30)} id=${result.ats_identifier ?? "null"} jobs=${company.no_desc_jobs}`
      )
    }
    console.log("\nRe-run with --execute to write.")
    await pool.end()
    return
  }

  // Write
  let updated = 0
  for (const { company, result } of plan) {
    const res = await pool.query(
      `UPDATE companies
       SET ats_type        = $1,
           ats_identifier  = COALESCE($2, ats_identifier),
           next_harvest_at = NULL
       WHERE id = $3
         AND ats_type IS NULL`,
      [result.ats_type, result.ats_identifier, company.id]
    )
    if (res.rowCount && res.rowCount > 0) updated++
  }

  console.log(`\nUpdated ${updated} companies → ats_type set, next_harvest_at reset.`)
  console.log("Harvester will pick these up on the next cycle and create described jobs.")
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })

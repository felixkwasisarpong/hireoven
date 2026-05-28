/**
 * For each unclassified company with a known domain, probe common career
 * subdomains (careers.*, jobs.*, hiring.*) with a HEAD request and follow
 * redirects. If the final URL matches a known ATS pattern, enroll the company.
 *
 * This catches the very common pattern where a company sets up:
 *   careers.company.com  →  CNAME  →  boards.greenhouse.io/company
 *   jobs.company.com     →  301    →  company.wd5.myworkdayjobs.com/...
 *
 * Usage:
 *   npx tsx scripts/probe-career-subdomains.ts            # dry-run
 *   npx tsx scripts/probe-career-subdomains.ts --execute  # write to DB
 *   npx tsx scripts/probe-career-subdomains.ts --limit=500
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"
import pLimit from "p-limit"
import { detectAdapter } from "../lib/harvester/adapters"
import { canonicalCareersUrl } from "../lib/harvester/canonical-url"
import type { AtsName } from "../lib/harvester/adapters"

const args = process.argv.slice(2)
const EXECUTE = args.includes("--execute")
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity
const CONCURRENCY = 12
const TIMEOUT_MS = 6_000
const UA = "Mozilla/5.0 hireoven-probe/1.0"

const SUBDOMAINS = ["careers", "jobs", "hiring", "job", "career", "work", "apply", "join"]

type CompanyRow = {
  id: string
  name: string
  domain: string
  careers_url: string
}

type ProbeResult = {
  ats_type: string
  ats_identifier: string
  careers_url: string
  matched_url: string
}

async function probeSubdomains(domain: string): Promise<ProbeResult | null> {
  for (const sub of SUBDOMAINS) {
    const url = `https://${sub}.${domain}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "user-agent": UA },
        signal: ctrl.signal,
        redirect: "follow",
      })
      // Check the final URL after redirects
      const finalUrl = res.url || url
      const detection = detectAdapter(finalUrl)
      if (detection) {
        const careers = canonicalCareersUrl(detection.adapter.name as AtsName, detection.slug)
        if (careers) {
          return {
            ats_type: detection.adapter.name,
            ats_identifier: detection.slug,
            careers_url: careers,
            matched_url: finalUrl,
          }
        }
      }
      // Also try the original URL in case no redirect but detectable pattern
      if (finalUrl === url) {
        const detectionOrig = detectAdapter(url)
        if (detectionOrig) {
          const careers = canonicalCareersUrl(detectionOrig.adapter.name as AtsName, detectionOrig.slug)
          if (careers) {
            return {
              ats_type: detectionOrig.adapter.name,
              ats_identifier: detectionOrig.slug,
              careers_url: careers,
              matched_url: url,
            }
          }
        }
      }
    } catch {
      // Subdomain doesn't exist or timed out — try next
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! })

  const { rows: companies } = await pool.query<CompanyRow>(`
    SELECT id, name, domain, careers_url
    FROM companies
    WHERE is_active = true
      AND ats_type IS NULL
      AND domain IS NOT NULL
      AND domain != ''
    ORDER BY name
    LIMIT ${Number.isFinite(LIMIT) ? LIMIT : 99999}
  `)

  console.log(`Probing career subdomains for ${companies.length} unclassified companies...`)
  console.log(`Subdomains tried per company: ${SUBDOMAINS.join(", ")}`)
  console.log(`Concurrency: ${CONCURRENCY}, timeout: ${TIMEOUT_MS}ms\n`)

  const limiter = pLimit(CONCURRENCY)
  type PlanRow = { company: CompanyRow; result: ProbeResult }
  const plan: PlanRow[] = []
  let done = 0
  let failed = 0

  await Promise.all(
    companies.map((company) =>
      limiter(async () => {
        const result = await probeSubdomains(company.domain)
        done++
        if (done % 100 === 0) process.stderr.write(`  ${done}/${companies.length} (found ${plan.length})\n`)
        if (result) {
          plan.push({ company, result })
        } else {
          failed++
        }
      })
    )
  )

  // Summary
  const counts: Record<string, number> = {}
  for (const { result } of plan) counts[result.ats_type] = (counts[result.ats_type] ?? 0) + 1
  console.log(`\nDetected: ${plan.length} | Undetected: ${failed}`)
  console.log("By ATS:", counts)

  if (!EXECUTE) {
    console.log("\n--- DRY RUN (first 20) ---")
    for (const { company, result } of plan.slice(0, 20)) {
      console.log(
        `  [${result.ats_type.padEnd(16)}] ${company.name.padEnd(35)} → ${result.ats_identifier}`
      )
      console.log(`                     via ${result.matched_url}`)
    }
    console.log(`\nRe-run with --execute to write ${plan.length} companies.`)
    await pool.end()
    return
  }

  let updated = 0
  for (const { company, result } of plan) {
    const res = await pool.query(
      `UPDATE companies
       SET ats_type        = $1,
           ats_identifier  = $2,
           careers_url     = $3,
           next_harvest_at = NULL
       WHERE id = $4
         AND ats_type IS NULL`,
      [result.ats_type, result.ats_identifier, result.careers_url, company.id]
    )
    if (res.rowCount && res.rowCount > 0) {
      updated++
      console.log(`  Updated: ${company.name} → ${result.ats_type}:${result.ats_identifier}`)
    }
  }

  console.log(`\nUpdated ${updated} companies. Harvester will pick them up on the next cycle.`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })

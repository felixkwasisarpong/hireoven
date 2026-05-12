/**
 * Nightly company maintenance.
 *
 *   npx tsx scripts/maintain-companies.ts                # dry-run (default)
 *   npx tsx scripts/maintain-companies.ts --execute
 *   npx tsx scripts/maintain-companies.ts --only=tiers
 *   npx tsx scripts/maintain-companies.ts --only=status
 *
 * Two phases:
 *   1. Tier assignment — sets companies.freshness_tier based on observed job
 *      churn + user watchlist.
 *   2. Status lifecycle — marks `active` companies as `dead` after 7+ failed
 *      crawl attempts in 14 days with no success.
 *
 * Both phases are idempotent. Dry-run wraps each statement in BEGIN/ROLLBACK.
 */

import { loadEnvConfig } from "@next/env"
import {
  assignTiers,
  dedupCompanies,
  dedupJobs,
  fuzzyDedupJobs,
  resurrectDeadCompanies,
  updateStatus,
  type CompanyDedupSummary,
  type DedupSummary,
  type FuzzyDedupSummary,
  type ResurrectionSummary,
  type StatusLifecycleSummary,
  type TierAssignmentSummary,
} from "@/lib/harvester/maintenance"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")
const onlyArg = args.find((a) => a.startsWith("--only="))?.split("=")[1]?.toLowerCase()
const onlyPhases = onlyArg
  ? new Set(onlyArg.split(",").map((s) => s.trim()).filter(Boolean))
  : null
const runTiers = !onlyPhases || onlyPhases.has("tiers")
const runStatus = !onlyPhases || onlyPhases.has("status")
const runResurrect = !onlyPhases || onlyPhases.has("resurrect")
const runDedup = !onlyPhases || onlyPhases.has("dedup")
const runFuzzyDedup = !onlyPhases || onlyPhases.has("fuzzy-dedup")
const runCompanyDedup = !onlyPhases || onlyPhases.has("company-dedup")
const fuzzyThresholdArg = args.find((a) => a.startsWith("--fuzzy-threshold="))?.split("=")[1]
const fuzzyThreshold = fuzzyThresholdArg ? Number.parseFloat(fuzzyThresholdArg) : 0.7

async function main() {
  const pool = getPostgresPool()
  console.log(
    `[maintain-companies] mode=${dryRun ? "dry-run" : "execute"} tiers=${runTiers} status=${runStatus} resurrect=${runResurrect} companyDedup=${runCompanyDedup} dedup=${runDedup} fuzzyDedup=${runFuzzyDedup}${runFuzzyDedup ? ` (threshold=${fuzzyThreshold})` : ""}`
  )

  let tierSummary: TierAssignmentSummary | null = null
  let statusSummary: StatusLifecycleSummary | null = null
  let resurrectionSummary: ResurrectionSummary | null = null
  let companyDedupSummary: CompanyDedupSummary | null = null
  let dedupSummary: DedupSummary | null = null
  let fuzzyDedupSummary: FuzzyDedupSummary | null = null

  if (runTiers) {
    const startedAt = Date.now()
    tierSummary = await assignTiers(pool, { dryRun })
    const tierBreakdown = Object.entries(tierSummary.byTier)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tier, count]) => `${tier}=${count}`)
      .join(" ")
    console.log(
      `[maintain-companies] tiers changed=${tierSummary.changed} (${tierBreakdown || "none"}) in ${Date.now() - startedAt}ms${dryRun ? " [rolled back]" : ""}`
    )
  }

  if (runStatus) {
    const startedAt = Date.now()
    statusSummary = await updateStatus(pool, { dryRun })
    console.log(
      `[maintain-companies] status markedDead=${statusSummary.markedDead} in ${Date.now() - startedAt}ms${dryRun ? " [rolled back]" : ""}`
    )
  }

  if (runResurrect) {
    const startedAt = Date.now()
    resurrectionSummary = await resurrectDeadCompanies(pool, { dryRun })
    console.log(
      `[maintain-companies] resurrect resurrected=${resurrectionSummary.resurrected} in ${Date.now() - startedAt}ms${dryRun ? " [rolled back]" : ""}`
    )
  }

  if (runCompanyDedup) {
    const startedAt = Date.now()
    companyDedupSummary = await dedupCompanies(pool, { dryRun })
    console.log(
      `[maintain-companies] company-dedup markedDuplicate=${companyDedupSummary.markedDuplicate} in ${Date.now() - startedAt}ms${dryRun ? " [rolled back]" : ""}`
    )
  }

  if (runDedup) {
    const startedAt = Date.now()
    dedupSummary = await dedupJobs(pool, { dryRun })
    console.log(
      `[maintain-companies] dedup markedDuplicate=${dedupSummary.markedDuplicate} in ${Date.now() - startedAt}ms${dryRun ? " [rolled back]" : ""}`
    )
  }

  if (runFuzzyDedup) {
    const startedAt = Date.now()
    fuzzyDedupSummary = await fuzzyDedupJobs(pool, { dryRun, threshold: fuzzyThreshold })
    console.log(
      `[maintain-companies] fuzzy-dedup markedDuplicate=${fuzzyDedupSummary.markedDuplicate} threshold=${fuzzyDedupSummary.threshold} in ${Date.now() - startedAt}ms${dryRun ? " [rolled back]" : ""}`
    )
  }

  await pool.end()
}

main().catch((error) => {
  console.error("[maintain-companies] fatal:", error)
  process.exit(1)
})

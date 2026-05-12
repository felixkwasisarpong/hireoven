/**
 * Backfill `companies.ats_identifier` with the `{tenant}:{wd}:{site}` triplet
 * the harvester worker needs to claim Workday companies.
 *
 *   npx tsx scripts/backfill-workday-ats-identifier.ts                  # dry-run
 *   npx tsx scripts/backfill-workday-ats-identifier.ts --execute
 *   npx tsx scripts/backfill-workday-ats-identifier.ts --execute --resolve-missing
 *
 * Strategy per company:
 *   1. `detectFromUrl(careers_url)` — works for canonical Workday URLs where
 *      the site is in the path (`{tenant}.wd5.myworkdayjobs.com/External`).
 *   2. If step 1 fails AND `--resolve-missing` is set, call the live
 *      resolver (redirect → sites-api → POST probe) per tenant. Slow.
 *   3. URLs that aren't Workday at all (e.g. `clovis.edu/jobs` mis-tagged) →
 *      flagged with --demote-non-workday to set ats_type = null.
 *
 * The worker's claim filter then picks these up on the next tick.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { workdayAdapter } from "@/lib/harvester/adapters/workday"
import { resolveWorkdaySite } from "@/lib/harvester/discovery/workday-resolver"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")
const resolveMissing = args.includes("--resolve-missing")
const demoteNonWorkday = args.includes("--demote-non-workday")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "1000", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "6", 10))

const WORKDAY_HOST_RE = /^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/i

type CompanyRow = {
  id: string
  name: string
  careers_url: string
  ats_identifier: string | null
}

async function loadCandidates(): Promise<CompanyRow[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<CompanyRow>(
    `SELECT id, name, careers_url, ats_identifier
       FROM companies
      WHERE ats_type = 'workday'
        AND status = 'active'
        AND duplicate_of_company_id IS NULL
        AND careers_url IS NOT NULL
        AND (
          ats_identifier IS NULL
          OR ats_identifier !~ '^[a-zA-Z0-9-]+:wd[0-9]+:[A-Za-z0-9_-]+$'
        )
      ORDER BY updated_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  )
  return rows
}

type ResolveOutcome =
  | { kind: "url"; identifier: string }
  | { kind: "resolved"; identifier: string; source: string }
  | { kind: "not-workday-url"; tenant: null }
  | { kind: "missing-site"; tenant: string; wd: string }
  | { kind: "failed"; reason: string }

async function resolveOne(company: CompanyRow): Promise<ResolveOutcome> {
  const detected = workdayAdapter.detectFromUrl(company.careers_url)
  if (detected) {
    return { kind: "url", identifier: detected.slug }
  }

  // No site in path — see if the URL is at least a Workday host.
  let host: string
  try {
    host = new URL(company.careers_url).hostname.toLowerCase()
  } catch {
    return { kind: "not-workday-url", tenant: null }
  }
  const m = host.match(WORKDAY_HOST_RE)
  if (!m) {
    return { kind: "not-workday-url", tenant: null }
  }
  const tenant = m[1]
  const wd = m[2]

  if (!resolveMissing) {
    return { kind: "missing-site", tenant, wd }
  }

  try {
    const result = await resolveWorkdaySite({ tenant, wd })
    if (!result) return { kind: "failed", reason: "resolver returned null" }
    return { kind: "resolved", identifier: `${tenant}:${wd}:${result.site}`, source: result.source }
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function applyUpdate(companyId: string, identifier: string): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE companies SET ats_identifier = $1, updated_at = now() WHERE id = $2`,
    [identifier, companyId]
  )
}

async function applyDemoteAtsType(companyId: string): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE companies SET ats_type = NULL, updated_at = now() WHERE id = $1`,
    [companyId]
  )
}

async function main() {
  console.log(
    `[backfill-workday] mode=${dryRun ? "dry-run" : "execute"} resolveMissing=${resolveMissing} demoteNonWorkday=${demoteNonWorkday} limit=${limit} concurrency=${concurrency}`
  )

  const candidates = await loadCandidates()
  console.log(`[backfill-workday] loaded ${candidates.length} candidates`)

  let fromUrl = 0
  let resolvedRedirect = 0
  let resolvedSitesApi = 0
  let resolvedProbe = 0
  let missingSite = 0
  let notWorkdayUrl = 0
  let demoted = 0
  let failed = 0
  let updated = 0

  const limiter = pLimit(concurrency)
  await Promise.all(
    candidates.map((company) =>
      limiter(async () => {
        const outcome = await resolveOne(company)
        switch (outcome.kind) {
          case "url":
            fromUrl += 1
            if (!dryRun) await applyUpdate(company.id, outcome.identifier)
            updated += dryRun ? 0 : 1
            break
          case "resolved":
            if (outcome.source === "redirect") resolvedRedirect += 1
            else if (outcome.source === "sites-api") resolvedSitesApi += 1
            else resolvedProbe += 1
            if (!dryRun) await applyUpdate(company.id, outcome.identifier)
            updated += dryRun ? 0 : 1
            break
          case "missing-site":
            missingSite += 1
            break
          case "not-workday-url":
            notWorkdayUrl += 1
            if (demoteNonWorkday && !dryRun) {
              await applyDemoteAtsType(company.id)
              demoted += 1
            }
            break
          case "failed":
            failed += 1
            break
        }
      })
    )
  )

  console.log(
    `[backfill-workday] fromUrl=${fromUrl} resolvedRedirect=${resolvedRedirect} resolvedSitesApi=${resolvedSitesApi} resolvedProbe=${resolvedProbe}`
  )
  console.log(
    `[backfill-workday] missingSite=${missingSite} notWorkdayUrl=${notWorkdayUrl} demoted=${demoted} failed=${failed}`
  )
  console.log(`[backfill-workday] updates ${dryRun ? "would have applied" : "applied"}: ${dryRun ? fromUrl + resolvedRedirect + resolvedSitesApi + resolvedProbe : updated}`)

  await getPostgresPool().end()
}

main().catch((error) => {
  console.error("[backfill-workday] fatal:", error)
  process.exit(1)
})

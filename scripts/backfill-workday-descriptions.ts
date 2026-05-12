/**
 * One-shot backfill: fetch real job descriptions for existing Workday jobs
 * that currently have empty or short descriptions (the listing-only bullet
 * snippets from before the per-job-detail patch).
 *
 *   npx tsx scripts/backfill-workday-descriptions.ts                          # dry-run
 *   npx tsx scripts/backfill-workday-descriptions.ts --execute
 *   npx tsx scripts/backfill-workday-descriptions.ts --execute --limit=5000
 *   npx tsx scripts/backfill-workday-descriptions.ts --execute --min-length=300
 *
 * For each Workday job with `length(description) < min-length`:
 *   1. Derive the {tenant}:{wd}:{site} triplet from the company's careers_url
 *   2. Extract the `externalPath` from the job's apply_url
 *   3. GET the per-job detail endpoint
 *   4. UPDATE description + content_hash
 *
 * Use --limit to bound a single run; idempotent — re-runs only touch jobs
 * still under the min-length threshold.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { workdayAdapter, fetchWorkdayJobDetail } from "@/lib/harvester/adapters/workday"
import { hashContent } from "@/lib/harvester/adapters/_base"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "1000", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "6", 10))
const minLength = Math.max(0, Number.parseInt(getArg("--min-length=") ?? "300", 10))

const WORKDAY_HOST_RE = /^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/i

type CandidateRow = {
  job_id: string
  job_title: string
  job_apply_url: string
  job_location: string | null
  job_posted_at: string | null
  job_description: string | null
  company_careers_url: string
  company_ats_identifier: string | null
}

async function loadCandidates(): Promise<CandidateRow[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<CandidateRow>(
    `SELECT j.id          AS job_id,
            j.title       AS job_title,
            j.apply_url   AS job_apply_url,
            j.location    AS job_location,
            j.posted_at   AS job_posted_at,
            j.description AS job_description,
            c.careers_url AS company_careers_url,
            c.ats_identifier AS company_ats_identifier
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
      WHERE j.source_ats = 'workday'
        AND j.is_active = true
        AND j.closed_at IS NULL
        AND (j.description IS NULL OR length(j.description) < $2)
        AND c.careers_url IS NOT NULL
      ORDER BY j.first_detected_at DESC NULLS LAST
      LIMIT $1`,
    [limit, minLength]
  )
  return rows
}

/**
 * Parse the company row to a Workday ParsedSlug. Prefers the canonical
 * ats_identifier triplet (set by backfill-workday-ats-identifier.ts); falls
 * back to detecting from careers_url.
 */
function parseCompanySlug(row: CandidateRow): { tenant: string; wd: string; site: string } | null {
  const ident = row.company_ats_identifier?.trim() ?? ""
  if (ident && /^[a-zA-Z0-9-]+:wd[0-9]+:[A-Za-z0-9_-]+$/.test(ident)) {
    const [tenant, wd, site] = ident.split(":")
    return { tenant, wd, site }
  }
  // Fall back to URL parsing.
  const detected = workdayAdapter.detectFromUrl(row.company_careers_url)
  if (detected) {
    const [tenant, wd, site] = detected.slug.split(":")
    return { tenant, wd, site }
  }
  return null
}

/**
 * Extract the Workday `externalPath` from a job apply URL of the form
 *   https://{tenant}.{wd}.myworkdayjobs.com/{locale}/{site}/job/Location/Title_R12345
 * The externalPath is `/job/Location/Title_R12345`.
 */
function extractExternalPath(applyUrl: string, parsed: { tenant: string; wd: string; site: string }): string | null {
  let u: URL
  try {
    u = new URL(applyUrl)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  const m = host.match(WORKDAY_HOST_RE)
  if (!m) return null
  // Pathname: /{locale}?/{site}/{externalPath...}
  const parts = u.pathname.split("/").filter(Boolean)
  // Find the index of the site segment
  const siteIdx = parts.findIndex(
    (p) => p.toLowerCase() === parsed.site.toLowerCase()
  )
  if (siteIdx < 0 || siteIdx >= parts.length - 1) return null
  return "/" + parts.slice(siteIdx + 1).join("/")
}

async function main() {
  console.log(
    `[backfill-workday-descriptions] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} concurrency=${concurrency} min-length=${minLength}`
  )

  const candidates = await loadCandidates()
  console.log(`[backfill-workday-descriptions] loaded ${candidates.length} candidates`)

  let enriched = 0
  let skippedNoSlug = 0
  let skippedNoExternalPath = 0
  let fetchFailed = 0
  let unchanged = 0
  let updated = 0

  const limiter = pLimit(concurrency)
  const pool = getPostgresPool()

  await Promise.all(
    candidates.map((row) =>
      limiter(async () => {
        const slug = parseCompanySlug(row)
        if (!slug) {
          skippedNoSlug += 1
          return
        }
        const externalPath = extractExternalPath(row.job_apply_url, slug)
        if (!externalPath) {
          skippedNoExternalPath += 1
          return
        }
        const detail = await fetchWorkdayJobDetail(slug, externalPath, {
          etag: null,
          lastModified: null,
        })
        if (!detail) {
          fetchFailed += 1
          return
        }
        // Only update if we got a meaningfully-longer description.
        const newDescription = detail.description
        if (!newDescription || newDescription.length <= (row.job_description?.length ?? 0)) {
          unchanged += 1
          return
        }
        enriched += 1

        if (dryRun) return

        const newLocation = row.job_location ?? detail.location ?? null
        const contentHash = hashContent([
          row.job_title,
          row.job_apply_url,
          newLocation,
          row.job_posted_at,
          newDescription.slice(0, 4_000),
        ])
        await pool.query(
          `UPDATE jobs
              SET description = $2,
                  location = COALESCE(location, $3),
                  content_hash = decode($4, 'hex'),
                  updated_at = now()
            WHERE id = $1`,
          [row.job_id, newDescription, newLocation, contentHash]
        )
        updated += 1
      })
    )
  )

  console.log(
    `[backfill-workday-descriptions] enriched=${enriched} updated=${updated} unchanged=${unchanged} fetchFailed=${fetchFailed} skippedNoSlug=${skippedNoSlug} skippedNoExternalPath=${skippedNoExternalPath}`
  )
  await pool.end()
}

main().catch((error) => {
  console.error("[backfill-workday-descriptions] fatal:", error)
  process.exit(1)
})

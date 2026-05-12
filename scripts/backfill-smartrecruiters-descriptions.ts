/**
 * One-shot backfill: fetch real job descriptions for existing SmartRecruiters
 * jobs whose `description` column is empty or short. SR's list endpoint
 * doesn't include `jobAd.sections.*` — descriptions only come from the
 * per-posting detail endpoint, so legacy jobs harvested before this fix
 * are listing-only.
 *
 *   npx tsx scripts/backfill-smartrecruiters-descriptions.ts                       # dry-run
 *   npx tsx scripts/backfill-smartrecruiters-descriptions.ts --execute
 *   npx tsx scripts/backfill-smartrecruiters-descriptions.ts --execute --limit=5000
 *   npx tsx scripts/backfill-smartrecruiters-descriptions.ts --execute --min-length=300
 *
 * Idempotent — re-runs only touch jobs still under the min-length threshold.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { hashContent, conditionalFetchJson } from "@/lib/harvester/adapters/_base"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "1000", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "4", 10))
const minLength = Math.max(0, Number.parseInt(getArg("--min-length=") ?? "300", 10))

type CandidateRow = {
  job_id: string
  job_title: string
  job_apply_url: string
  job_location: string | null
  job_posted_at: string | null
  job_description: string | null
  job_external_id: string
  company_ats_identifier: string | null
}

type SRSection = { text?: string }
type SRDetail = {
  jobAd?: {
    sections?: {
      companyDescription?: SRSection
      jobDescription?: SRSection
      qualifications?: SRSection
      additionalInformation?: SRSection
    }
  }
}

function buildDescription(detail: SRDetail): string | undefined {
  const s = detail.jobAd?.sections
  if (!s) return undefined
  const segments = [
    s.companyDescription?.text,
    s.jobDescription?.text,
    s.qualifications?.text,
    s.additionalInformation?.text,
  ]
    .map((t) => t?.trim())
    .filter((t): t is string => Boolean(t))
  return segments.length ? segments.join("\n\n") : undefined
}

/**
 * The harvester's externalId is `smartrecruiters:<postingId>`. Most companies
 * also have a stable slug column. We need both: the slug to build the detail
 * URL, and the postingId to fetch the specific job.
 *
 * We derive the slug from the company's ats_identifier (set when known) or
 * fall back to parsing the apply_url path.
 */
function parsePostingFromExternalId(externalId: string): string | null {
  const m = externalId.match(/^smartrecruiters:(.+)$/)
  return m ? m[1] : null
}

function parseSlugFromApplyUrl(applyUrl: string): string | null {
  try {
    const u = new URL(applyUrl)
    const parts = u.pathname.split("/").filter(Boolean)
    return parts[0] || null
  } catch {
    return null
  }
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
            j.external_id AS job_external_id,
            c.ats_identifier AS company_ats_identifier
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
      WHERE j.source_ats = 'smartrecruiters'
        AND j.is_active = true
        AND j.closed_at IS NULL
        AND (j.description IS NULL OR length(j.description) < $2)
      ORDER BY j.first_detected_at DESC NULLS LAST
      LIMIT $1`,
    [limit, minLength]
  )
  return rows
}

async function main() {
  console.log(
    `[backfill-sr-descriptions] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} concurrency=${concurrency} min-length=${minLength}`
  )

  const candidates = await loadCandidates()
  console.log(`[backfill-sr-descriptions] loaded ${candidates.length} candidates`)

  let enriched = 0
  let skippedNoSlug = 0
  let skippedNoPostingId = 0
  let fetchFailed = 0
  let unchanged = 0
  let updated = 0

  const limiter = pLimit(concurrency)
  const pool = getPostgresPool()

  await Promise.all(
    candidates.map((row) =>
      limiter(async () => {
        const slug =
          row.company_ats_identifier?.trim() || parseSlugFromApplyUrl(row.job_apply_url)
        if (!slug) {
          skippedNoSlug += 1
          return
        }
        const postingId = parsePostingFromExternalId(row.job_external_id)
        if (!postingId) {
          skippedNoPostingId += 1
          return
        }

        const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings/${encodeURIComponent(postingId)}`
        const result = await conditionalFetchJson<SRDetail>(url, {
          etag: null,
          lastModified: null,
        })
        if (result.kind !== "ok" || !result.data) {
          fetchFailed += 1
          return
        }

        const newDescription = buildDescription(result.data)
        if (!newDescription || newDescription.length <= (row.job_description?.length ?? 0)) {
          unchanged += 1
          return
        }
        enriched += 1
        if (dryRun) return

        const contentHash = hashContent([
          row.job_title,
          row.job_apply_url,
          row.job_location,
          row.job_posted_at,
          newDescription.slice(0, 4_000),
        ])
        await pool.query(
          `UPDATE jobs
              SET description = $2,
                  content_hash = decode($3, 'hex'),
                  updated_at = now()
            WHERE id = $1`,
          [row.job_id, newDescription, contentHash]
        )
        updated += 1
      })
    )
  )

  console.log(
    `[backfill-sr-descriptions] enriched=${enriched} updated=${updated} unchanged=${unchanged} fetchFailed=${fetchFailed} skippedNoSlug=${skippedNoSlug} skippedNoPostingId=${skippedNoPostingId}`
  )
  await pool.end()
}

main().catch((error) => {
  console.error("[backfill-sr-descriptions] fatal:", error)
  process.exit(1)
})

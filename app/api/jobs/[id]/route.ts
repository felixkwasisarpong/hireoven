import { NextRequest, NextResponse } from "next/server"
import {
  cleanJobDescription,
  fetchJobDescription,
  normalizeJobApplyUrl,
} from "@/lib/jobs/description"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import type { JobWithCompany } from "@/types"

// The harvester persists jobs as soon as they appear in an ATS listing, but
// detail-fetch adapters (Rippling, iCIMS, Apple, Workday, …) have per-cycle
// caps, so a job can reach the feed before its description is backfilled. Users
// are always in the app, so we enrich on first open: if the stored description
// is missing/too-short, fetch it live, persist it back (next open is instant),
// and return the enriched job. The harvester itself is left untouched/fast.
const ENRICH_TIMEOUT_MS = 12_000

// Don't re-fetch a source we just tried. A permanently unreachable apply URL
// would otherwise block every viewer for the full timeout on each open.
const ENRICH_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000

function rawObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {}
}

function recentlyAttempted(job: JobWithCompany): boolean {
  const at = rawObject(job.raw_data)["description_fetch_attempted_at"]
  if (typeof at !== "string") return false
  const ts = Date.parse(at)
  return Number.isFinite(ts) && Date.now() - ts < ENRICH_RETRY_COOLDOWN_MS
}

async function enrichDescription(
  pool: ReturnType<typeof getPostgresPool>,
  job: JobWithCompany
): Promise<JobWithCompany> {
  if (cleanJobDescription(job.description)) return job
  if (!job.apply_url || recentlyAttempted(job)) return job

  const normalizedUrl = normalizeJobApplyUrl(job.apply_url)
  let extracted: string | null = null
  try {
    extracted = await fetchJobDescription(normalizedUrl, ENRICH_TIMEOUT_MS)
  } catch {
    extracted = null
  }

  const nextRaw = rawObject(job.raw_data)
  const nowIso = new Date().toISOString()
  nextRaw.description_fetch_attempted_at = nowIso

  if (!extracted) {
    // Record the attempt so we don't re-block the next viewer on a dead source.
    await pool
      .query(`UPDATE jobs SET raw_data = $2 WHERE id = $1`, [job.id, nextRaw])
      .catch(() => {})
    return job
  }

  nextRaw.description_source = "scraped_apply_url"
  nextRaw.description_backfilled_at = nowIso

  await pool
    .query(
      `UPDATE jobs
         SET description = $2,
             apply_url = $3,
             raw_data = $4,
             updated_at = now()
       WHERE id = $1`,
      [job.id, extracted, normalizedUrl, nextRaw]
    )
    .catch(() => {})

  return { ...job, description: extracted, apply_url: normalizedUrl, raw_data: nextRaw }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const pool = getPostgresPool()

  const result = await pool.query<JobWithCompany>(
    `SELECT j.*, to_jsonb(c.*) AS company
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.id = $1 AND ${sqlJobLocatedInUsa("j")}
     LIMIT 1`,
    [id]
  )

  const job = result.rows[0] ?? null
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const enriched = await enrichDescription(pool, job)

  return NextResponse.json({ job: enriched })
}

/**
 * POST /api/apex/jobs/ingest
 *
 * Aggregator-side job ingestion endpoint used by the LinkedIn / Glassdoor /
 * Indeed / Handshake content scripts via the background dispatcher.
 *
 * Per-source dedupe (brief Step 10):
 *   linkedin  — match (company_id, apexSource='linkedin', apexSourceId);
 *               fallback (company_id, normalized_title, posted_at::date)
 *   glassdoor — match (company_id, apexSource='glassdoor', apexSourceId);
 *               cross-source: if (company_id, normalized_title, normalized_city)
 *               match within 14 days, attach Glassdoor as secondary source.
 *   indeed    — strictest: match (company_id, normalized_title,
 *               normalized_location_city); keep earliest posted_at.
 *   handshake — match (company_id, apexSource='handshake', apexSourceId);
 *               preserve metadata.deadline through dedupe.
 *
 * Auth: Bearer JWT (same as other extension routes).
 *
 * NOTE: apexSource / apexSourceId / apexSources are stored in jobs.raw_data
 * for now to avoid a schema migration. A follow-up should promote these to
 * indexed columns.
 */

import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  type AggregatorSource,
  GLASSDOOR_CROSS_SOURCE_WINDOW_MS,
  normalizeLocationCity,
  normalizeTitle,
  postedAtDay,
} from "@/lib/apex/aggregator-dedupe"
import {
  extensionCorsHeaders,
  extensionError,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import { publicationStatusForJob } from "@/lib/jobs/publication"

export const runtime = "nodejs"

// ── Request shape ────────────────────────────────────────────────────────────

interface ScrapedJob {
  site: AggregatorSource
  sourceId: string
  title: string
  company: string
  companyUrl?: string
  location: string
  workMode?: "remote" | "hybrid" | "onsite"
  employmentType?: string
  postedAt: string
  postedAtPrecision: "exact" | "day" | "bucket"
  description: string
  salary?: string
  salaryConfirmed?: boolean
  applyMode: { kind: string; driver?: string; destinationGuess?: string }
  metadata: Record<string, unknown>
}

interface IngestBody {
  source: AggregatorSource
  job: ScrapedJob
  /** Optional: 'express_interest' for Handshake express-interest pills. */
  applyMethod?: string
}

interface IngestResult {
  jobId: string
  created: boolean
  attachedAsSecondarySource?: boolean
  matchedBy: string
}

// ── Route handlers ───────────────────────────────────────────────────────────

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function POST(request: Request) {
  const corsHeaders = extensionCorsHeaders(request.headers.get("origin"))

  const [user, authError] = await requireExtensionAuth(request)
  if (authError) return authError
  void user // ingest is user-scoped only via session; rows are global jobs.

  const [body, bodyError] = await readExtensionJsonBody<IngestBody>(request)
  if (bodyError) return bodyError

  const job = body.job
  if (!job?.title || !job?.company || !job?.sourceId) {
    return extensionError(request, 400, "title, company, and sourceId are required", { headers: corsHeaders })
  }

  const pool = getPostgresPool()

  // ── Resolve company ────────────────────────────────────────────────────────
  const companyId = await resolveCompanyId(pool, job.company)
  if (!companyId) {
    return extensionError(request, 500, "company resolution failed", { headers: corsHeaders })
  }

  // ── Per-source dedupe ──────────────────────────────────────────────────────
  const dedupe = await dedupeJob(pool, companyId, job)

  if (dedupe.kind === "exact_match") {
    const touched = await touchJob(pool, dedupe.jobId, job, body.applyMethod)
    if (!touched) {
      return extensionError(request, 500, "job update failed", { headers: corsHeaders })
    }
    return NextResponse.json<IngestResult>({
      jobId: dedupe.jobId,
      created: false,
      matchedBy: dedupe.matchedBy,
    }, { headers: corsHeaders })
  }

  if (dedupe.kind === "attach_secondary_source") {
    const attached = await attachSecondarySource(pool, dedupe.jobId, job)
    if (!attached) {
      return extensionError(request, 500, "secondary source attach failed", { headers: corsHeaders })
    }
    return NextResponse.json<IngestResult>({
      jobId: dedupe.jobId,
      created: false,
      attachedAsSecondarySource: true,
      matchedBy: dedupe.matchedBy,
    }, { headers: corsHeaders })
  }

  // ── No match → insert new job ──────────────────────────────────────────────
  const jobId = await insertJob(pool, companyId, job, body.applyMethod)
  if (!jobId) {
    return extensionError(request, 500, "job insert failed", { headers: corsHeaders })
  }
  return NextResponse.json<IngestResult>(
    { jobId, created: true, matchedBy: "none" },
    { status: 201, headers: corsHeaders },
  )
}

// ── Company resolution (mirrors /api/extension/jobs/save pattern) ───────────

async function resolveCompanyId(
  pool: ReturnType<typeof getPostgresPool>,
  companyName: string,
): Promise<string | null> {
  const existing = await pool
    .query<{ id: string }>(
      `SELECT id FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [companyName],
    )
    .catch(() => null)
  if (existing?.rows[0]) return existing.rows[0].id

  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  const placeholderDomain = `${slug || "unknown"}.apex-aggregator-placeholder`

  const created = await pool
    .query<{ id: string }>(
      `INSERT INTO companies (name, is_active, ats_type, domain)
       VALUES ($1, true, $2, $3)
       RETURNING id`,
      [companyName, "generic", placeholderDomain],
    )
    .catch(() => null)
  return created?.rows[0]?.id ?? null
}

// ── Dedupe routing ──────────────────────────────────────────────────────────

type DedupeOutcome =
  | { kind: "no_match" }
  | { kind: "exact_match"; jobId: string; matchedBy: string }
  | { kind: "attach_secondary_source"; jobId: string; matchedBy: string }

async function dedupeJob(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  job: ScrapedJob,
): Promise<DedupeOutcome> {
  switch (job.site) {
    case "linkedin":   return await dedupeLinkedIn(pool, companyId, job)
    case "glassdoor":  return await dedupeGlassdoor(pool, companyId, job)
    case "indeed":     return await dedupeIndeed(pool, companyId, job)
    case "handshake":  return await dedupeHandshake(pool, companyId, job)
  }
}

async function dedupeLinkedIn(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  job: ScrapedJob,
): Promise<DedupeOutcome> {
  const exact = await findBySourceId(pool, companyId, "linkedin", job.sourceId)
  if (exact) return { kind: "exact_match", jobId: exact, matchedBy: "linkedin:source_id" }

  const day = postedAtDay(job.postedAt)
  if (day) {
    const fallback = await pool
      .query<{ id: string }>(
        `SELECT id FROM jobs
         WHERE company_id = $1::uuid
           AND normalized_title = $2
           AND posted_at::date = $3::date
         LIMIT 1`,
        [companyId, normalizeTitle(job.title), day],
      )
      .catch(() => null)
    if (fallback?.rows[0]) {
      return { kind: "exact_match", jobId: fallback.rows[0].id, matchedBy: "linkedin:title+day" }
    }
  }
  return { kind: "no_match" }
}

async function dedupeGlassdoor(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  job: ScrapedJob,
): Promise<DedupeOutcome> {
  const exact = await findBySourceId(pool, companyId, "glassdoor", job.sourceId)
  if (exact) return { kind: "exact_match", jobId: exact, matchedBy: "glassdoor:source_id" }

  // Cross-source: same company + normalized title + normalized city, posted within 14 days.
  const cutoff = new Date(Date.now() - GLASSDOOR_CROSS_SOURCE_WINDOW_MS).toISOString()
  const cross = await pool
    .query<{ id: string }>(
      `SELECT id FROM jobs
       WHERE company_id = $1::uuid
         AND normalized_title = $2
         AND LOWER(COALESCE(location, '')) ILIKE $3
         AND COALESCE(posted_at, first_detected_at) >= $4::timestamptz
       ORDER BY posted_at NULLS LAST
       LIMIT 1`,
      [companyId, normalizeTitle(job.title), `%${normalizeLocationCity(job.location)}%`, cutoff],
    )
    .catch(() => null)
  if (cross?.rows[0]) {
    return { kind: "attach_secondary_source", jobId: cross.rows[0].id, matchedBy: "glassdoor:cross_source" }
  }
  return { kind: "no_match" }
}

async function dedupeIndeed(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  job: ScrapedJob,
): Promise<DedupeOutcome> {
  // Strictest: normalized title + city only. Collapses reposts and same-role-multiple-cities.
  const match = await pool
    .query<{ id: string; posted_at: Date | null }>(
      `SELECT id, posted_at FROM jobs
       WHERE company_id = $1::uuid
         AND normalized_title = $2
         AND LOWER(COALESCE(location, '')) ILIKE $3
       ORDER BY posted_at NULLS LAST
       LIMIT 1`,
      [companyId, normalizeTitle(job.title), `%${normalizeLocationCity(job.location)}%`],
    )
    .catch(() => null)
  if (match?.rows[0]) {
    return { kind: "exact_match", jobId: match.rows[0].id, matchedBy: "indeed:title+city" }
  }
  return { kind: "no_match" }
}

async function dedupeHandshake(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  job: ScrapedJob,
): Promise<DedupeOutcome> {
  const exact = await findBySourceId(pool, companyId, "handshake", job.sourceId)
  if (exact) return { kind: "exact_match", jobId: exact, matchedBy: "handshake:source_id" }
  return { kind: "no_match" }
}

async function findBySourceId(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  source: AggregatorSource,
  sourceId: string,
): Promise<string | null> {
  const q = await pool
    .query<{ id: string }>(
      `SELECT id FROM jobs
       WHERE company_id = $1::uuid
         AND raw_data->>'apexSource' = $2
         AND raw_data->>'apexSourceId' = $3
       LIMIT 1`,
      [companyId, source, sourceId],
    )
    .catch(() => null)
  return q?.rows[0]?.id ?? null
}

// ── Insert / update ─────────────────────────────────────────────────────────

async function insertJob(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  job: ScrapedJob,
  applyMethod: string | undefined,
): Promise<string | null> {
  const isRemote = job.workMode === "remote"
  const isHybrid = job.workMode === "hybrid"
  const applyUrl = canonicalApplyUrl(job)
  const rawData = {
    captureSource: "apex-aggregator",
    captureAdapter: job.site,
    apexSource: job.site,
    apexSourceId: job.sourceId,
    apexSources: [{ source: job.site, sourceId: job.sourceId }],
    postedAt: job.postedAt,
    postedAtPrecision: job.postedAtPrecision,
    salaryText: job.salary ?? null,
    salaryConfirmed: job.salaryConfirmed ?? null,
    employmentType: job.employmentType ?? null,
    workMode: job.workMode ?? null,
    applyMode: job.applyMode,
    applyMethod: applyMethod ?? null,
    metadata: job.metadata,
  }
  const publicationStatus = publicationStatusForJob({
    description: job.description,
    skills: [],
  })
  const inserted = await pool
    .query<{ id: string }>(
      `INSERT INTO jobs (
         company_id, title, normalized_title, location, description,
         apply_url, external_id,
         is_remote, is_hybrid, is_active,
         employment_type,
         publication_status, raw_data, posted_at,
         first_detected_at, last_seen_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7,
         $8, $9, true,
         $10,
         $11, $12::jsonb, $13::timestamptz,
         NOW(), NOW()
       )
       RETURNING id`,
      [
        companyId,
        job.title,
        normalizeTitle(job.title),
        job.location || null,
        job.description || null,
        applyUrl,
        job.sourceId,
        isRemote,
        isHybrid,
        job.employmentType || null,
        publicationStatus,
        JSON.stringify(rawData),
        job.postedAt,
      ],
    )
    .catch(() => null)
  return inserted?.rows[0]?.id ?? null
}

/**
 * Construct a canonical apply URL from site + sourceId. The handlers don't
 * forward window.location.href explicitly, so we synthesize the standard view
 * URL each site uses. This is what gets stored as jobs.apply_url (NOT NULL).
 */
function canonicalApplyUrl(job: ScrapedJob): string {
  switch (job.site) {
    case "linkedin":
      return `https://www.linkedin.com/jobs/view/${job.sourceId}/`
    case "indeed":
      return `https://www.indeed.com/viewjob?jk=${encodeURIComponent(job.sourceId)}`
    case "glassdoor":
      return `https://www.glassdoor.com/job-listing/JV_${encodeURIComponent(job.sourceId)}.htm`
    case "handshake":
      return `https://app.joinhandshake.com/jobs/${encodeURIComponent(job.sourceId)}`
  }
}

/**
 * Bump last_seen_at + merge any new metadata. Critically for Handshake:
 * preserve metadata.deadline if it was on the original record.
 */
async function touchJob(
  pool: ReturnType<typeof getPostgresPool>,
  jobId: string,
  job: ScrapedJob,
  applyMethod: string | undefined,
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    postedAt: job.postedAt,
    postedAtPrecision: job.postedAtPrecision,
  }
  if (applyMethod) patch.applyMethod = applyMethod

  // Indeed brief: keep earliest posted_at. We update raw_data.postedAt with the
  // newer value but the canonical posted_at column uses LEAST() so the earliest
  // wins.
  const earliest = job.site === "indeed" ? "LEAST(jobs.posted_at, $3::timestamptz)" : "$3::timestamptz"

  // Handshake brief: never lose metadata.deadline. Preserve it explicitly.
  const deadlinePatch =
    job.site === "handshake" && job.metadata?.deadline
      ? `, raw_data = raw_data || jsonb_build_object('metadata', COALESCE(raw_data->'metadata', '{}'::jsonb) || jsonb_build_object('deadline', $6::text))`
      : ""

  const params: unknown[] = [
    jobId,
    JSON.stringify(patch),
    job.postedAt,
    job.description || null,
    publicationStatusForJob({ description: job.description, skills: [] }),
  ]
  if (deadlinePatch) params.push(String(job.metadata.deadline))

  try {
    const result = await pool.query(
      `UPDATE jobs
       SET raw_data = COALESCE(raw_data, '{}'::jsonb) || $2::jsonb,
           posted_at = COALESCE(${earliest}, posted_at),
           description = CASE
             WHEN lower(coalesce(trim(description), '')) IN ('', 'no job found', 'no job found.')
             THEN COALESCE(NULLIF(trim($4), ''), description)
             ELSE description
           END,
           publication_status = CASE
             WHEN $5 = 'published' THEN 'published'
             ELSE publication_status
           END,
           last_seen_at = NOW(),
           updated_at = NOW()${deadlinePatch}
       WHERE id = $1::uuid`,
      params,
    )
    return (result.rowCount ?? 0) > 0
  } catch (error) {
    console.error("[apex/jobs/ingest] touchJob failed", {
      jobId,
      site: job.site,
      sourceId: job.sourceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Glassdoor cross-source attach: keep the existing job row, append Glassdoor
 * to raw_data.apexSources without changing the primary apexSource.
 */
async function attachSecondarySource(
  pool: ReturnType<typeof getPostgresPool>,
  jobId: string,
  job: ScrapedJob,
): Promise<boolean> {
  const newEntry = JSON.stringify({ source: job.site, sourceId: job.sourceId })
  try {
    const result = await pool.query(
      `UPDATE jobs
       SET raw_data = jsonb_set(
             COALESCE(raw_data, '{}'::jsonb),
             '{apexSources}',
             COALESCE(raw_data->'apexSources', '[]'::jsonb) || $2::jsonb,
             true
           ),
           last_seen_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::uuid`,
      [jobId, newEntry],
    )
    return (result.rowCount ?? 0) > 0
  } catch (error) {
    console.error("[apex/jobs/ingest] attachSecondarySource failed", {
      jobId,
      site: job.site,
      sourceId: job.sourceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

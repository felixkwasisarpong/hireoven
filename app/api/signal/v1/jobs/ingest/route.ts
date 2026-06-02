import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  type AggregatorSource,
  GLASSDOOR_CROSS_SOURCE_WINDOW_MS,
  normalizeLocationCity,
  normalizeTitle,
  postedAtDay,
} from "@/lib/apex/aggregator-dedupe"
import { requireSignalApiAuth } from "@/lib/signal-api/auth"
import { signalApiError, signalApiJson } from "@/lib/signal-api/http"
import { logAndReturnSignalApiResponse } from "@/lib/signal-api/request-log"
import { emitSignalApiWebhookEvent } from "@/lib/signal-api/webhooks"

export const runtime = "nodejs"

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
  applyMethod?: string
}

interface IngestResult {
  jobId: string
  created: boolean
  attachedAsSecondarySource?: boolean
  matchedBy: string
}

type DedupeOutcome =
  | { kind: "no_match" }
  | { kind: "exact_match"; jobId: string; matchedBy: string }
  | { kind: "attach_secondary_source"; jobId: string; matchedBy: string }

export async function POST(request: Request) {
  const startedAtMs = Date.now()
  const auth = await requireSignalApiAuth(request, {
    requiredScopes: ["ingest.write"],
  })
  if (auth instanceof NextResponse) return auth

  const finish = (response: Response) =>
    logAndReturnSignalApiResponse(request, auth, startedAtMs, response)

  const body = (await request.json().catch(() => null)) as IngestBody | null
  const job = body?.job
  const source = body?.source
  const applyMethod = body?.applyMethod
  if (!job?.title || !job?.company || !job?.sourceId) {
    return finish(signalApiError(
      400,
      "title, company, and sourceId are required",
      "BAD_REQUEST",
      auth.requestId,
      auth.rateLimit, undefined, auth.quota
    ))
  }

  if (source !== job.site) {
    return finish(signalApiError(
      400,
      "source must match job.site",
      "BAD_REQUEST",
      auth.requestId,
      auth.rateLimit, undefined, auth.quota
    ))
  }

  const pool = getPostgresPool()

  try {
    const companyId = await resolveCompanyId(pool, job.company)
    if (!companyId) {
      return finish(signalApiError(
        500,
        "company resolution failed",
        "INTERNAL_ERROR",
        auth.requestId,
        auth.rateLimit, undefined, auth.quota
      ))
    }

    const dedupe = await dedupeJob(pool, companyId, auth.tenantId, job)

    if (dedupe.kind === "exact_match") {
      const touched = await touchJob(pool, dedupe.jobId, auth.tenantId, job, applyMethod)
      if (!touched) {
        return finish(signalApiError(
          500,
          "job update failed",
          "INTERNAL_ERROR",
          auth.requestId,
          auth.rateLimit, undefined, auth.quota
        ))
      }

      try {
        await emitSignalApiWebhookEvent({
          tenantId: auth.tenantId,
          eventType: "signal.job_ingested",
          data: {
            jobId: dedupe.jobId,
            companyId,
            source: source ?? job.site,
            sourceId: job.sourceId,
            title: job.title,
            company: job.company,
            created: false,
            attachedAsSecondarySource: false,
            matchedBy: dedupe.matchedBy,
          },
        })
      } catch (error) {
        console.error("[signal-api] webhook emit failed after deduped ingest", error)
      }

      return finish(signalApiJson<IngestResult>(auth, {
        jobId: dedupe.jobId,
        created: false,
        matchedBy: dedupe.matchedBy,
      }))
    }

    if (dedupe.kind === "attach_secondary_source") {
      const attached = await attachSecondarySource(pool, dedupe.jobId, auth.tenantId, job)
      if (!attached) {
        return finish(signalApiError(
          500,
          "secondary source attach failed",
          "INTERNAL_ERROR",
          auth.requestId,
          auth.rateLimit, undefined, auth.quota
        ))
      }

      try {
        await emitSignalApiWebhookEvent({
          tenantId: auth.tenantId,
          eventType: "signal.job_ingested",
          data: {
            jobId: dedupe.jobId,
            companyId,
            source: source ?? job.site,
            sourceId: job.sourceId,
            title: job.title,
            company: job.company,
            created: false,
            attachedAsSecondarySource: true,
            matchedBy: dedupe.matchedBy,
          },
        })
      } catch (error) {
        console.error("[signal-api] webhook emit failed after secondary-source attach", error)
      }

      return finish(signalApiJson<IngestResult>(auth, {
        jobId: dedupe.jobId,
        created: false,
        attachedAsSecondarySource: true,
        matchedBy: dedupe.matchedBy,
      }))
    }

    const jobId = await insertJob(pool, companyId, auth.tenantId, job, applyMethod)
    if (!jobId) {
      return finish(signalApiError(
        500,
        "job insert failed",
        "INTERNAL_ERROR",
        auth.requestId,
        auth.rateLimit, undefined, auth.quota
      ))
    }

    try {
      await emitSignalApiWebhookEvent({
        tenantId: auth.tenantId,
        eventType: "signal.job_ingested",
        data: {
          jobId,
          companyId,
          source: source ?? job.site,
          sourceId: job.sourceId,
          title: job.title,
          company: job.company,
          created: true,
          attachedAsSecondarySource: false,
          matchedBy: "none",
        },
      })
    } catch (error) {
      console.error("[signal-api] webhook emit failed after new ingest", error)
    }

    return finish(signalApiJson<IngestResult>(
      auth,
      { jobId, created: true, matchedBy: "none" },
      { status: 201 },
    ))
  } catch (error) {
    console.error("[signal/v1/jobs/ingest] error", error)
    return finish(signalApiError(
      500,
      "Unable to ingest job",
      "INTERNAL_ERROR",
      auth.requestId,
      auth.rateLimit, undefined, auth.quota
    ))
  }
}

async function resolveCompanyId(
  pool: ReturnType<typeof getPostgresPool>,
  companyName: string,
): Promise<string | null> {
  const existing = await pool
    .query<{ id: string }>(
      `SELECT id
       FROM companies
       WHERE LOWER(name) = LOWER($1)
       LIMIT 1`,
      [companyName],
    )
    .catch(() => null)
  if (existing?.rows[0]) return existing.rows[0].id

  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  const placeholderDomain = `${slug || "unknown"}.apex-signal-api-placeholder`
  const placeholderCareersUrl = `https://${placeholderDomain}/careers`

  const created = await pool
    .query<{ id: string }>(
      `INSERT INTO companies (name, is_active, ats_type, domain, careers_url)
       VALUES ($1, true, $2, $3, $4)
       RETURNING id`,
      [companyName, "generic", placeholderDomain, placeholderCareersUrl],
    )
    .catch(() => null)
  return created?.rows[0]?.id ?? null
}

async function dedupeJob(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  tenantId: string,
  job: ScrapedJob,
): Promise<DedupeOutcome> {
  switch (job.site) {
    case "linkedin": return dedupeLinkedIn(pool, companyId, tenantId, job)
    case "glassdoor": return dedupeGlassdoor(pool, companyId, tenantId, job)
    case "indeed": return dedupeIndeed(pool, companyId, tenantId, job)
    case "handshake": return dedupeHandshake(pool, companyId, tenantId, job)
  }
}

async function dedupeLinkedIn(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  tenantId: string,
  job: ScrapedJob,
): Promise<DedupeOutcome> {
  const exact = await findBySourceId(pool, companyId, tenantId, "linkedin", job.sourceId)
  if (exact) return { kind: "exact_match", jobId: exact, matchedBy: "linkedin:source_id" }

  const day = postedAtDay(job.postedAt)
  if (!day) return { kind: "no_match" }

  const fallback = await pool
    .query<{ id: string }>(
      `SELECT id
       FROM jobs
       WHERE company_id = $1::uuid
         AND normalized_title = $2
         AND posted_at::date = $3::date
         AND COALESCE(raw_data->>'signalTenantId', '') = $4
       LIMIT 1`,
      [companyId, normalizeTitle(job.title), day, tenantId],
    )
    .catch(() => null)

  if (fallback?.rows[0]) {
    return { kind: "exact_match", jobId: fallback.rows[0].id, matchedBy: "linkedin:title+day" }
  }
  return { kind: "no_match" }
}

async function dedupeGlassdoor(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  tenantId: string,
  job: ScrapedJob,
): Promise<DedupeOutcome> {
  const exact = await findBySourceId(pool, companyId, tenantId, "glassdoor", job.sourceId)
  if (exact) return { kind: "exact_match", jobId: exact, matchedBy: "glassdoor:source_id" }

  const cutoff = new Date(Date.now() - GLASSDOOR_CROSS_SOURCE_WINDOW_MS).toISOString()
  const cross = await pool
    .query<{ id: string }>(
      `SELECT id
       FROM jobs
       WHERE company_id = $1::uuid
         AND normalized_title = $2
         AND LOWER(COALESCE(location, '')) ILIKE $3
         AND COALESCE(posted_at, first_detected_at) >= $4::timestamptz
         AND COALESCE(raw_data->>'signalTenantId', '') = $5
       ORDER BY posted_at NULLS LAST
       LIMIT 1`,
      [companyId, normalizeTitle(job.title), `%${normalizeLocationCity(job.location)}%`, cutoff, tenantId],
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
  tenantId: string,
  job: ScrapedJob,
): Promise<DedupeOutcome> {
  const match = await pool
    .query<{ id: string }>(
      `SELECT id
       FROM jobs
       WHERE company_id = $1::uuid
         AND normalized_title = $2
         AND LOWER(COALESCE(location, '')) ILIKE $3
         AND COALESCE(raw_data->>'signalTenantId', '') = $4
       ORDER BY posted_at NULLS LAST
       LIMIT 1`,
      [companyId, normalizeTitle(job.title), `%${normalizeLocationCity(job.location)}%`, tenantId],
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
  tenantId: string,
  job: ScrapedJob,
): Promise<DedupeOutcome> {
  const exact = await findBySourceId(pool, companyId, tenantId, "handshake", job.sourceId)
  if (exact) return { kind: "exact_match", jobId: exact, matchedBy: "handshake:source_id" }
  return { kind: "no_match" }
}

async function findBySourceId(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  tenantId: string,
  source: AggregatorSource,
  sourceId: string,
): Promise<string | null> {
  const q = await pool
    .query<{ id: string }>(
      `SELECT id
       FROM jobs
       WHERE company_id = $1::uuid
         AND raw_data->>'apexSource' = $2
         AND raw_data->>'apexSourceId' = $3
         AND COALESCE(raw_data->>'signalTenantId', '') = $4
       LIMIT 1`,
      [companyId, source, sourceId, tenantId],
    )
    .catch(() => null)
  return q?.rows[0]?.id ?? null
}

async function insertJob(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string,
  tenantId: string,
  job: ScrapedJob,
  applyMethod: string | undefined,
): Promise<string | null> {
  const isRemote = job.workMode === "remote"
  const isHybrid = job.workMode === "hybrid"
  const applyUrl = canonicalApplyUrl(job)
  const rawData = {
    captureSource: "signal-api",
    signalTenantId: tenantId,
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

  const inserted = await pool
    .query<{ id: string }>(
      `INSERT INTO jobs (
         company_id, title, normalized_title, location, description,
         apply_url, external_id,
         is_remote, is_hybrid, is_active,
         employment_type,
         raw_data, posted_at,
         first_detected_at, last_seen_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7,
         $8, $9, true,
         $10,
         $11::jsonb, $12::timestamptz,
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
        JSON.stringify(rawData),
        job.postedAt,
      ],
    )
    .catch(() => null)

  return inserted?.rows[0]?.id ?? null
}

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

async function touchJob(
  pool: ReturnType<typeof getPostgresPool>,
  jobId: string,
  tenantId: string,
  job: ScrapedJob,
  applyMethod: string | undefined,
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    postedAt: job.postedAt,
    postedAtPrecision: job.postedAtPrecision,
    signalTenantId: tenantId,
  }
  if (applyMethod) patch.applyMethod = applyMethod

  const earliest = job.site === "indeed" ? "LEAST(jobs.posted_at, $3::timestamptz)" : "$3::timestamptz"
  const deadlinePatch =
    job.site === "handshake" && job.metadata?.deadline
      ? `, raw_data = raw_data || jsonb_build_object('metadata', COALESCE(raw_data->'metadata', '{}'::jsonb) || jsonb_build_object('deadline', $4::text))`
      : ""

  const params: unknown[] = [jobId, JSON.stringify(patch), job.postedAt]
  if (deadlinePatch) params.push(String(job.metadata.deadline))

  try {
    const result = await pool.query(
      `UPDATE jobs
       SET raw_data = COALESCE(raw_data, '{}'::jsonb) || $2::jsonb,
           posted_at = COALESCE(${earliest}, posted_at),
           last_seen_at = NOW(),
           updated_at = NOW()${deadlinePatch}
       WHERE id = $1::uuid`,
      params,
    )
    return (result.rowCount ?? 0) > 0
  } catch (error) {
    console.error("[signal/v1/jobs/ingest] touchJob failed", {
      jobId,
      site: job.site,
      sourceId: job.sourceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function attachSecondarySource(
  pool: ReturnType<typeof getPostgresPool>,
  jobId: string,
  tenantId: string,
  job: ScrapedJob,
): Promise<boolean> {
  const newEntry = JSON.stringify({ source: job.site, sourceId: job.sourceId })
  const tenantPatch = JSON.stringify({ signalTenantId: tenantId })

  try {
    const result = await pool.query(
      `UPDATE jobs
       SET raw_data = jsonb_set(
             (COALESCE(raw_data, '{}'::jsonb) || $3::jsonb),
             '{apexSources}',
             COALESCE(raw_data->'apexSources', '[]'::jsonb) || $2::jsonb,
             true
           ),
           last_seen_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::uuid`,
      [jobId, newEntry, tenantPatch],
    )
    return (result.rowCount ?? 0) > 0
  } catch (error) {
    console.error("[signal/v1/jobs/ingest] attachSecondarySource failed", {
      jobId,
      site: job.site,
      sourceId: job.sourceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

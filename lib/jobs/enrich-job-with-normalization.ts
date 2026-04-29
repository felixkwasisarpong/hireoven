import type { Pool } from "pg"
import { fetchJobDescription } from "@/lib/jobs/description"
import {
  normalizePersistedJobRecordWithAI,
  type PersistedJobForNormalization,
} from "@/lib/jobs/normalization"
import type { Job } from "@/types"

/** Columns persisted by normalizePersistedJobRecord.apply (same set as admin renormalize). */
const JOB_NORMALIZATION_COLUMNS = new Set([
  "normalized_title",
  "description",
  "location",
  "employment_type",
  "seniority_level",
  "is_remote",
  "is_hybrid",
  "salary_min",
  "salary_max",
  "salary_currency",
  "sponsors_h1b",
  "sponsorship_score",
  "requires_authorization",
  "visa_language_detected",
  "skills",
  "raw_data",
  "updated_at",
])

async function updateJobNormalizationColumns(
  pool: Pool,
  jobId: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const entries = Object.entries(payload).filter(([k]) => JOB_NORMALIZATION_COLUMNS.has(k))
  if (entries.length === 0) return false
  const values = entries.map(([, v]) => v)
  const setClause = entries.map(([k], i) => `${k} = $${i + 1}`).join(", ")
  const result = await pool.query(
    `UPDATE jobs SET ${setClause} WHERE id = $${values.length + 1}::uuid`,
    [...values, jobId]
  )
  return (result.rowCount ?? 0) > 0
}

export type JobEnrichmentResult = {
  ok: boolean
  refreshedDescription: boolean
  updatedColumns: boolean
}

/**
 * Fetches missing descriptions when needed, runs persisted-job normalization
 * (same path as crawler + admin /api/admin/jobs/renormalize), and merges `raw_data`.
 */
export async function enrichJobWithNormalization(
  pool: Pool,
  jobId: string
): Promise<JobEnrichmentResult> {
  let jobRow: Job | undefined
  try {
    const fetched = await pool.query<Job>(`SELECT * FROM jobs WHERE id = $1::uuid LIMIT 1`, [jobId])
    jobRow = fetched.rows[0]
    if (!jobRow) return { ok: false, refreshedDescription: false, updatedColumns: false }
  } catch {
    return { ok: false, refreshedDescription: false, updatedColumns: false }
  }

  let jobForNormalization = jobRow
  let refreshedDescription = false

  if (!jobForNormalization.description?.trim() && jobForNormalization.apply_url) {
    const fetchedDescription = await fetchJobDescription(jobForNormalization.apply_url)
    if (fetchedDescription) {
      jobForNormalization = { ...jobForNormalization, description: fetchedDescription }
      refreshedDescription = true
    }
  }

  // Keep deterministic normalization as baseline; apply Haiku enrichment with safe fallback.
  const normalization = await normalizePersistedJobRecordWithAI(
    jobForNormalization as PersistedJobForNormalization
  )

  const existingRawData =
    jobForNormalization.raw_data && typeof jobForNormalization.raw_data === "object"
      ? (jobForNormalization.raw_data as Record<string, unknown>)
      : {}

  const nextPayload: Record<string, unknown> = {
    ...normalization.nextColumns,
    raw_data: {
      ...existingRawData,
      normalization: {
        version: normalization.canonical.schema_version,
        normalized_at: normalization.canonical.normalized_at,
        confidence_score: normalization.canonical.validation.confidence_score,
        completeness_score: normalization.canonical.validation.completeness_score,
        requires_review: normalization.canonical.validation.requires_review,
        issues: normalization.canonical.validation.issues,
      },
      normalized: normalization.canonical,
      structured_job: normalization.structuredData,
      view: {
        page: normalization.pageView,
        card: normalization.cardView,
      },
    },
    updated_at: new Date().toISOString(),
  }

  const updatedColumns = await updateJobNormalizationColumns(pool, jobRow.id, nextPayload)

  return { ok: true, refreshedDescription, updatedColumns }
}

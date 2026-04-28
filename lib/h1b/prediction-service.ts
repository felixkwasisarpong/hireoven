import { getPostgresPool } from '@/lib/postgres/server'
import { predictH1BApproval } from '@/lib/h1b/predictor'
import type {
  Company,
  H1BPrediction,
  H1BPredictionInput,
  Job,
} from '@/types'

// Shared prediction helpers for the H1B predict API surface.
// These live here (not in a route.ts) because Next.js 14 only allows a
// fixed set of exports from route files (GET, POST, runtime, dynamic, …).
// Exporting additional helpers from a route file is a build-time type
// error, so the single-job and batch routes both import from this module.

export const H1B_PREDICTION_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

function pickString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function extractSocHints(job: Job): { socCode: string | null; socTitle: string | null } {
  const raw = job.raw_data
  if (!raw || typeof raw !== "object") return { socCode: null, socTitle: null }
  const root = raw as Record<string, unknown>
  const normalized = (root.normalized && typeof root.normalized === "object")
    ? (root.normalized as Record<string, unknown>)
    : null

  const candidatesSocCode = [
    root.soc_code,
    root.socCode,
    root.SOC_CODE,
    normalized?.soc_code,
    normalized?.socCode,
    normalized?.SOC_CODE,
    (normalized?.header && typeof normalized.header === "object")
      ? (normalized.header as Record<string, unknown>).soc_code
      : null,
  ]
  const candidatesSocTitle = [
    root.soc_title,
    root.socTitle,
    root.SOC_TITLE,
    normalized?.soc_title,
    normalized?.socTitle,
    normalized?.SOC_TITLE,
    (normalized?.header && typeof normalized.header === "object")
      ? (normalized.header as Record<string, unknown>).soc_title
      : null,
  ]

  return {
    socCode: candidatesSocCode.map(pickString).find(Boolean) ?? null,
    socTitle: candidatesSocTitle.map(pickString).find(Boolean) ?? null,
  }
}

export async function predictForJob(
  jobId: string,
  options: { force?: boolean } = {}
): Promise<{ prediction: H1BPrediction | null; cached: boolean }> {
  const pool = getPostgresPool()

  const result = await pool.query<Job & { company: Company }>(
    `SELECT j.*, to_jsonb(c.*) AS company
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.id = $1
     LIMIT 1`,
    [jobId]
  )
  const job = result.rows[0] ?? null
  if (!job) return { prediction: null, cached: false }

  if (!options.force && job.h1b_prediction && job.h1b_prediction_at) {
    const age = Date.now() - new Date(job.h1b_prediction_at).getTime()
    if (age < H1B_PREDICTION_CACHE_TTL_MS) {
      return { prediction: job.h1b_prediction as H1BPrediction, cached: true }
    }
  }

  const prediction = await runPrediction(job)

  await pool.query(
    `UPDATE jobs
     SET h1b_prediction = $1::jsonb,
         h1b_prediction_at = $2
     WHERE id = $3`,
    [JSON.stringify(prediction), new Date().toISOString(), jobId]
  )

  return { prediction, cached: false }
}

export async function runPrediction(
  job: Job & { company: Company }
): Promise<H1BPrediction> {
  const { socCode, socTitle } = extractSocHints(job)
  const input: H1BPredictionInput = {
    jobTitle: job.title,
    normalizedTitle: job.normalized_title,
    company: { id: job.company.id, name: job.company.name },
    location: job.location,
    state: null,
    isRemote: job.is_remote,
    salaryMin: job.salary_min,
    salaryMax: job.salary_max,
    seniorityLevel: job.seniority_level,
    employmentType: job.employment_type,
    socCode,
    socTitle,
    description: job.description,
  }

  return predictH1BApproval(input)
}

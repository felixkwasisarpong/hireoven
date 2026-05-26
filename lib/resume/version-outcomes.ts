import type { Pool } from "pg"
import type { ResumeVersion, ResumeVersionOutcomeStats } from "@/types"

const APPLIED_STATUSES = [
  "applied",
  "phone_screen",
  "interview",
  "interviewing",
  "final_round",
  "offer",
  "offered",
  "rejected",
  "withdrawn",
] as const

const RESPONDED_STATUSES = [
  "phone_screen",
  "interview",
  "interviewing",
  "final_round",
  "offer",
  "offered",
  "rejected",
  "withdrawn",
] as const

const INTERVIEW_STATUSES = [
  "interview",
  "interviewing",
  "final_round",
  "offer",
  "offered",
] as const

const OFFER_STATUSES = [
  "offer",
  "offered",
] as const

type ResumeVersionOutcomeRow = ResumeVersion & {
  applications_count: number | string | null
  responses_count: number | string | null
  interviews_count: number | string | null
  offers_count: number | string | null
}

function toCount(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return Math.max(0, parsed)
  }
  return 0
}

function toPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 100)
}

function buildOutcomeStats(row: ResumeVersionOutcomeRow): ResumeVersionOutcomeStats {
  const applications = toCount(row.applications_count)
  const responses = toCount(row.responses_count)
  const interviews = toCount(row.interviews_count)
  const offers = toCount(row.offers_count)
  return {
    applications_count: applications,
    responses_count: responses,
    interviews_count: interviews,
    offers_count: offers,
    response_rate: toPercent(responses, applications),
    interview_rate: toPercent(interviews, applications),
    offer_rate: toPercent(offers, applications),
  }
}

export async function fetchResumeVersionsWithOutcomeStats(args: {
  pool: Pool
  resumeId: string
  userId: string
}): Promise<ResumeVersion[]> {
  const result = await args.pool.query<ResumeVersionOutcomeRow>(
    `WITH ordered_versions AS (
       SELECT
         rv.id,
         rv.resume_id,
         rv.user_id,
         rv.version_number,
         rv.name,
         rv.file_url,
         rv.snapshot,
         rv.changes_summary,
         rv.created_at,
         LEAD(rv.created_at) OVER (ORDER BY rv.created_at ASC) AS next_created_at
       FROM resume_versions rv
       WHERE rv.resume_id = $1::uuid
         AND rv.user_id = $2::uuid
     ),
     application_events AS (
       SELECT
         ja.id,
         COALESCE(ja.applied_at, ja.created_at) AS event_at,
         LOWER(COALESCE(ja.status, '')) AS status
       FROM job_applications ja
       WHERE ja.user_id = $2::uuid
         AND ja.is_archived = false
         AND (
           ja.resume_id = $1::uuid
           OR ja.resume_id IN (SELECT id FROM ordered_versions)
         )
     )
     SELECT
       ov.id,
       ov.resume_id,
       ov.user_id,
       ov.version_number,
       ov.name,
       ov.file_url,
       ov.snapshot,
       ov.changes_summary,
       ov.created_at,
       COUNT(ae.id) FILTER (WHERE ae.status = ANY($3::text[]))::int AS applications_count,
       COUNT(ae.id) FILTER (WHERE ae.status = ANY($4::text[]))::int AS responses_count,
       COUNT(ae.id) FILTER (WHERE ae.status = ANY($5::text[]))::int AS interviews_count,
       COUNT(ae.id) FILTER (WHERE ae.status = ANY($6::text[]))::int AS offers_count
     FROM ordered_versions ov
     LEFT JOIN application_events ae
       ON ae.event_at >= ov.created_at
      AND (ov.next_created_at IS NULL OR ae.event_at < ov.next_created_at)
     GROUP BY
       ov.id,
       ov.resume_id,
       ov.user_id,
       ov.version_number,
       ov.name,
       ov.file_url,
       ov.snapshot,
       ov.changes_summary,
       ov.created_at
     ORDER BY ov.created_at DESC`,
    [
      args.resumeId,
      args.userId,
      [...APPLIED_STATUSES],
      [...RESPONDED_STATUSES],
      [...INTERVIEW_STATUSES],
      [...OFFER_STATUSES],
    ],
  )

  return result.rows.map((row) => ({
    id: row.id,
    resume_id: row.resume_id,
    user_id: row.user_id,
    version_number: row.version_number,
    name: row.name,
    file_url: row.file_url,
    snapshot: row.snapshot,
    changes_summary: row.changes_summary,
    created_at: row.created_at,
    outcome_stats: buildOutcomeStats(row),
  }))
}

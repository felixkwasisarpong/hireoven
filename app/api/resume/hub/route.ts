import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import type {
  ResumeHubData,
  ResumeHubProfile,
  ResumeHubRecentEdit,
  ResumeHubResumeMeta,
  ResumeHubTailoringRecord,
  ResumeHubTargetJob,
  ResumeStatus,
  TailoredBulletSuggestion,
} from "@/types/resume-hub"

export const runtime = "nodejs"

type RecentEditRow = {
  id: string
  resume_id: string
  tool_id: string
  label: string | null
  status: string
  created_at: string
}

type ResumeMetaRow = {
  resume_id: string
  is_primary: boolean
  parse_status: string
  archived_at: string | null
  version_count: string | number | null
  tailoring_score: number | null
  tailoring_job_id: string | null
  tailoring_job_title: string | null
  tailoring_company: string | null
  match_score: number | null
}

type TargetJobRow = {
  id: string | null
  title: string | null
  company: string | null
  description: string | null
  match_score: number | null
  status: string | null
}

type TailoringRow = {
  id: string
  resume_id: string
  job_id: string | null
  job_title: string | null
  company: string | null
  job_description: string
  match_score: number
  present_keywords: string[] | null
  missing_keywords: string[] | null
  suggested_summary_rewrite: string | null
  suggested_skills_to_add: string[] | null
  bullet_suggestions: TailoredBulletSuggestion[] | null
  warnings: string[] | null
  created_at: string
}

type ProfileRow = {
  is_international: boolean
  visa_status: string | null
  needs_sponsorship: boolean
  opt_end_date: string | null
}

type TableAvailability = {
  resume_ai_edits: boolean
  resume_edits: boolean
  resume_versions: boolean
  resume_tailoring_analyses: boolean
  job_match_scores: boolean
}

function toResumeStatus(row: ResumeMetaRow): ResumeStatus {
  if (row.archived_at) return "archived"
  if (row.is_primary) return "active"
  if (row.parse_status !== "complete") return "draft"
  if (row.tailoring_score != null) return "tailored"
  return "draft"
}

function toRecentEdit(row: RecentEditRow): ResumeHubRecentEdit {
  return {
    id: row.id,
    resumeId: row.resume_id,
    toolId: row.tool_id,
    label: row.label ?? row.tool_id.replace(/_/g, " "),
    status: row.status,
    createdAt: row.created_at,
  }
}

function toTargetJob(row: TargetJobRow): ResumeHubTargetJob | null {
  if (!row.id || !row.title) return null
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    description: row.description,
    matchScore: row.match_score,
    status: row.status,
  }
}

function toTailoringRecord(row: TailoringRow): ResumeHubTailoringRecord {
  return {
    id: row.id,
    resumeId: row.resume_id,
    jobId: row.job_id,
    jobTitle: row.job_title ?? "Target role",
    company: row.company,
    jobDescription: row.job_description,
    matchScore: row.match_score,
    presentKeywords: row.present_keywords ?? [],
    missingKeywords: row.missing_keywords ?? [],
    bulletSuggestions: row.bullet_suggestions ?? [],
    suggestedSummaryRewrite: row.suggested_summary_rewrite,
    suggestedSkillsToAdd: row.suggested_skills_to_add ?? [],
    warnings: row.warnings ?? [],
    createdAt: row.created_at,
  }
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  await pool.query(`ALTER TABLE resumes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`)

  const availabilityResult = await pool.query<TableAvailability>(
    `SELECT
       to_regclass('public.resume_ai_edits') IS NOT NULL AS resume_ai_edits,
       to_regclass('public.resume_edits') IS NOT NULL AS resume_edits,
       to_regclass('public.resume_versions') IS NOT NULL AS resume_versions,
       to_regclass('public.resume_tailoring_analyses') IS NOT NULL AS resume_tailoring_analyses,
       to_regclass('public.job_match_scores') IS NOT NULL AS job_match_scores`
  )
  const tables = availabilityResult.rows[0]

  const recentEditSources: string[] = []
  if (tables.resume_ai_edits) {
    recentEditSources.push(
      `SELECT id::text, resume_id::text, tool_id, label, status, created_at
       FROM resume_ai_edits
       WHERE user_id = $1`
    )
  }
  if (tables.resume_edits) {
    recentEditSources.push(
      `SELECT
         id::text,
         resume_id::text,
         edit_type AS tool_id,
         CONCAT(UPPER(SUBSTRING(REPLACE(edit_type, '_', ' ') FROM 1 FOR 1)), SUBSTRING(REPLACE(edit_type, '_', ' ') FROM 2)) AS label,
         CASE
           WHEN was_accepted IS TRUE THEN 'complete'
           WHEN was_accepted IS FALSE THEN 'rejected'
           ELSE 'pending'
         END AS status,
         created_at
       FROM resume_edits
       WHERE user_id = $1`
    )
  }

  const recentEditsQuery = recentEditSources.length
    ? `SELECT id, resume_id, tool_id, label, status, created_at
       FROM (${recentEditSources.join(" UNION ALL ")}) edits
       ORDER BY created_at DESC
       LIMIT 8`
    : `SELECT
         NULL::text AS id,
         NULL::text AS resume_id,
         NULL::text AS tool_id,
         NULL::text AS label,
         NULL::text AS status,
         NOW() AS created_at
       WHERE false`

  const versionCountsCte = tables.resume_versions
    ? `SELECT resume_id, COUNT(*)::int AS version_count
       FROM resume_versions
       WHERE user_id = $1
       GROUP BY resume_id`
    : `SELECT NULL::uuid AS resume_id, 0::int AS version_count WHERE false`

  const latestTailoringCte = tables.resume_tailoring_analyses
    ? `SELECT DISTINCT ON (resume_id)
         resume_id,
         job_id,
         job_title,
         company,
         match_score
       FROM resume_tailoring_analyses
       WHERE user_id = $1
       ORDER BY resume_id, created_at DESC`
    : `SELECT
         NULL::uuid AS resume_id,
         NULL::uuid AS job_id,
         NULL::text AS job_title,
         NULL::text AS company,
         NULL::int AS match_score
       WHERE false`

  const bestMatchCte = tables.job_match_scores
    ? `SELECT resume_id, MAX(overall_score)::int AS match_score
       FROM job_match_scores
       WHERE user_id = $1
       GROUP BY resume_id`
    : `SELECT NULL::uuid AS resume_id, NULL::int AS match_score WHERE false`

  const [recentEditsResult, resumeMetaResult, targetJobsResult, tailoringResult, profileResult] = await Promise.all([
    pool.query<RecentEditRow>(recentEditsQuery, [user.sub]),
    pool.query<ResumeMetaRow>(
      `WITH version_counts AS (
         ${versionCountsCte}
       ),
       latest_tailoring AS (
         ${latestTailoringCte}
       ),
       best_match AS (
         ${bestMatchCte}
       )
       SELECT
         r.id AS resume_id,
         r.is_primary,
         r.parse_status,
         r.archived_at,
         COALESCE(vc.version_count, 0) AS version_count,
         lt.match_score AS tailoring_score,
         lt.job_id AS tailoring_job_id,
         lt.job_title AS tailoring_job_title,
         lt.company AS tailoring_company,
         COALESCE(lt.match_score, bm.match_score) AS match_score
       FROM resumes r
       LEFT JOIN version_counts vc ON vc.resume_id = r.id
       LEFT JOIN latest_tailoring lt ON lt.resume_id = r.id
       LEFT JOIN best_match bm ON bm.resume_id = r.id
       WHERE r.user_id = $1`,
      [user.sub]
    ),
    pool.query<TargetJobRow>(
      `SELECT
         COALESCE(j.id::text, ja.id::text) AS id,
         COALESCE(j.title, ja.job_title) AS title,
         COALESCE(c.name, ja.company_name) AS company,
         j.description,
         ja.match_score,
         ja.status
       FROM job_applications ja
       LEFT JOIN jobs j ON j.id = ja.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE ja.user_id = $1
       ORDER BY ja.updated_at DESC, ja.created_at DESC
       LIMIT 8`,
      [user.sub]
    ),
    tables.resume_tailoring_analyses
      ? pool.query<TailoringRow>(
          `SELECT *
           FROM resume_tailoring_analyses
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 12`,
          [user.sub]
        )
      : Promise.resolve({ rows: [] as TailoringRow[] }),
    pool.query<ProfileRow>(
      `SELECT is_international, visa_status, needs_sponsorship, opt_end_date
       FROM profiles
       WHERE id = $1
       LIMIT 1`,
      [user.sub]
    ),
  ])

  const resumeMeta = resumeMetaResult.rows.reduce<Record<string, ResumeHubResumeMeta>>((acc, row) => {
    acc[row.resume_id] = {
      resumeId: row.resume_id,
      status: toResumeStatus(row),
      matchScore: row.match_score,
      versionCount: Number(row.version_count ?? 0),
      linkedJobId: row.tailoring_job_id,
      linkedJobTitle: row.tailoring_job_title,
      linkedCompany: row.tailoring_company,
    }
    return acc
  }, {})

  const profileRow = profileResult.rows[0]
  const profile: ResumeHubProfile | null = profileRow
    ? {
        isInternational: profileRow.is_international,
        visaStatus: profileRow.visa_status,
        needsSponsorship: profileRow.needs_sponsorship,
        optEndDate: profileRow.opt_end_date,
      }
    : null

  const payload: ResumeHubData = {
    recentEdits: recentEditsResult.rows.map(toRecentEdit),
    resumeMeta,
    targetJobs: targetJobsResult.rows.map(toTargetJob).filter((job): job is ResumeHubTargetJob => job != null),
    tailoringAnalyses: tailoringResult.rows.map(toTailoringRecord),
    profile,
  }

  return NextResponse.json(payload)
}

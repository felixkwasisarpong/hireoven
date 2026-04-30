/**
 * Scout Job Context Resolver
 *
 * Resolves the best job to use for tailor, workflow, and "open strongest job"
 * commands when no explicit jobId is provided in the request.
 *
 * Priority order:
 *   1. explicit        — jobId was explicitly passed in the request body (caller handles)
 *   2. compare_winner  — the winning job from the active compare context
 *   3. best_saved_match — highest match-scored saved job from job_applications
 *   4. recent_saved    — most recently saved application with a job_id
 *
 * All results include the resolved job's detail URL so the chat text and
 * action link are always consistent — they come from the same object.
 */

import type { Pool } from "pg"

export type ResolvedJobSource =
  | "explicit"
  | "active_context"
  | "compare_winner"
  | "best_saved_match"
  | "recent_saved"

export type ResolvedJobContext = {
  jobId:      string
  title:      string
  company:    string
  companyId:  string | null
  detailUrl:  string
  applyUrl:   string | null
  source:     ResolvedJobSource
  /** 0–1 — reflects how confident we are this is the right job */
  confidence: number
}

type SavedJobRow = {
  job_id:         string
  job_title:      string | null
  company_name:   string | null
  company_id:     string | null
  apply_url:      string | null
  match_score:    number | null
  latest_score:   number | null
}

/**
 * Resolve the best job context for a user.
 * Only queries `job_applications` (status='saved') + `job_match_scores`.
 * Returns null if no saved jobs exist.
 */
export async function resolveJobContext(
  userId:   string,
  pool:     Pool,
  opts: {
    /** If set, this job ID is added as the compare_winner source */
    compareWinnerId?: string | null
  } = {}
): Promise<ResolvedJobContext | null> {
  // ── Compare winner ────────────────────────────────────────────────────────
  if (opts.compareWinnerId) {
    const res = await pool.query<{ id: string; title: string; company_name: string; company_id: string | null; apply_url: string | null }>(
      `SELECT j.id, j.title, COALESCE(c.name, '') AS company_name, c.id AS company_id, j.apply_url
       FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.id = $1 AND j.is_active = true LIMIT 1`,
      [opts.compareWinnerId]
    ).catch(() => null)
    const row = res?.rows?.[0]
    if (row) {
      return {
        jobId:      row.id,
        title:      row.title,
        company:    row.company_name,
        companyId:  row.company_id,
        applyUrl:   row.apply_url,
        detailUrl:  `/dashboard/jobs/${row.id}`,
        source:     "compare_winner",
        confidence: 0.9,
      }
    }
  }

  // ── Best saved match (highest score) + fallback to recent saved ──────────
  const savedRes = await pool.query<SavedJobRow>(
    `SELECT
       ja.job_id,
       COALESCE(j.title, ja.job_title)    AS job_title,
       COALESCE(c.name, ja.company_name)  AS company_name,
       c.id                                AS company_id,
       COALESCE(j.apply_url, ja.apply_url) AS apply_url,
       ja.match_score,
       ls.overall_score                    AS latest_score
     FROM job_applications ja
     LEFT JOIN jobs j ON j.id = ja.job_id AND j.is_active = true
     LEFT JOIN companies c ON c.id = j.company_id
     LEFT JOIN LATERAL (
       SELECT jms.overall_score
       FROM job_match_scores jms
       INNER JOIN resumes r
         ON r.id = jms.resume_id AND r.user_id = $1 AND r.is_primary = true
       WHERE jms.job_id = ja.job_id AND jms.user_id = $1
       ORDER BY jms.computed_at DESC LIMIT 1
     ) ls ON true
     WHERE ja.user_id = $1
       AND ja.status = 'saved'
       AND ja.is_archived = false
       AND ja.job_id IS NOT NULL
     ORDER BY
       COALESCE(ls.overall_score, ja.match_score, 0) DESC,
       ja.created_at DESC
     LIMIT 5`,
    [userId]
  ).catch(() => null)

  const rows = savedRes?.rows ?? []
  if (rows.length === 0) return null

  const best = rows[0]
  const score = best.latest_score ?? best.match_score
  const isHighScore = typeof score === "number" && score >= 60

  return {
    jobId:      best.job_id,
    title:      best.job_title ?? "Saved job",
    company:    best.company_name ?? "Unknown company",
    companyId:  best.company_id ?? null,
    applyUrl:   best.apply_url ?? null,
    detailUrl:  `/dashboard/jobs/${best.job_id}`,
    source:     isHighScore ? "best_saved_match" : "recent_saved",
    confidence: isHighScore ? 0.85 : 0.6,
  }
}

/**
 * Returns the top N saved jobs as a selectable list for Scout to present
 * when the user asks to "pick a job" but doesn't specify which one.
 */
export async function listTopSavedJobs(
  userId: string,
  pool:   Pool,
  limit = 5,
): Promise<Array<{ jobId: string; title: string; company: string; score: number | null; detailUrl: string }>> {
  const res = await pool.query<SavedJobRow & { score: number | null }>(
    `SELECT
       ja.job_id,
       COALESCE(j.title, ja.job_title)    AS job_title,
       COALESCE(c.name, ja.company_name)  AS company_name,
       c.id                                AS company_id,
       COALESCE(ls.overall_score, ja.match_score) AS score
     FROM job_applications ja
     LEFT JOIN jobs j ON j.id = ja.job_id AND j.is_active = true
     LEFT JOIN companies c ON c.id = j.company_id
     LEFT JOIN LATERAL (
       SELECT jms.overall_score
       FROM job_match_scores jms
       INNER JOIN resumes r
         ON r.id = jms.resume_id AND r.user_id = $1 AND r.is_primary = true
       WHERE jms.job_id = ja.job_id AND jms.user_id = $1
       ORDER BY jms.computed_at DESC LIMIT 1
     ) ls ON true
     WHERE ja.user_id = $1
       AND ja.status = 'saved'
       AND ja.is_archived = false
       AND ja.job_id IS NOT NULL
     ORDER BY COALESCE(ls.overall_score, ja.match_score, 0) DESC, ja.created_at DESC
     LIMIT $2`,
    [userId, limit]
  ).catch(() => null)

  return (res?.rows ?? []).map((r) => ({
    jobId:    r.job_id,
    title:    r.job_title ?? "Saved job",
    company:  r.company_name ?? "Unknown",
    score:    r.score ?? null,
    detailUrl: `/dashboard/jobs/${r.job_id}`,
  }))
}

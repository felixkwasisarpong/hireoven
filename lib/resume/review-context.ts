/**
 * The one place that assembles everything a review needs.
 *
 * Both the review endpoint and the fix endpoint have to compute the same thing —
 * the resume, its corpus-grounded signal, the positioning brief for its lane, the
 * pivot suggestion, the document kind, and the resulting findings. Duplicating
 * that meant the fix flow could silently plan against a different set of findings
 * than the one the user approved, which is the worst possible bug for a feature
 * whose whole promise is "we only change what we told you about".
 *
 * Server-only (pg).
 */

import type { Pool } from "pg"
import {
  buildPositioningBrief,
  detectResumeSignal,
  fieldSignatureToProfile,
  scoreResumeAgainstProfiles,
  FIELDS,
  type FieldProfile,
  type PositioningBrief,
  type ResumeSignal,
} from "@/lib/resume/signal"
import { getFieldProfiles } from "@/lib/resume/field-profiles"
import { suggestPivotTarget, type PivotSuggestion } from "@/lib/resume/pivot-suggest"
import { detectDocumentKind, type DocumentKindResult } from "@/lib/resume/document-kind"
import { buildResumeReview, type ResumeReview } from "@/lib/resume/review"
import type { Resume } from "@/types"

export interface ReviewContext {
  resume: Resume
  /** True when scoring ran against corpus-derived field profiles. */
  grounded: boolean
  signal: ResumeSignal
  brief: PositioningBrief | null
  pivot: PivotSuggestion | null
  kind: DocumentKindResult
  review: ResumeReview
  /** The field key the brief was built for — the lane we are judging against. */
  laneKey: string | null
}

const RESUME_COLUMNS = `id, user_id, file_name, name, file_url, storage_path, file_size, file_type,
  is_primary, parse_status, full_name, email, phone, location, linkedin_url, portfolio_url,
  github_url, summary, work_experience, education, skills, projects, certifications,
  seniority_level, years_of_experience, primary_role, industries, top_skills, resume_score,
  ats_score, raw_text, target_field, additional_sections, created_at, updated_at`

/** The user's primary parsed resume, or null when there is none. */
export async function loadPrimaryResume(pool: Pool, userId: string): Promise<Resume | null> {
  const { rows } = await pool.query<Resume>(
    `SELECT ${RESUME_COLUMNS}
       FROM resumes
      WHERE user_id = $1 AND archived_at IS NULL AND parse_status = 'complete'
      ORDER BY is_primary DESC, updated_at DESC
      LIMIT 1`,
    [userId],
  )
  return rows[0] ?? null
}

/**
 * Build the full review context for a resume.
 *
 * `asOf` is passed through so gap arithmetic stays deterministic and testable;
 * callers supply the current month.
 */
export async function buildReviewContext(
  pool: Pool,
  resume: Resume,
  asOf: string,
): Promise<ReviewContext> {
  // Corpus-grounded scoring when field profiles are built; keyword signatures
  // until then. Both produce the same shape.
  const profiles = await getFieldProfiles(pool).catch(() => [])
  const grounded = profiles.length > 0
  const signal: ResumeSignal = grounded
    ? scoreResumeAgainstProfiles(resume, profiles)
    : detectResumeSignal(resume)

  // Brief for the lane the user chose, else the one the resume reads as.
  const laneKey = resume.target_field ?? signal.primary?.key ?? null
  let brief: PositioningBrief | null = null
  if (laneKey) {
    const profile: FieldProfile | undefined = grounded
      ? profiles.find((p) => p.key === laneKey)
      : (() => {
          const sig = FIELDS.find((f) => f.key === laneKey)
          return sig ? fieldSignatureToProfile(sig) : undefined
        })()
    if (profile) brief = buildPositioningBrief(resume, profile)
  }

  const pivot = suggestPivotTarget(signal, profiles)
  const kind = detectDocumentKind(resume)
  const review = buildResumeReview({ resume, signal, brief, pivot, kind, asOf })

  return { resume, grounded, signal, brief, pivot, kind, review, laneKey }
}

/** Current month in the form the review's gap arithmetic expects. */
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/**
 * GET /api/extension/jobs/:jobId/scout-overlay
 *
 * Returns cached Hireoven signals for the Scout overlay (no AI generation).
 * Caller should only request after the job is saved to the user's pipeline.
 */

import {
  extensionCorsHeaders,
  extensionError,
  extensionJson,
  handleExtensionPreflight,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import { getScoringContextForUser, scoreJobsForUser } from "@/lib/matching/batch-scorer"
import type { JobIntelligence, JobMatchScore } from "@/types"

export const runtime = "nodejs"

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function parseIntel(raw: unknown): JobIntelligence | null {
  if (!isRecord(raw)) return null
  return raw as JobIntelligence
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ jobId: string }> }
) {
  const origin = request.headers.get("origin")
  const headers = extensionCorsHeaders(origin)

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const { jobId } = await ctx.params
  if (!jobId || jobId.length < 8) {
    return extensionError(request, 400, "Invalid jobId", { headers })
  }

  const pool = getPostgresPool()

  const saved = await pool
    .query<{ one: string }>(
      `SELECT 1 AS one
       FROM job_applications
       WHERE user_id = $1 AND job_id = $2::uuid
       LIMIT 1`,
      [user.sub, jobId]
    )
    .catch(() => null)

  if (!saved?.rows?.length) {
    return extensionJson(
      request,
      {
        ok: false,
        error: "not_saved",
        message: "Save this job in Hireoven first to load Scout signals.",
      },
      { status: 404, headers }
    )
  }

  const jobRow = await pool
    .query<{ job_intelligence: unknown }>(
      `SELECT job_intelligence FROM jobs WHERE id = $1::uuid LIMIT 1`,
      [jobId]
    )
    .catch(() => null)

  const jobIntelligence = parseIntel(jobRow?.rows?.[0]?.job_intelligence ?? null)

  const context = await getScoringContextForUser(user.sub)
  if (!context) {
    return extensionJson(request, buildPayload(null, jobIntelligence, false, null), {
      status: 200,
      headers,
    })
  }

  let score: JobMatchScore | null =
    (
      await pool
        .query<JobMatchScore>(
          `SELECT *
           FROM job_match_scores
           WHERE user_id = $1 AND resume_id = $2 AND job_id = $3::uuid
           LIMIT 1`,
          [user.sub, context.resume.id, jobId]
        )
        .catch(() => null)
    )?.rows?.[0] ?? null

  if (!score) {
    const computed = await scoreJobsForUser(user.sub, [jobId])
    score = computed.get(jobId) ?? null
  }

  const afRow = await pool
    .query<{ one: string }>(
      `SELECT 1 AS one FROM autofill_profiles WHERE user_id = $1 LIMIT 1`,
      [user.sub]
    )
    .catch(() => null)
  const autofillReady = Boolean(afRow?.rows?.length)

  return extensionJson(
    request,
    buildPayload(score, jobIntelligence, autofillReady, context.resume.id),
    { status: 200, headers }
  )
}

interface ScoutOverlayResponse {
  ok: true
  matchPercent: number | null
  sponsorshipLikely: boolean | null
  sponsorshipLabel: string | null
  visaInsight: string | null
  missingSkills: string[]
  resumeAlignmentNote: string | null
  autofillReady: boolean
  jobIntelligenceStale: boolean
}

function buildPayload(
  score: JobMatchScore | null,
  intel: JobIntelligence | null,
  autofillReady: boolean,
  resumeId: string | null
): ScoutOverlayResponse {
  const fromIntel = (intel?.matchScore?.missingSkills ?? []).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  )
  const fromBreakdown = (score?.score_breakdown?.missingSkills ?? []).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  )

  const merged = fromIntel.length > 0 ? fromIntel : fromBreakdown

  const uniqueMissing = [...new Set(merged.map((s) => s.trim()))].slice(0, 8)

  const matchPercent =
    score?.overall_score != null ? Math.round(Number(score.overall_score)) : intel?.matchScore?.overallScore != null
      ? Math.round(Number(intel.matchScore!.overallScore))
      : null

  let sponsorshipLikely: boolean | null =
    typeof score?.is_sponsorship_compatible === "boolean"
      ? score.is_sponsorship_compatible
      : intel?.visa?.employerLikelySponsors ?? null

  let sponsorshipLabel: string | null = null
  if (sponsorshipLikely === true) sponsorshipLabel = "Likely sponsorship"
  else if (sponsorshipLikely === false) sponsorshipLabel = "Visa caution"
  else if (intel?.visa?.requiresSponsorship === true && intel?.visa?.employerLikelySponsors !== true) {
    sponsorshipLabel = "Check visa fit"
    sponsorshipLikely = null
  }

  let visaInsight: string | null = null
  const visa = intel?.visa
  if (visa?.summary && typeof visa.summary === "string") {
    visaInsight = visa.summary.trim().slice(0, 200)
  } else if (visa) {
    const bits: string[] = []
    if (typeof visa.visaFitScore === "number") bits.push(`Visa fit ${Math.round(visa.visaFitScore)}`)
    if (visa.verdict != null) bits.push(String(visa.verdict))
    visaInsight = bits.length ? bits.join(" · ").slice(0, 200) : null
  }

  let resumeAlignmentNote: string | null = null
  const ra = intel?.resumeLcaRoleAlignment
  if (ra?.explanation && typeof ra.explanation === "string") {
    resumeAlignmentNote = ra.explanation.trim().slice(0, 200)
  } else if (intel?.matchScore?.totalRequiredSkills != null) {
    const m = intel.matchScore
    const matched = Array.isArray(m.matchedSkills) ? m.matchedSkills.length : 0
    const tot = m.totalRequiredSkills
    resumeAlignmentNote = `Skills signal: ${matched} strong matches / ${tot} surfaced requirements.`
  } else if (score?.matching_skills_count != null && score.total_required_skills != null) {
    resumeAlignmentNote = `Skills aligned ${score.matching_skills_count} / ${score.total_required_skills}.`
  }

  return {
    ok: true,
    matchPercent,
    sponsorshipLikely,
    sponsorshipLabel,
    visaInsight,
    missingSkills: uniqueMissing.slice(0, 5),
    resumeAlignmentNote,
    autofillReady,
    jobIntelligenceStale: resumeId !== null && intel === null,
  }
}

import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
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
import { suggestPivotTarget } from "@/lib/resume/pivot-suggest"
import { buildResumeReview } from "@/lib/resume/review"
import { detectDocumentKind } from "@/lib/resume/document-kind"
import { mergeNarrative, narrateReview, type ReviewNarrative } from "@/lib/resume/review-narrative"
import { apexCache, CACHE_TTL, cacheKey, stableHash } from "@/lib/apex/budget/cache"
import type { Resume } from "@/types"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * "Why am I not getting interviews?" — the ranked diagnosis for the user's
 * primary resume.
 *
 * Deliberately two-phase. The default response is the deterministic review and
 * lands immediately, so the walkthrough can paint findings without waiting on a
 * model. Pass ?narrate=1 for the AI narration pass, which the client fetches
 * second and swaps in. That keeps the expensive call off the critical path and
 * means a slow or capped model degrades the prose, never the diagnosis.
 */
export async function GET(request: Request) {
  if (!hasPostgresEnv()) return NextResponse.json({ hasResume: false })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const { rows } = await pool.query<
    Pick<
      Resume,
      | "id"
      | "name"
      | "file_name"
      | "updated_at"
      | "primary_role"
      | "top_skills"
      | "skills"
      | "work_experience"
      | "industries"
      | "summary"
      | "raw_text"
      | "target_field"
      | "email"
      | "phone"
      | "linkedin_url"
      | "additional_sections"
      | "education"
    >
  >(
    `SELECT id, name, file_name, updated_at, primary_role, top_skills, skills, work_experience,
            industries, summary, raw_text, target_field, email, phone, linkedin_url,
            additional_sections, education
       FROM resumes
      WHERE user_id = $1 AND archived_at IS NULL AND parse_status = 'complete'
      ORDER BY is_primary DESC, updated_at DESC
      LIMIT 1`,
    [user.id],
  )

  const resume = rows[0]
  if (!resume) {
    // Nothing parsed yet — but there may be an upload still in flight. Saying so
    // lets every upload entry point hand the user straight here and have the
    // page wait, instead of each one having to poll before navigating.
    const { rows: pending } = await pool.query<{ parse_status: string; parse_error: string | null }>(
      `SELECT parse_status, parse_error
         FROM resumes
        WHERE user_id = $1 AND archived_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 1`,
      [user.id],
    )
    const status = pending[0]?.parse_status ?? null
    return NextResponse.json({
      hasResume: false,
      parsing: status === "pending" || status === "processing",
      parseFailed: status === "failed",
      parseError: pending[0]?.parse_error ?? null,
    })
  }

  // Judge the document against its own conventions: an academic CV is supposed
  // to be long, exhaustive, and unquantified.
  const kind = detectDocumentKind(resume)

  // Corpus-grounded scoring when field profiles are built; keyword signatures
  // until then. Both produce the same shape, so the review does not care which.
  const profiles = await getFieldProfiles(pool).catch(() => [])
  const grounded = profiles.length > 0
  const signal: ResumeSignal = grounded
    ? scoreResumeAgainstProfiles(resume, profiles)
    : detectResumeSignal(resume)

  // Brief for the lane the user chose, else the one the resume reads as — that
  // is the lane whose buried keywords and gaps are worth telling them about.
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

  // Only surfaces when a genuinely better-sponsoring adjacent field exists.
  const pivot = suggestPivotTarget(signal, profiles)

  const review = buildResumeReview({
    resume,
    signal,
    brief,
    pivot,
    kind,
    asOf: new Date().toISOString().slice(0, 7),
  })

  const wantNarrative = new URL(request.url).searchParams.get("narrate") === "1"
  let narrative: ReviewNarrative | null = null
  if (wantNarrative && anthropic && review.findings.length > 0) {
    // Keyed on the findings themselves: re-narrating identical findings is pure
    // spend, and any resume edit that matters changes a finding.
    const ck = cacheKey(
      "resume-review",
      user.id,
      stableHash(JSON.stringify(review.findings.map((f) => [f.id, f.observation, f.evidence]))),
    )
    narrative =
      apexCache.get<ReviewNarrative>(ck) ??
      (await narrateReview(anthropic, review, user.id).catch(() => null))
    if (narrative) apexCache.set(ck, narrative, CACHE_TTL.STRATEGY)
  }

  return NextResponse.json(
    {
      hasResume: true,
      grounded,
      resume: {
        id: resume.id,
        name: resume.name ?? resume.file_name,
        updatedAt: resume.updated_at,
      },
      readsAs: review.readsAs,
      documentKind: review.documentKind,
      documentKindLabel: review.documentKindLabel,
      documentKindSignals: review.documentKindSignals,
      publicationCount: kind.publicationCount,
      verdict: review.verdict,
      blockers: review.blockers,
      majors: review.majors,
      steps: narrative
        ? mergeNarrative(review, narrative)
        : review.findings.map((f) => ({ ...f, explanation: `${f.observation} ${f.cost}`, doThis: f.fix })),
      opening: narrative?.opening ?? review.verdict,
      firstMove: narrative?.firstMove ?? review.findings[0]?.fix ?? "",
      narrated: Boolean(narrative),
      narrativeSource: narrative?.source ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

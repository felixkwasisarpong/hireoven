import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { buildReviewContext, currentMonth, loadPrimaryResume } from "@/lib/resume/review-context"
import { mergeNarrative, narrateReview, type ReviewNarrative } from "@/lib/resume/review-narrative"
import { planFixes, questionsFor } from "@/lib/resume/fix-plan"
import { apexCache, CACHE_TTL, cacheKey, stableHash } from "@/lib/apex/budget/cache"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * "Why am I not getting interviews?" — the ranked diagnosis for the user's
 * primary resume, plus what of it can be fixed unattended.
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
  const resume = await loadPrimaryResume(pool, user.id)

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

  const { review, kind, grounded } = await buildReviewContext(pool, resume, currentMonth())

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

  // What the fix flow can do unattended, what it must ask about, and what is a
  // decision. Sent with the review so the UI can offer "fix everything" without
  // a second round trip.
  const plan = planFixes(review.findings)

  return NextResponse.json(
    {
      hasResume: true,
      grounded,
      resume: { id: resume.id, name: resume.name ?? resume.file_name, updatedAt: resume.updated_at },
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
      fixPlan: {
        auto: plan.auto,
        needsInput: plan.needsInput,
        manual: plan.manual,
        questions: questionsFor(plan),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

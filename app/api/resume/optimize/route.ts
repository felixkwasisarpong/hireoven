import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { buildReviewContext, currentMonth, loadPrimaryResume } from "@/lib/resume/review-context"
import { getFieldProfiles } from "@/lib/resume/field-profiles"
import { deriveLanes } from "@/lib/resume/lanes"
import { planFixes, questionsFor } from "@/lib/resume/fix-plan"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The guided optimisation flow — the lanes a résumé can be pointed at, and the
 * fix plan for the one the user picks.
 *
 * GET serves the lanes. POST takes the answers and returns the plan targeted at
 * that lane.
 *
 * The conversation state machine itself runs on the client: it is pure and tiny,
 * and keeping it there means answering a question does not cost a round trip.
 * The lane choice is still re-validated here against freshly derived lanes,
 * because "only offer lanes the résumé can carry" is a correctness property, not
 * a UI nicety — a stale tab or a hand-rolled request must not be able to target
 * a lane that was never on offer.
 */

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/**
 * Shared loader. Returns either a payload to send straight back (no résumé, or
 * one still parsing) or the context needed to derive lanes.
 */
async function loadLaneContext(userId: string) {
  const pool = getPostgresPool()
  const resume = await loadPrimaryResume(pool, userId)

  if (!resume) {
    // An upload may still be in flight. Reporting that lets every entry point
    // navigate here immediately and let this page wait, rather than each one
    // polling before it dares to route.
    const { rows } = await pool.query<{ parse_status: string; parse_error: string | null }>(
      `SELECT parse_status, parse_error
         FROM resumes
        WHERE user_id = $1 AND archived_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 1`,
      [userId],
    )
    const pending = rows[0]
    return {
      early: NextResponse.json({
        hasResume: false,
        parseStatus: pending?.parse_status ?? null,
        parseError: pending?.parse_error ?? null,
      }),
    } as const
  }

  const [context, profiles] = await Promise.all([
    buildReviewContext(pool, resume, currentMonth()),
    getFieldProfiles(pool).catch(() => []),
  ])

  return { early: null, resume, context, profiles } as const
}

export async function GET() {
  if (!hasPostgresEnv()) return NextResponse.json({ hasResume: false })

  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const loaded = await loadLaneContext(user.id)
  if (loaded.early) return loaded.early

  const { lanes, ambiguous } = deriveLanes(loaded.context.signal, loaded.profiles)

  return NextResponse.json(
    {
      hasResume: true,
      resume: {
        id: loaded.resume.id,
        name: loaded.resume.name ?? loaded.resume.file_name,
        fullName: loaded.resume.full_name,
      },
      /** False when field profiles are not built yet — the numbers are weaker. */
      grounded: loaded.context.grounded,
      lanes,
      ambiguous,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

export async function POST(request: Request) {
  if (!hasPostgresEnv()) return NextResponse.json({ hasResume: false })

  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    laneKey?: string
    industry?: string | null
  } | null

  const laneKey = body?.laneKey?.trim()
  if (!laneKey) {
    return NextResponse.json({ error: "laneKey is required" }, { status: 400 })
  }

  const loaded = await loadLaneContext(user.id)
  if (loaded.early) return loaded.early

  const { lanes } = deriveLanes(loaded.context.signal, loaded.profiles)
  const lane = lanes.find((l) => l.key === laneKey)
  if (!lane) {
    // Re-derived rather than trusted: see the note at the top of this file.
    return NextResponse.json(
      { error: "That lane is not one this résumé supports.", lanes },
      { status: 422 },
    )
  }

  const plan = planFixes(loaded.context.review.findings)

  return NextResponse.json(
    {
      hasResume: true,
      target: {
        lane,
        // Normalised to null so the client never has to know the sentinel.
        industry: body?.industry && body.industry !== "__any__" ? body.industry.trim() : null,
      },
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

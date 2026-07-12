import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"
import {
  createInterviewSession,
  listRecentSessions,
  listSessionsForJob,
  type InterviewPersona,
  type InterviewQuestionSet,
} from "@/lib/apex/interview/queries"
import {
  bookScheduledLiveSession,
  countPendingScheduledSessions,
  getJobContext,
  isValidTimeZone,
  resetRemindersForSession,
  validateScheduledAt,
} from "@/lib/interview/scheduling"
import { sendScheduleConfirmationEmail } from "@/lib/interview/confirmation-email"
import { creditsForDuration, getBalance } from "@/lib/apex/interview/credits"

export const runtime = "nodejs"

const VALID_TYPES = ["text", "live", "coding"] as const
const VALID_PERSONAS: InterviewPersona[] = [
  "friendly_recruiter",
  "skeptical_hm",
  "senior_staff",
  "founder",
  "panel",
]
const VALID_QUESTION_SETS: InterviewQuestionSet[] = [
  "recruiter_screen",
  "behavioral",
  "technical_screen",
  "system_design",
  "coding",
  "mixed",
]
const VALID_DURATIONS = [15, 30]

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = request.nextUrl
  const jobId = url.searchParams.get("jobId")
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50)

  try {
    if (jobId) {
      const sessions = await listSessionsForJob(user.id, jobId)
      return NextResponse.json({
        sessions: sessions.map((s) => ({ ...s, debrief: null, jobTitle: null, jobCompany: null })),
      })
    }

    const sessions = await listRecentSessions(user.id, limit)
    return NextResponse.json({ sessions })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch sessions" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    jobId?: string | null
    type?: string
    persona?: string
    questionSet?: string
    durationTargetMin?: number
    useResumeContext?: boolean
    scheduledAt?: string
    timezone?: string
  }

  if (!VALID_TYPES.includes(body.type as typeof VALID_TYPES[number])) {
    return NextResponse.json({ error: "type must be text, live, or coding" }, { status: 400 })
  }
  if (!VALID_PERSONAS.includes(body.persona as InterviewPersona)) {
    return NextResponse.json({ error: "Invalid persona" }, { status: 400 })
  }
  if (!VALID_QUESTION_SETS.includes(body.questionSet as InterviewQuestionSet)) {
    return NextResponse.json({ error: "Invalid questionSet" }, { status: 400 })
  }
  if (!VALID_DURATIONS.includes(body.durationTargetMin!)) {
    return NextResponse.json({ error: "durationTargetMin must be 15, 30, 45, or 60" }, { status: 400 })
  }
  if (typeof body.useResumeContext !== "boolean") {
    return NextResponse.json({ error: "useResumeContext must be a boolean" }, { status: 400 })
  }

  const type = body.type as typeof VALID_TYPES[number]
  // coding type always uses coding question set
  const questionSet = type === "coding" ? "coding" : (body.questionSet as InterviewQuestionSet)

  // Optional scheduling — live sessions can be booked for a future slot
  // instead of starting immediately.
  let scheduledAt: Date | null = null
  let scheduledTimezone: string | null = null
  if (body.scheduledAt !== undefined) {
    if (type !== "live") {
      return NextResponse.json({ error: "Only live interviews can be scheduled" }, { status: 400 })
    }
    const validated = validateScheduledAt(body.scheduledAt)
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })
    scheduledAt = validated.scheduledAt
    scheduledTimezone = body.timezone && isValidTimeZone(body.timezone) ? body.timezone : null
  }
  const feature = type === "live" ? "interview_live" : "interview_prep"
  const plan = await getPlanForUserId(user.id)
  if (!canAccess(plan, feature)) {
    const needed = requiredPlanFor(feature)
    return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
  }

  // If jobId provided, verify the user owns an application for that job
  if (body.jobId) {
    const pool = getPostgresPool()
    const ownershipCheck = await pool.query<{ id: string }>(
      `SELECT id FROM job_applications
       WHERE user_id = $1 AND job_id = $2::uuid AND is_archived = false
       LIMIT 1`,
      [user.id, body.jobId]
    )
    if (ownershipCheck.rows.length === 0) {
      return NextResponse.json({ error: "Job not found in your pipeline" }, { status: 403 })
    }
  }

  // Scheduled booking path — gate on credits up front (credits are deducted at
  // join time, so require enough to cover every not-yet-started booking), then
  // enforce slot capacity atomically.
  if (scheduledAt) {
    const cost = creditsForDuration(body.durationTargetMin!)
    const [creditBalance, pendingCount] = await Promise.all([
      getBalance(user.id, plan),
      countPendingScheduledSessions(user.id),
    ])
    const needed = cost * (pendingCount + 1)
    if (creditBalance.balance < needed) {
      return NextResponse.json(
        {
          error:
            pendingCount > 0
              ? `You need ${needed} credits to cover your ${pendingCount + 1} scheduled sessions but have ${creditBalance.balance}. Buy a credit pack to schedule this one.`
              : "Not enough live interview credits — buy a credit pack to schedule this session.",
          code: "INSUFFICIENT_CREDITS",
          balance: creditBalance.balance,
          needed,
        },
        { status: 402 }
      )
    }

    try {
      const booking = await bookScheduledLiveSession({
        userId: user.id,
        jobId: body.jobId ?? null,
        persona: body.persona as InterviewPersona,
        questionSet,
        durationTargetMin: body.durationTargetMin!,
        useResumeContext: body.useResumeContext,
        scheduledAt,
        scheduledTimezone,
      })
      if (!booking.ok) {
        return NextResponse.json(
          { error: "That time slot is fully booked — pick another slot" },
          { status: 409 }
        )
      }

      // Side effects are best-effort — the booking stands even if they fail.
      try {
        await resetRemindersForSession(booking.sessionId, user.id, scheduledAt)
      } catch (err) {
        console.error("[interview] reminder creation failed:", err)
      }
      try {
        const { jobTitle, jobCompany } = await getJobContext(body.jobId ?? null)
        await sendScheduleConfirmationEmail({
          userId: user.id,
          sessionId: booking.sessionId,
          scheduledAt,
          timeZone: scheduledTimezone,
          durationMin: body.durationTargetMin!,
          jobTitle,
          jobCompany,
        })
      } catch (err) {
        console.error("[interview] schedule confirmation email failed:", err)
      }

      return NextResponse.json(
        {
          sessionId: booking.sessionId,
          scheduledAt: scheduledAt.toISOString(),
          redirectTo: `/dashboard/interview/scheduled/${booking.sessionId}`,
        },
        { status: 201 }
      )
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to schedule session" },
        { status: 500 }
      )
    }
  }

  try {
    const session = await createInterviewSession({
      userId: user.id,
      jobId: body.jobId ?? null,
      type,
      persona: body.persona as InterviewPersona,
      questionSet,
      durationTargetMin: body.durationTargetMin!,
      useResumeContext: body.useResumeContext,
    })

    return NextResponse.json(
      {
        sessionId: session.id,
        redirectTo: `/dashboard/interview/${type}/${session.id}`,
      },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create session" },
      { status: 500 }
    )
  }
}

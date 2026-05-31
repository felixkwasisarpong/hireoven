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

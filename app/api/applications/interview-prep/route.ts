import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"
import { requireFeature } from "@/lib/gates/server-gate"

export const runtime = "nodejs"

const anthropic = new Anthropic()

export async function POST(request: NextRequest) {
  const gate = await requireFeature("interview_prep", request)
  if (gate instanceof NextResponse) return gate

  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user!
  const pool = getPostgresPool()

  const body = await request.json().catch(() => ({})) as {
    applicationId?: string
    mode?: "questions" | "evaluate"
    answer?: string
    question?: string
  }

  if (!body.applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 })
  }

  const appResult = await pool.query<{
    company_name: string | null
    job_title: string | null
    notes: string | null
    interviews: Array<{ round_name?: string }> | null
  }>(
    `SELECT company_name, job_title, notes, interviews
     FROM job_applications
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [body.applicationId, user.id]
  )
  const app = appResult.rows[0]

  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (body.mode === "evaluate") {
    if (!body.answer || !body.question) {
      return NextResponse.json({ error: "answer and question required for evaluate mode" }, { status: 400 })
    }

    const message = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: `You are an interview coach. Evaluate this interview answer and give brief, actionable feedback.

Role: ${app.job_title} at ${app.company_name}
Question: ${body.question}
Answer: ${body.answer}

Respond in JSON: { "score": 1-10, "strengths": ["..."], "improvements": ["..."], "better_answer_tip": "one sentence" }`,
      }],
    })

    const text = message.content[0].type === "text" ? message.content[0].text : ""
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { score: 7, strengths: [], improvements: [], better_answer_tip: "" }
      return NextResponse.json(parsed)
    } catch {
      return NextResponse.json({ score: 7, strengths: [], improvements: [], better_answer_tip: text })
    }
  }

  // Default: generate questions
  const interviewContext = app.interviews?.length
    ? `Previous rounds: ${app.interviews.map((i: any) => i.round_name).join(", ")}`
    : "No prior rounds"

  const message = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1200,
    messages: [{
      role: "user",
      content: `Generate 8 targeted interview questions for a ${app.job_title} role at ${app.company_name}.
${interviewContext}
${app.notes ? `Context: ${app.notes}` : ""}

Mix: 2 behavioral, 2 technical/role-specific, 2 company/culture fit, 1 situational, 1 curveball.

Respond in JSON: { "questions": [{ "id": "q1", "category": "behavioral|technical|culture|situational|curveball", "question": "...", "hint": "brief tip on what they want to hear" }] }`,
    }],
  })

  const text = message.content[0].type === "text" ? message.content[0].text : ""
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { questions: [] }
    return NextResponse.json(parsed)
  } catch {
    return NextResponse.json({ questions: [] })
  }
}

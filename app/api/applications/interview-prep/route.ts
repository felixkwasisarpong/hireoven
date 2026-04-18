import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"

export const runtime = "nodejs"

const anthropic = new Anthropic()

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    applicationId?: string
    mode?: "questions" | "evaluate"
    answer?: string
    question?: string
  }

  if (!body.applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 })
  }

  const { data: app } = await (supabase as any)
    .from("job_applications")
    .select("company_name, job_title, notes, interviews")
    .eq("id", body.applicationId)
    .eq("user_id", user.id)
    .single()

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

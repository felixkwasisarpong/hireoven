import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { HAIKU_MODEL } from "@/lib/ai/anthropic-models"
import { getInterviewSession } from "@/lib/scout/interview/queries"
import { deriveSkillList } from "@/lib/scout/interview/context"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"

export const runtime = "nodejs"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const plan = await getPlanForUserId(user.id)
  if (!canAccess(plan, "interview_prep")) {
    const needed = requiredPlanFor("interview_prep")
    return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
  }

  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await request.json().catch(() => ({})) as { content?: string }
  const content = (body.content ?? "").trim()
  if (!content) return NextResponse.json({ skill_tag: null })

  try {
    const skillList = deriveSkillList(session.questionSet)
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

    const res = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 50,
      messages: [{
        role: "user",
        content: `Given this interviewer question, output ONLY the most relevant skill tag from this list (one tag, exact match, no other text):
Skills: ${skillList.join(", ")}

Question: "${content}"

Output just the tag name.`,
      }],
    })

    const tag = (res.content[0] as { type: string; text: string }).text.trim().toLowerCase()
    const matched = skillList.find((s) => s.toLowerCase() === tag) ?? null

    return NextResponse.json({ skill_tag: matched })
  } catch {
    return NextResponse.json({ skill_tag: null })
  }
}

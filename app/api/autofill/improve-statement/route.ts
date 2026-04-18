import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import { logApiUsage } from "@/lib/admin/usage"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const maxDuration = 30

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!anthropic) return NextResponse.json({ error: "AI not configured" }, { status: 503 })

  const body = await request.json().catch(() => ({})) as {
    statement?: string
    visaStatus?: string
    optEndDate?: string
  }

  const { statement, visaStatus, optEndDate } = body
  if (!statement?.trim()) {
    return NextResponse.json({ error: "statement is required" }, { status: 400 })
  }

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    system:
      "You rewrite visa sponsorship statements for job applications. Make them confident, honest, and professional — not apologetic. One or two sentences. Return only the rewritten statement, no explanation.",
    messages: [
      {
        role: "user",
        content: `Rewrite this sponsorship statement to sound more confident and natural:

"${statement}"

Context: visa status is ${visaStatus ?? "not specified"}${optEndDate ? `, OPT/STEM OPT end date: ${optEndDate}` : ""}.

Return only the improved statement.`,
      },
    ],
  })

  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  await logApiUsage({
    service: "claude",
    operation: "improve_sponsorship_statement",
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number((((inputTokens / 1_000_000) * 3) + ((outputTokens / 1_000_000) * 15)).toFixed(6)),
  })

  const improved = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    .replace(/^["']|["']$/g, "")

  return NextResponse.json({ statement: improved })
}

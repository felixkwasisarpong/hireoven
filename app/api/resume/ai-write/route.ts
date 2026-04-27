import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { logApiUsage } from "@/lib/admin/usage"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null
const MODEL = "claude-sonnet-4-6"
const MODEL_PRICING = { inputPerMillion: 3, outputPerMillion: 15 }

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function fallbackText(sectionType: string, currentText: string, targetRole: string) {
  if (sectionType === "profile") {
    return `Results-driven ${targetRole || "professional"} with experience building reliable systems, collaborating across teams, and translating complex requirements into measurable product outcomes. Strong focus on clean implementation, cloud-ready architecture, and truthful impact.`
  }

  if (sectionType === "experience") {
    const lines = currentText
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-•]\s*/, "").trim())
      .filter(Boolean)

    return (lines.length ? lines : ["Owned reliable delivery across technical projects"]).map((line) =>
      `• Improved ${line.toLowerCase()} with clearer ownership, technical context, and measurable business impact.`
    ).join("\n")
  }

  if (sectionType === "skills") {
    return currentText
      .split(/[\n,|]/)
      .map((item) => item.replace(/^[^:]+:/, "").trim())
      .filter(Boolean)
      .slice(0, 18)
      .join(", ")
  }

  return currentText
    ? `${currentText}\n• Refined for clearer resume language, stronger relevance, and concise impact.`
    : "Add truthful, role-relevant details with concrete tools, scope, and measurable outcomes."
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const sectionType = asString(body.sectionType) || "custom"
  const currentText = asString(body.currentText)
  const instruction = asString(body.instruction)
  const targetRole = asString(body.targetRole)
  const jobDescription = asString(body.jobDescription)

  if (!anthropic) {
    return NextResponse.json({ text: fallbackText(sectionType, currentText, targetRole), source: "fallback" })
  }

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 900,
    system:
      "You are Hireoven's resume section editor. Rewrite only the requested resume section. Return plain text only. Do not use markdown fences. Do not fabricate employers, degrees, dates, metrics, credentials, skills, or experience. Preserve truthfulness and keep language ATS-friendly.",
    messages: [
      {
        role: "user",
        content: `Section type: ${sectionType}
Target role/headline: ${targetRole || "Not specified"}
Optional instruction: ${instruction || "Improve clarity, concision, and measurable impact."}
${jobDescription ? `Job description context. Use only for language alignment, never to invent experience:\n${jobDescription.slice(0, 3000)}` : ""}

Current section text:
${currentText || "Empty section"}

Return only the rewritten section text.`,
      },
    ],
  })

  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  const costUsd =
    (inputTokens / 1_000_000) * MODEL_PRICING.inputPerMillion +
    (outputTokens / 1_000_000) * MODEL_PRICING.outputPerMillion

  await logApiUsage({
    service: "claude",
    operation: "resume_ai_write",
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(costUsd.toFixed(6)),
  })

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim()

  return NextResponse.json({ text: text || fallbackText(sectionType, currentText, targetRole), source: "claude" })
}

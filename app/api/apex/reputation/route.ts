import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  buildEmptyBreakdown,
  scoreFromBreakdown,
  verdictFromScore,
  buildResearchLinks,
  type ReputationGuardResult,
} from "@/lib/apex/reputation/scorer"
import { buildReputationPrompt } from "@/lib/apex/reputation/prompts"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"

const anthropic = new Anthropic()

function err(status: number, msg: string) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * POST /api/apex/reputation
 * Body: { companyName, jobTitle, jobDescription?, companyId? }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err(401, "Unauthorized")

  const body = await req.json().catch(() => null)
  if (!body?.companyName) return err(400, "companyName is required")

  const { companyName, jobTitle = "Unknown Role", jobDescription = "" } = body

  const breakdown = buildEmptyBreakdown()
  let watchouts: string[] = []
  let greenLights: string[] = []
  let verdictSummary = ""
  let confidence = 0.2

  try {
    const msg = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: buildReputationPrompt(companyName, jobTitle, jobDescription),
      }],
    })

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : ""
    const jsonMatch = raw.match(/\{[\s\S]*\}/)

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      for (const dim of ["offer_integrity", "interview_quality", "tc_accuracy", "culture_honesty"] as const) {
        if (parsed[dim]) {
          breakdown[dim].score = Math.min(25, Math.max(0, parsed[dim].score ?? 12))
          breakdown[dim].signals = parsed[dim].signals ?? []
        }
      }
      watchouts = parsed.watchouts ?? []
      greenLights = parsed.greenLights ?? []
      verdictSummary = parsed.verdictSummary ?? ""
      confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0.2))
    }
  } catch {
    verdictSummary = `We don't have enough data on ${companyName} to score them reliably. Use the research links below to investigate.`
  }

  const overallScore = scoreFromBreakdown(breakdown)
  const overallVerdict = verdictFromScore(overallScore)

  const result: ReputationGuardResult = {
    companyName,
    overallScore,
    overallVerdict,
    verdictSummary,
    breakdown,
    watchouts,
    greenLights,
    researchLinks: buildResearchLinks(companyName),
    confidence,
    analyzedAt: new Date().toISOString(),
  }

  return NextResponse.json(result)
}

import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { runRuleBasedDecode } from "@/lib/apex/jd-decoder/analyzer"
import { buildJDDecodePrompt } from "@/lib/apex/jd-decoder/prompts"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"

const anthropic = new Anthropic()

function err(status: number, msg: string) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * POST /api/apex/jd-decode
 * Body: { title, description, resumeSummary? }
 *
 * Returns a full JDDecodeResult combining fast rule-based analysis
 * with a Claude deep-read for hidden expectations, must-haves, and TLDR.
 */

/** Server-side plan gate — this endpoint exposes the paid "apex_deep_analysis" feature. */
async function requirePlanGate(userId: string) {
  const plan = await getPlanForUserId(userId)
  if (canAccess(plan, "apex_deep_analysis")) return null
  const needed = requiredPlanFor("apex_deep_analysis")
  return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err(401, "Unauthorized")
  const planGate = await requirePlanGate(user.id)
  if (planGate) return planGate

  const body = await req.json().catch(() => null)
  if (!body?.title || !body?.description) return err(400, "title and description are required")

  const { title, description, resumeSummary } = body

  // Fast rule-based pass (synchronous)
  const ruleResult = runRuleBasedDecode(title, description)

  // Deep AI pass — Claude reads the full JD
  let aiResult: {
    mustHaves: string[]
    niceToHaves: string[]
    hiddenExpectations: string[]
    tldr: string
    overallScore: number
    additionalRedFlags: typeof ruleResult.redFlags
    additionalGreenSignals: string[]
  } = {
    mustHaves: [],
    niceToHaves: [],
    hiddenExpectations: [],
    tldr: "",
    overallScore: 50,
    additionalRedFlags: [],
    additionalGreenSignals: [],
  }

  try {
    const msg = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: buildJDDecodePrompt(title, description, resumeSummary),
      }],
    })
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : ""
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      aiResult = JSON.parse(jsonMatch[0])
    }
  } catch {
    // Gracefully degrade to rule-based only
  }

  const merged = {
    ...ruleResult,
    redFlags: [
      ...ruleResult.redFlags,
      ...(aiResult.additionalRedFlags ?? []),
    ],
    greenSignals: [
      ...ruleResult.greenSignals,
      ...(aiResult.additionalGreenSignals ?? []),
    ],
    mustHaves: aiResult.mustHaves,
    niceToHaves: aiResult.niceToHaves,
    hiddenExpectations: aiResult.hiddenExpectations,
    tldr: aiResult.tldr,
    overallScore: aiResult.overallScore ?? 50,
  }

  return NextResponse.json(merged)
}

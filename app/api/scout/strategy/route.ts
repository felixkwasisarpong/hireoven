import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logApiUsage } from "@/lib/admin/usage"
import { getScoutStrategyBoard } from "@/lib/scout/strategy"
import { getScoutContext } from "@/lib/scout/context"
import {
  STRATEGY_SYSTEM_PROMPT,
  formatStrategyContext,
  parseStrategyResponse,
} from "@/lib/scout/strategy-prompt"
import type { ScoutAIStrategy, ScoutAIStrategyGated } from "@/lib/scout/types"
import { getUserPlan } from "@/lib/gates/server-gate"
import { canAccess } from "@/lib/gates"

export const runtime = "nodejs"
export const maxDuration = 30

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const MODEL = "claude-sonnet-4-6"
const MODEL_PRICING = { inputPerMillion: 3, outputPerMillion: 15 }

/** GET /api/scout/strategy — returns the deterministic strategy board */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const board = await getScoutStrategyBoard(user.id)
    return NextResponse.json({ board })
  } catch (error) {
    console.error("Scout strategy board error:", error)
    return NextResponse.json(
      { error: "Unable to load Scout strategy board right now." },
      { status: 500 }
    )
  }
}

/** POST /api/scout/strategy — generates an AI weekly strategy plan */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!anthropic) {
    return NextResponse.json(
      { error: "AI service is not configured." },
      { status: 503 }
    )
  }

  const { plan } = await getUserPlan(request)
  const isPremium = canAccess(plan, "scout_strategy")

  try {
    // Build Scout context + strategy board data in parallel
    const [context, board] = await Promise.all([
      getScoutContext({ userId: user.id, mode: "scout" }),
      getScoutStrategyBoard(user.id),
    ])

    const contextStr = formatStrategyContext(context, board)

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: STRATEGY_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: contextStr,
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
      operation: "scout_strategy",
      tokens_used: inputTokens + outputTokens,
      cost_usd: Number(costUsd.toFixed(6)),
    })

    const responseText = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim()

    const strategy = parseStrategyResponse(responseText, context.resume?.id)

    if (!strategy) {
      console.error(
        "[scout/strategy] parseStrategyResponse returned null.",
        `stop_reason=${message.stop_reason}`,
        `output_tokens=${outputTokens}`,
        "\nRaw Claude response:\n",
        responseText.slice(0, 2000)
      )
      return NextResponse.json(
        { error: "Scout was unable to generate a strategy right now. Please try again." },
        { status: 500 }
      )
    }

    // ── Apply gating for free users ──
    if (!isPremium) {
      const freeStrategy: ScoutAIStrategy = {
        focus: strategy.focus,
        thisWeek: strategy.thisWeek,
        // Locked sections return empty for free users
        prioritize: [],
        avoid: [],
        improve: [],
        // Free users can still get filter/focus mode actions (no tailor)
        actions: strategy.actions.filter(
          (a) => a.type === "SET_FOCUS_MODE" || a.type === "APPLY_FILTERS"
        ),
      }
      const gated: ScoutAIStrategyGated = {
        feature: "scout_strategy",
        upgradeMessage:
          "Upgrade to Scout Pro to unlock your full strategy: priority targets, what to avoid, and specific resume improvements.",
        lockedSections: ["prioritize", "avoid", "improve"],
      }
      return NextResponse.json({ strategy: freeStrategy, gated, isPremium: false })
    }

    return NextResponse.json({ strategy, gated: null, isPremium: true })
  } catch (error) {
    console.error("Scout AI strategy error:", error)
    return NextResponse.json(
      { error: "Unable to generate strategy right now. Please try again." },
      { status: 500 }
    )
  }
}

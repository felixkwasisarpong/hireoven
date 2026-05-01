import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getScoutStrategyBoard } from "@/lib/scout/strategy"
import { getScoutContext } from "@/lib/scout/context"
import {
  STRATEGY_SYSTEM_PROMPT,
  formatStrategyContext,
  parseStrategyResponse,
} from "@/lib/scout/strategy-prompt"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { withAICall, recordCacheHit } from "@/lib/scout/budget/ai-call"
import { scoutCache, CACHE_TTL, cacheKey } from "@/lib/scout/budget/cache"
import { AI_TIMEOUTS } from "@/lib/scout/budget/router"
import type { ScoutAIStrategy, ScoutAIStrategyGated } from "@/lib/scout/types"
import { getUserPlan } from "@/lib/gates/server-gate"
import { canAccess } from "@/lib/gates"

export const runtime = "nodejs"
export const maxDuration = 30

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

// Strategy planning needs stronger reasoning than extraction/cleanup tasks.
const MODEL = SONNET_MODEL

function scoutError(status: number, message: string) {
  return NextResponse.json({ ok: false, status, message, error: message }, { status })
}

/** GET /api/scout/strategy — returns the deterministic strategy board */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return scoutError(401, "Unauthorized")
  }

  try {
    const board = await getScoutStrategyBoard(user.id)
    return NextResponse.json({ board })
  } catch (error) {
    console.error("Scout strategy board error:", error)
    return scoutError(500, "Unable to load Scout strategy board right now.")
  }
}

/** POST /api/scout/strategy — generates an AI weekly strategy plan */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return scoutError(401, "Unauthorized")
  }

  if (!anthropic) {
    return scoutError(503, "AI service is not configured.")
  }

  const { plan } = await getUserPlan(request)
  const isPremium = canAccess(plan, "scout_strategy")

  try {
    // Check cache before hitting AI — strategy changes at most daily
    const ck = cacheKey("strategy", user.id)
    const cached = scoutCache.get<{ strategy: ScoutAIStrategy; resumeId?: string }>(ck)
    if (cached) {
      recordCacheHit("scout_strategy", MODEL, user.id)
      const strategy = cached.strategy
      if (!isPremium) {
        const freeStrategy: ScoutAIStrategy = {
          focus:      strategy.focus,
          thisWeek:   strategy.thisWeek,
          prioritize: [],
          avoid:      [],
          improve:    [],
          actions:    strategy.actions.filter((a) => a.type === "SET_FOCUS_MODE" || a.type === "APPLY_FILTERS"),
        }
        const gated: ScoutAIStrategyGated = {
          feature: "scout_strategy",
          upgradeMessage: "Upgrade to Scout Pro to unlock your full strategy: priority targets, what to avoid, and specific resume improvements.",
          lockedSections: ["prioritize", "avoid", "improve"],
        }
        return NextResponse.json({ strategy: freeStrategy, gated, isPremium: false, cached: true })
      }
      return NextResponse.json({ strategy, gated: null, isPremium: true, cached: true })
    }

    // Build Scout context + strategy board data in parallel
    const [context, board] = await Promise.all([
      getScoutContext({ userId: user.id, mode: "scout" }),
      getScoutStrategyBoard(user.id),
    ])

    const contextStr = formatStrategyContext(context, board)

    const { value: strategy, timedOut } = await withAICall({
      anthropic,
      feature:   "scout_strategy",
      timeoutMs: AI_TIMEOUTS.scout_strategy,
      params: {
        model:      MODEL,
        max_tokens: 2000,
        system:     STRATEGY_SYSTEM_PROMPT,
        messages:   [{ role: "user", content: contextStr }],
      },
      parse:    (text) => parseStrategyResponse(text, context.resume?.id),
      fallback: () => null,
      userId:   user.id,
    })

    if (timedOut) {
      return scoutError(503, "Strategy planning is taking longer than expected. Please try again in a moment.")
    }

    if (!strategy) {
      return scoutError(500, "Scout was unable to generate a strategy right now. Please try again.")
    }

    // Cache full strategy for 24h — invalidated on resume update (handled separately)
    scoutCache.set(ck, { strategy }, CACHE_TTL.STRATEGY)

    // ── Apply gating for free users ──
    if (!isPremium) {
      const freeStrategy: ScoutAIStrategy = {
        focus:      strategy.focus,
        thisWeek:   strategy.thisWeek,
        prioritize: [],
        avoid:      [],
        improve:    [],
        actions:    strategy.actions.filter((a) => a.type === "SET_FOCUS_MODE" || a.type === "APPLY_FILTERS"),
      }
      const gated: ScoutAIStrategyGated = {
        feature: "scout_strategy",
        upgradeMessage: "Upgrade to Scout Pro to unlock your full strategy: priority targets, what to avoid, and specific resume improvements.",
        lockedSections: ["prioritize", "avoid", "improve"],
      }
      return NextResponse.json({ strategy: freeStrategy, gated, isPremium: false })
    }

    return NextResponse.json({ strategy, gated: null, isPremium: true })
  } catch (error) {
    console.error("Scout AI strategy error:", error)
    return scoutError(500, "Unable to generate strategy right now. Please try again.")
  }
}

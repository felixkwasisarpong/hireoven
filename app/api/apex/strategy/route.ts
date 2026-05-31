import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getApexStrategyBoard } from "@/lib/apex/strategy"
import { getApexContext } from "@/lib/apex/context"
import {
  STRATEGY_SYSTEM_PROMPT,
  formatStrategyContext,
  parseStrategyResponse,
} from "@/lib/apex/strategy-prompt"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { withAICall, recordCacheHit } from "@/lib/apex/budget/ai-call"
import { apexCache, CACHE_TTL, cacheKey } from "@/lib/apex/budget/cache"
import { AI_TIMEOUTS } from "@/lib/apex/budget/router"
import type { ApexAIStrategy, ApexAIStrategyGated } from "@/lib/apex/types"
import { getUserPlan } from "@/lib/gates/server-gate"
import { canAccess } from "@/lib/gates"
import { requireQuota } from "@/lib/usage/server-quota"
import { sanitizeGeneratedText } from "@/lib/text/sanitize-generated-text"

export const runtime = "nodejs"
export const maxDuration = 30

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

// Strategy planning needs stronger reasoning than extraction/cleanup tasks.
const MODEL = SONNET_MODEL

function apexError(status: number, message: string) {
  return NextResponse.json({ ok: false, status, message, error: message }, { status })
}

/** GET /api/apex/strategy — returns the deterministic strategy board */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apexError(401, "Unauthorized")
  }

  try {
    const board = await getApexStrategyBoard(user.id)
    return NextResponse.json({ board })
  } catch (error) {
    console.error("Apex strategy board error:", error)
    return apexError(500, "Unable to load Apex strategy board right now.")
  }
}

/** POST /api/apex/strategy — generates an AI weekly strategy plan */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apexError(401, "Unauthorized")
  }

  if (!anthropic) {
    return apexError(503, "AI service is not configured.")
  }

  const { plan } = await getUserPlan(request)
  const isPremium = canAccess(plan, "apex_strategy")

  try {
    // Check cache before hitting AI — strategy changes at most daily
    const ck = cacheKey("strategy", user.id)
    const cached = apexCache.get<{ strategy: ApexAIStrategy; resumeId?: string }>(ck)
    if (cached) {
      recordCacheHit("apex_strategy", MODEL, user.id)
      const strategy = cached.strategy
      if (!isPremium) {
        const freeStrategy: ApexAIStrategy = {
          focus:      strategy.focus,
          thisWeek:   strategy.thisWeek,
          prioritize: [],
          avoid:      [],
          improve:    [],
          actions:    strategy.actions.filter((a) => a.type === "SET_FOCUS_MODE" || a.type === "APPLY_FILTERS"),
        }
        const gated: ApexAIStrategyGated = {
          feature: "apex_strategy",
          upgradeMessage: "Upgrade to Apex Pro to unlock your full strategy: priority targets, what to avoid, and specific resume improvements.",
          lockedSections: ["prioritize", "avoid", "improve"],
        }
        return NextResponse.json(sanitizeGeneratedText({ strategy: freeStrategy, gated, isPremium: false, cached: true }))
      }
      return NextResponse.json(sanitizeGeneratedText({ strategy, gated: null, isPremium: true, cached: true }))
    }

    // Cache miss → this call will hit the LLM. Charge a strategy credit.
    const quota = await requireQuota(user.id, "apex_strategy", plan)
    if (quota instanceof NextResponse) return quota

    // Build Apex context + strategy board data in parallel
    const [context, board] = await Promise.all([
      getApexContext({ userId: user.id, mode: "apex" }),
      getApexStrategyBoard(user.id),
    ])

    const contextStr = formatStrategyContext(context, board)

    const { value: strategy, timedOut } = await withAICall({
      anthropic,
      feature:   "apex_strategy",
      timeoutMs: AI_TIMEOUTS.apex_strategy,
      params: {
        model:      MODEL,
        max_tokens: 2000,
        // Ephemeral prompt caching for the static strategy preamble.
        system:     [{ type: "text", text: STRATEGY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages:   [{ role: "user", content: contextStr }],
      },
      parse:    (text) => parseStrategyResponse(text, context.resume?.id),
      fallback: () => null,
      userId:   user.id,
    })

    if (timedOut) {
      return apexError(503, "Strategy planning is taking longer than expected. Please try again in a moment.")
    }

    if (!strategy) {
      return apexError(500, "Apex was unable to generate a strategy right now. Please try again.")
    }

    // Cache full strategy for 24h — invalidated on resume update (handled separately)
    apexCache.set(ck, { strategy }, CACHE_TTL.STRATEGY)

    // ── Apply gating for free users ──
    if (!isPremium) {
      const freeStrategy: ApexAIStrategy = {
        focus:      strategy.focus,
        thisWeek:   strategy.thisWeek,
        prioritize: [],
        avoid:      [],
        improve:    [],
        actions:    strategy.actions.filter((a) => a.type === "SET_FOCUS_MODE" || a.type === "APPLY_FILTERS"),
      }
      const gated: ApexAIStrategyGated = {
        feature: "apex_strategy",
        upgradeMessage: "Upgrade to Apex Pro to unlock your full strategy: priority targets, what to avoid, and specific resume improvements.",
        lockedSections: ["prioritize", "avoid", "improve"],
      }
      return NextResponse.json(sanitizeGeneratedText({ strategy: freeStrategy, gated, isPremium: false }))
    }

    return NextResponse.json(sanitizeGeneratedText({ strategy, gated: null, isPremium: true }))
  } catch (error) {
    console.error("Apex AI strategy error:", error)
    return apexError(500, "Unable to generate strategy right now. Please try again.")
  }
}

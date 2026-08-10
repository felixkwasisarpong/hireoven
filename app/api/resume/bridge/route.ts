import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { detectResumeSignal, scoreResumeAgainstProfiles, type ResumeSignal } from "@/lib/resume/signal"
import { getFieldProfiles } from "@/lib/resume/field-profiles"
import { computeBridgePath } from "@/lib/resume/bridge"
import { reasonOverBridge, type BridgeReasoning } from "@/lib/resume/bridge-reasoning"
import { apexCache, CACHE_TTL, cacheKey, stableHash } from "@/lib/apex/budget/cache"
import type { Resume } from "@/types"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Career pivot: how does the user get from the field their resume reads as to a
// target field? GET ?to=<field_key> (optionally ?from=<field_key>) returns the
// ranked signal (so the UI knows the current lane + can offer targets) and, when
// `to` is set, the bridge path.
export async function GET(request: Request) {
  if (!hasPostgresEnv()) return NextResponse.json({ hasResume: false })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const { rows } = await pool.query<
    Pick<Resume, "primary_role" | "top_skills" | "skills" | "work_experience" | "industries" | "summary" | "raw_text">
  >(
    `SELECT primary_role, top_skills, skills, work_experience, industries, summary, raw_text
       FROM resumes
      WHERE user_id = $1 AND archived_at IS NULL AND parse_status = 'complete'
      ORDER BY is_primary DESC, updated_at DESC
      LIMIT 1`,
    [user.id],
  )

  const resume = rows[0]
  if (!resume) return NextResponse.json({ hasResume: false })

  const profiles = await getFieldProfiles(pool).catch(() => [])
  const grounded = profiles.length > 0
  const signal: ResumeSignal = grounded ? scoreResumeAgainstProfiles(resume, profiles) : detectResumeSignal(resume)

  const url = new URL(request.url)
  const to = url.searchParams.get("to")
  // Default the origin field to the one the resume reads strongest as.
  const from = url.searchParams.get("from") ?? signal.primary?.key ?? null
  const wantReason = url.searchParams.get("reason") === "1"

  const bridge = to && from ? await computeBridgePath(pool, resume, from, to).catch(() => null) : null

  // AI reasoning is opt-in (?reason=1) so picking a target stays instant and free;
  // the LLM only runs when the user explicitly asks for the plan. Grounded strictly
  // in the computed bridge facts, cached per user + field pair + facts hash.
  let reasoning: BridgeReasoning | null = null
  if (wantReason && bridge && anthropic) {
    const ck = cacheKey(
      "bridge-reason",
      user.id,
      from,
      to,
      stableHash(
        JSON.stringify([
          bridge.overlapPct,
          bridge.targetFit,
          bridge.transferable,
          bridge.toBuild,
          bridge.bridgeRoles.map((r) => [r.title, r.count]),
        ]),
      ),
    )
    reasoning =
      apexCache.get<BridgeReasoning>(ck) ??
      (await reasonOverBridge(anthropic, bridge, user.id).catch(() => null))
    if (reasoning) apexCache.set(ck, reasoning, CACHE_TTL.STRATEGY)
  }

  return NextResponse.json(
    { hasResume: true, grounded, signal, from, bridge, reasoning },
    { headers: { "Cache-Control": "no-store" } },
  )
}

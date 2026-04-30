import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildResearchTask } from "@/lib/scout/research/tasks"
import { runResearchEngine } from "@/lib/scout/research/engine"
import { encodeResearchSSE } from "@/lib/scout/research/types"
import type { ResearchSSEEvent } from "@/lib/scout/research/types"
import { logApiUsage } from "@/lib/admin/usage"

export const runtime    = "nodejs"
export const maxDuration = 35   // 30 s engine + 5 s buffer

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI service not configured" }, { status: 503 })
  }

  const body = await request.json().catch(() => ({})) as { message?: string }
  const objective = body.message?.trim()

  if (!objective) {
    return NextResponse.json({ error: "message is required" }, { status: 400 })
  }

  const { task, type } = buildResearchTask(objective)
  const { getPostgresPool } = await import("@/lib/postgres/server")
  const pool = getPostgresPool()

  const enc = new TextEncoder()
  let ctrl!: ReadableStreamDefaultController<Uint8Array>

  const sseStream = new ReadableStream<Uint8Array>({
    start: (c) => { ctrl = c },
  })

  const emit = (event: ResearchSSEEvent) => {
    try { ctrl.enqueue(enc.encode(encodeResearchSSE(event))) } catch {}
  }

  void (async () => {
    // Emit initial task shape so client can render the step skeleton immediately
    emit({ type: "research_init", task })

    try {
      await runResearchEngine(task, { userId: user.id, pool, researchType: type }, emit)
      await logApiUsage({
        service:     "claude",
        operation:   "scout_research",
        tokens_used: 0,   // tokens are logged inside runSynthesis if needed
        cost_usd:    0,
      }).catch(() => {})
    } catch (err) {
      console.error("[scout:research] engine error:", err)
      emit({
        type:    "research_error",
        message: err instanceof Error ? err.message : "Research engine failed",
      })
    } finally {
      try { ctrl.close() } catch {}
    }
  })()

  return new Response(sseStream, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache, no-transform",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

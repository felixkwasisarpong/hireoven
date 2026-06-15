import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { generateContentIdeas } from "@/lib/brand/idea-generator"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const existing = await pool.query<{
    id: string; title: string; hook: string; content_type: string
    topic_tags: string[]; status: string; best_day_to_post: string | null
    estimated_reach_min: number | null; estimated_reach_max: number | null
    generated_from: string; draft_content: string | null; created_at: string
  }>(
    `SELECT id, title, hook, content_type, topic_tags, status, best_day_to_post,
            estimated_reach_min, estimated_reach_max, generated_from, draft_content, created_at
     FROM public.brand_content_ideas
     WHERE user_id = $1 AND status != 'skipped'
     ORDER BY created_at DESC LIMIT 20`,
    [user.id]
  )

  return NextResponse.json({ ideas: existing.rows })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { mode?: string }
  const mode = body.mode === "trending" ? "trending" : "cv"

  const pool = getPostgresPool()

  try {
    await generateContentIdeas(user.id, 5, mode)
  } catch (err) {
    console.error("[brand/ideas] generation error:", err instanceof Error ? err.message : err)
    // Don't 500 — fall through and return whatever was inserted (could be fallback ideas)
  }

  // Fetch the freshly inserted rows (with DB-assigned ids and status)
  const newResult = await pool.query<{
    id: string; title: string; hook: string; content_type: string
    topic_tags: string[]; status: string; best_day_to_post: string | null
    estimated_reach_min: number | null; estimated_reach_max: number | null
    generated_from: string; draft_content: string | null; created_at: string
  }>(
    `SELECT id, title, hook, content_type, topic_tags, status, best_day_to_post,
            estimated_reach_min, estimated_reach_max, generated_from, draft_content, created_at
     FROM public.brand_content_ideas
     WHERE user_id = $1 AND status != 'skipped'
     ORDER BY created_at DESC LIMIT 5`,
    [user.id]
  )

  return NextResponse.json({ ideas: newResult.rows, generated: true })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { id?: string; status?: string }
  if (!body.id || !body.status) return NextResponse.json({ error: "id and status required" }, { status: 400 })

  const pool = getPostgresPool()
  await pool.query(
    `UPDATE public.brand_content_ideas SET status = $1, updated_at = now()
     WHERE id = $2 AND user_id = $3`,
    [body.status, body.id, user.id]
  )
  return NextResponse.json({ ok: true })
}

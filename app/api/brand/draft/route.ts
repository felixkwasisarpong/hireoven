import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { writeDraft } from "@/lib/brand/draft-writer"
import { getPostgresPool } from "@/lib/postgres/server"
import type { DraftRequest } from "@/lib/brand/draft-writer"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

  const req = body as Partial<DraftRequest>
  if (!req.contentType || !req.title) {
    return NextResponse.json({ error: "contentType and title are required" }, { status: 400 })
  }

  try {
    const draft = await writeDraft(user.id, {
      contentType: req.contentType,
      title: req.title,
      hook: req.hook,
      generatedFrom: req.generatedFrom,
      tone: req.tone ?? "professional",
      topicTags: req.topicTags,
      ideaId: req.ideaId,
    })
    return NextResponse.json({ draft })
  } catch (err) {
    console.error("[brand/draft] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to write draft" }, { status: 500 })
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const result = await pool.query(
    `SELECT id, idea_id, content_type, title, content, char_count, char_limit, tone, version, created_at
     FROM public.brand_content_drafts WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 20`,
    [user.id]
  )
  return NextResponse.json({ drafts: result.rows })
}

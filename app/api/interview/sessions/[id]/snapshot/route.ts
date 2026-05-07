import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  isSnapshotStorageConfigured,
  uploadInterviewSnapshot,
} from "@/lib/storage/interview-snapshots"
import { getTurns, appendTurn } from "@/lib/scout/interview/queries"

export const runtime = "nodejs"

const MAX_BYTES = 50_000 // 50 KB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Verify session ownership + active
  const pool = getPostgresPool()
  const check = await pool.query<{ status: string }>(
    `SELECT status FROM interview_sessions WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  )
  if (!check.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (check.rows[0].status !== "active") return NextResponse.json({ ok: true }) // silently drop

  if (!isSnapshotStorageConfigured()) {
    // Gracefully skip if storage isn't configured
    return NextResponse.json({ ok: true, url: null })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 })
  }

  const imageFile = formData.get("image") as File | null
  if (!imageFile) return NextResponse.json({ error: "image field required" }, { status: 400 })

  if (imageFile.type !== "image/jpeg") {
    return NextResponse.json({ error: "Only image/jpeg accepted" }, { status: 400 })
  }

  const buffer = Buffer.from(await imageFile.arrayBuffer())
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "Image exceeds 50KB limit" }, { status: 400 })
  }

  try {
    const { url, key } = await uploadInterviewSnapshot(user.id, id, buffer)

    // Append a system turn with snapshot metadata
    const turns = await getTurns(id)
    await appendTurn({
      sessionId: id,
      turnIndex: turns.length,
      role: "system",
      content: `Webcam snapshot captured.`,
      metadata: { type: "webcam_snapshot", s3_key: key, url },
    })

    // Update video_thumb_url on the most recent interviewer turn
    await pool.query(
      `UPDATE interview_turns
       SET video_thumb_url = $1
       WHERE session_id = $2
         AND role = 'interviewer'
         AND id = (
           SELECT id FROM interview_turns
           WHERE session_id = $2 AND role = 'interviewer'
           ORDER BY turn_index DESC LIMIT 1
         )`,
      [url, id]
    )

    return NextResponse.json({ ok: true, url })
  } catch (e) {
    // Storage failure is non-blocking — interview continues
    console.error("[snapshot] upload failed:", e)
    return NextResponse.json({ ok: true, url: null })
  }
}

import { NextResponse } from "next/server"
import { regenerateParagraph } from "@/lib/resume/cover-letter-generator"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    coverLetterId?: string
    paragraphIndex?: number
    instruction?: string
  }
  const { coverLetterId, paragraphIndex, instruction } = body

  if (!coverLetterId || paragraphIndex === undefined || !instruction) {
    return NextResponse.json(
      { error: "coverLetterId, paragraphIndex, and instruction are required" },
      { status: 400 }
    )
  }

  try {
    const newBody = await regenerateParagraph(
      coverLetterId,
      paragraphIndex,
      instruction,
      user.id
    )
    return NextResponse.json({ body: newBody })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Regeneration failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

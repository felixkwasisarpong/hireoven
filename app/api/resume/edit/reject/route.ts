import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

type RejectBody = {
  editId?: string
  feedback?: string
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as RejectBody
  if (!body.editId) {
    return NextResponse.json({ error: "editId is required" }, { status: 400 })
  }

  const { error } = await (((supabase.from("resume_edits") as any)
    .update({
      was_accepted: false,
      feedback: typeof body.feedback === "string" ? body.feedback.trim() || null : null,
    })
    .eq("id", body.editId)
    .eq("user_id", user.id)) as any)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { CoverLetterUpdate } from "@/types"

export const runtime = "nodejs"

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as CoverLetterUpdate

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (supabase as any).from("cover_letters")
  const { data, error } = await table
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("*")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { error } = await (supabase
    .from("cover_letters" as any)
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id) as any)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

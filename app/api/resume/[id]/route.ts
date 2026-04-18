import { NextResponse } from "next/server"
import { deleteResume, getResumeUrl } from "@/lib/supabase/storage"
import { createClient } from "@/lib/supabase/server"
import type { Resume } from "@/types"

export const runtime = "nodejs"

async function getAuthedResume(id: string, userId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("resumes")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single()

  if (error || !data) return null
  return data as Resume
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const resume = await getAuthedResume(params.id, user.id)
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  try {
    const signedUrl = await getResumeUrl(resume.storage_path)
    return NextResponse.json({
      ...resume,
      file_url: signedUrl,
      download_url: signedUrl,
    })
  } catch {
    return NextResponse.json(resume)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const resume = await getAuthedResume(params.id, user.id)
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  try {
    await deleteResume(resume.storage_path)
  } catch (error) {
    console.error("Failed to delete resume from storage", error)
  }

  const { error } = await supabase
    .from("resumes")
    .delete()
    .eq("id", resume.id)
    .eq("user_id", user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (resume.is_primary) {
    const { data: remaining } = await (supabase
      .from("resumes")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1) as any)

    const nextPrimaryId = (remaining as Array<{ id: string }> | null)?.[0]?.id
    if (nextPrimaryId) {
      await (supabase.from("resumes") as any)
        .update({ is_primary: true } satisfies Partial<Resume>)
        .eq("id", nextPrimaryId)
        .eq("user_id", user.id)
    }
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const resume = await getAuthedResume(params.id, user.id)
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  const body = await request.json()
  const updates: Partial<Resume> = {}

  if (typeof body.name === "string") {
    updates.name = body.name.trim() || null
  }

  if (body.is_primary === true) {
    await (supabase.from("resumes") as any)
      .update({ is_primary: false } satisfies Partial<Resume>)
      .eq("user_id", user.id)

    updates.is_primary = true
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid updates provided" }, { status: 400 })
  }

  const { data, error } = await ((supabase.from("resumes") as any)
    .update(updates as any)
    .eq("id", resume.id)
    .eq("user_id", user.id)
    .select("*")
    .single() as any)

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to update resume" }, { status: 500 })
  }

  try {
    const signedUrl = await getResumeUrl(data.storage_path)
    return NextResponse.json({
      ...data,
      file_url: signedUrl,
      download_url: signedUrl,
    })
  } catch {
    return NextResponse.json(data)
  }
}

import { NextResponse } from "next/server"
import { generateResumePDF } from "@/lib/resume/pdf-generator"
import { createClient } from "@/lib/supabase/server"
import type { Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const resumeId = searchParams.get("resumeId")

  if (!resumeId) {
    return NextResponse.json({ error: "resumeId is required" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("resumes")
    .select("*")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  const resume = data as Resume
  const pdfBuffer = await generateResumePDF(resume)

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${(resume.name ?? resume.file_name ?? "resume").replace(/\"/g, "")}.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}

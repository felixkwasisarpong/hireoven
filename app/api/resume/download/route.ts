import { NextResponse } from "next/server"
import { generateResumeDocx } from "@/lib/resume/docx-generator"
import { getPostgresPool } from "@/lib/postgres/server"
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
  const pool = getPostgresPool()

  const { searchParams } = new URL(request.url)
  const resumeId = searchParams.get("resumeId")

  if (!resumeId) {
    return NextResponse.json({ error: "resumeId is required" }, { status: 400 })
  }

  const result = await pool.query<Resume>(
    `SELECT *
     FROM resumes
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [resumeId, user.id]
  )
  const resume = result.rows[0]

  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  let docxBuffer: Buffer
  try {
    docxBuffer = await generateResumeDocx(resume)
  } catch (err) {
    console.error("[resume/download] DOCX generation failed", err)
    return NextResponse.json({ error: "Failed to generate document. Please try again." }, { status: 500 })
  }

  if (!docxBuffer || docxBuffer.length === 0) {
    return NextResponse.json({ error: "Generated document was empty. Please try again." }, { status: 500 })
  }

  const safeName = (resume.name ?? resume.file_name ?? "resume").replace(/["\\]/g, "").replace(/\.pdf$/i, "")
  return new NextResponse(new Uint8Array(docxBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeName}.docx"`,
      "Cache-Control": "no-store",
    },
  })
}

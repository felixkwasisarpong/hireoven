import { NextResponse } from "next/server"
import { generateResumeDocx } from "@/lib/resume/docx-generator"
import { generateResumePDF } from "@/lib/resume/pdf-generator"
import { getPostgresPool } from "@/lib/postgres/server"
import { isUuid, restoreResumeFromSnapshot } from "@/lib/resume/hub"
import { createClient } from "@/lib/supabase/server"
import type { Resume, ResumeVersion } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * GET /api/resume/[id]/versions/[versionId]/file
 *
 * Versions don't own a stored file — they're snapshots of the resume's
 * structured data. So we reconstruct the resume from the version's snapshot and
 * generate a document on the fly: an inline PDF for preview (iframe/modal), or a
 * DOCX attachment when ?download=1 is passed. Mirrors the generated-fallback
 * path in /api/resume/[id]/file.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string; versionId: string } }
) {
  const { id, versionId } = params
  if (!isUuid(id) || !isUuid(versionId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const forceDownload = new URL(request.url).searchParams.get("download") === "1"

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pool = getPostgresPool()
  const [resumeResult, versionResult] = await Promise.all([
    pool.query<Resume>(
      `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [id, user.id]
    ),
    pool.query<ResumeVersion>(
      `SELECT * FROM resume_versions
       WHERE id = $1 AND resume_id = $2 AND user_id = $3
       LIMIT 1`,
      [versionId, id, user.id]
    ),
  ])
  const resume = resumeResult.rows[0]
  const version = versionResult.rows[0]
  if (!resume) return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 })
  if (!version.snapshot) {
    return NextResponse.json({ error: "Version has no snapshot" }, { status: 400 })
  }

  const restored = restoreResumeFromSnapshot(resume, version.snapshot)
  const baseName = String(version.name ?? resume.name ?? "resume")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.(pdf|docx?|rtf|txt)$/i, "") || "resume"

  try {
    if (!forceDownload) {
      const pdfBuffer = await generateResumePDF(restored)
      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${baseName}.pdf"`,
          "Cache-Control": "private, no-store",
        },
      })
    }

    const docxBuffer = await generateResumeDocx(restored)
    return new NextResponse(new Uint8Array(docxBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${baseName}.docx"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    console.error("[resume/version/file] Document generation failed", {
      resumeId: id,
      versionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: "Could not generate version file" },
      { status: 500 }
    )
  }
}

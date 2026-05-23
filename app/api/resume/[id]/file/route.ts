import { Readable } from "node:stream"
import { NextResponse } from "next/server"
import { generateResumeDocx } from "@/lib/resume/docx-generator"
import { getPostgresPool } from "@/lib/postgres/server"
import { getResumeObject } from "@/lib/supabase/storage"
import { createClient } from "@/lib/supabase/server"
import type { Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

function sanitizeDownloadName(name: string | null | undefined, fallback = "resume.docx") {
  const cleaned = String(name ?? "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned || fallback
}

function contentDispositionFor(resume: Resume) {
  const fallbackName = sanitizeDownloadName(resume.file_name, "resume.docx")
  const preferredName = sanitizeDownloadName(
    resume.name ? `${resume.name}` : resume.file_name,
    fallbackName
  )
  return `inline; filename="${preferredName}"`
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

  const pool = getPostgresPool()
  const resumeResult = await pool.query<Resume>(
    `SELECT *
     FROM resumes
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [params.id, user.id]
  )
  const resume = resumeResult.rows[0]
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  if (resume.storage_path) {
    try {
      const object = await getResumeObject(resume.storage_path)
      const contentType =
        object.contentType ||
        resume.file_type ||
        "application/octet-stream"

      const webStream = Readable.toWeb(object.stream as Readable) as ReadableStream

      return new NextResponse(webStream, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": contentDispositionFor(resume),
          "Cache-Control": "private, no-store",
          ...(object.etag ? { ETag: object.etag } : {}),
          ...(object.lastModified
            ? { "Last-Modified": object.lastModified.toUTCString() }
            : {}),
          ...(typeof object.size === "number" ? { "Content-Length": String(object.size) } : {}),
        },
      })
    } catch (error) {
      console.warn("[resume/file] Failed to stream object from storage", {
        resumeId: resume.id,
        storagePath: resume.storage_path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  try {
    const docxBuffer = await generateResumeDocx(resume)
    return new NextResponse(new Uint8Array(docxBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${sanitizeDownloadName(resume.name ?? resume.file_name, "resume")}.docx"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("[resume/file] Fallback DOCX generation failed", {
      resumeId: resume.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: "Could not load resume file" },
      { status: 500 }
    )
  }
}

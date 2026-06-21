import { Readable } from "node:stream"
import { NextResponse } from "next/server"
import { generateResumeDocx } from "@/lib/resume/docx-generator"
import { generateResumePDF } from "@/lib/resume/pdf-generator"
import { getPostgresPool } from "@/lib/postgres/server"
import { getResumeObject } from "@/lib/supabase/storage"
import { createClient } from "@/lib/supabase/server"
import type { Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

/** Return a valid MIME string, or null if the value is a bare token / empty. */
function normalizeMime(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.toLowerCase().trim()
  // Generic/binary types tell us nothing and cause the browser to download —
  // treat them as "unknown" so callers fall through to extension detection.
  if (v === "application/octet-stream" || v === "binary/octet-stream") return null
  if (v.includes("/")) return v          // already a specific MIME type
  if (v === "pdf") return "application/pdf"
  if (v === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  if (v === "doc") return "application/msword"
  return null
}

function sanitizeDownloadName(name: string | null | undefined, fallback = "resume.docx") {
  const cleaned = String(name ?? "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned || fallback
}

function contentDispositionFor(resume: Resume, forceDownload: boolean) {
  const fallbackName = sanitizeDownloadName(resume.file_name, "resume.docx")
  const preferredName = sanitizeDownloadName(
    resume.name ? `${resume.name}` : resume.file_name,
    fallbackName
  )
  const disposition = forceDownload ? "attachment" : "inline"
  return `${disposition}; filename="${preferredName}"`
}

function fallbackBaseName(resume: Resume) {
  return sanitizeDownloadName(resume.name ?? resume.file_name, "resume")
    .replace(/\.(pdf|docx?|rtf|txt)$/i, "")
}

function acceptsHtmlNavigation(request: Request) {
  const accept = request.headers.get("accept") ?? ""
  return accept.includes("text/html") && !accept.includes("application/json")
}

function studioPreviewRedirect(request: Request, resumeId: string) {
  const url = new URL("/dashboard/resume/studio", request.url)
  url.searchParams.set("mode", "preview")
  url.searchParams.set("resumeId", resumeId)
  return NextResponse.redirect(url)
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  // Only force a file download when explicitly requested (?download=1).
  // Default is inline so iframe/tab previews don't trigger auto-downloads.
  const forceDownload = new URL(_request.url).searchParams.get("download") === "1"
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
      // Resolve a real MIME type. MinIO stores uploads as application/octet-stream
      // by default, and `resume.file_type` is sometimes a bare token ("pdf").
      // Either makes the browser DOWNLOAD even with inline disposition. So we
      // detect the real type by extension FIRST and only trust the stored
      // content-type when it's a specific, non-generic MIME.
      const name = `${resume.file_name ?? ""} ${resume.file_type ?? ""} ${resume.storage_path ?? ""}`.toLowerCase()
      const byExtension =
        /\.pdf\b|\bpdf\b/.test(name) ? "application/pdf"
        : /\.docx\b|\bdocx\b/.test(name) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : /\.doc\b/.test(name) ? "application/msword"
        : null
      const contentType =
        byExtension ||
        normalizeMime(object.contentType) ||
        normalizeMime(resume.file_type) ||
        "application/octet-stream"

      const webStream = Readable.toWeb(object.stream as Readable) as ReadableStream

      return new NextResponse(webStream, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": contentDispositionFor(resume, forceDownload),
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

  // Generated fallback. Inline previews get a PDF so the browser can render the
  // tab even when the original uploaded object is missing. Explicit downloads
  // keep the editable DOCX export.
  try {
    const baseName = fallbackBaseName(resume)
    if (!forceDownload) {
      const pdfBuffer = await generateResumePDF(resume)
      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${baseName}.pdf"`,
          "Cache-Control": "no-store",
        },
      })
    }

    const docxBuffer = await generateResumeDocx(resume)
    return new NextResponse(new Uint8Array(docxBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${baseName}.docx"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("[resume/file] Fallback document generation failed", {
      resumeId: resume.id,
      error: error instanceof Error ? error.message : String(error),
    })
    if (!forceDownload && acceptsHtmlNavigation(_request)) {
      return studioPreviewRedirect(_request, resume.id)
    }
    return NextResponse.json(
      { error: "Could not load resume file" },
      { status: 500 }
    )
  }
}

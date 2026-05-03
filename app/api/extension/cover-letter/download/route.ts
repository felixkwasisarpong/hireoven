/**
 * GET /api/extension/cover-letter/download?coverLetterId=<id>
 *  or  ?jobId=<id>  (falls back to the most recent letter for that job)
 *
 * Returns the cover letter as a DOCX file, authenticated via Bearer token.
 * Used by the extension to inject the letter into file inputs via DataTransfer.
 *
 * Auth: Bearer <ho_session JWT> sent by the Chrome extension.
 */

import { NextResponse } from "next/server"
import { Document, Packer, Paragraph, TextRun } from "docx"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extensionError,
  extensionCorsHeaders,
  handleExtensionPreflight,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import type { CoverLetter } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 30

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin")
  const cors = extensionCorsHeaders(origin)

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const { searchParams } = new URL(request.url)
  const coverLetterId = searchParams.get("coverLetterId")
  const jobId = searchParams.get("jobId")

  if (!coverLetterId && !jobId) {
    return extensionError(request, 400, "coverLetterId or jobId is required", { headers: cors })
  }

  const pool = getPostgresPool()
  let result: { rows: CoverLetter[] }
  if (coverLetterId) {
    result = await pool.query<CoverLetter>(
      `SELECT * FROM cover_letters WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [coverLetterId, user.sub],
    )
  } else {
    result = await pool.query<CoverLetter>(
      `SELECT * FROM cover_letters
       WHERE user_id = $1 AND job_id = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [user.sub, jobId],
    )
  }

  const letter = result.rows[0]
  if (!letter) {
    return extensionError(request, 404, "Cover letter not found", { headers: cors })
  }

  let docxBuffer: Buffer
  try {
    const paragraphs = (letter.body ?? "")
      .split("\n\n")
      .map((text) => new Paragraph({
        children: [new TextRun({ text, size: 24 })],
        spacing: { after: 240 },
      }))
    const doc = new Document({ sections: [{ children: paragraphs }] })
    docxBuffer = await Packer.toBuffer(doc)
  } catch (err) {
    console.error("[extension/cover-letter/download] DOCX build failed", err)
    return extensionError(request, 500, "Failed to generate cover letter document", { headers: cors })
  }

  if (!docxBuffer || docxBuffer.length === 0) {
    return extensionError(request, 500, "Generated document was empty", { headers: cors })
  }

  const safeCompany = (letter.company_name ?? "company").replace(/["\\/]/g, "").trim() || "company"
  const safeRole = (letter.job_title ?? "role").replace(/["\\/]/g, "").trim() || "role"
  const filename = `cover-letter-${safeCompany}-${safeRole}.docx`.replace(/\s+/g, "-")

  return new NextResponse(new Uint8Array(docxBuffer), {
    headers: {
      ...cors,
      "Content-Type":        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control":       "no-store",
    },
  })
}

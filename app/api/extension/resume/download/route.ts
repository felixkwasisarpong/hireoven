/**
 * GET /api/extension/resume/download?resumeId=<id>
 *
 * Returns the resume as a DOCX file, authenticated via Bearer token.
 * Used by the extension to inject the resume into file inputs via DataTransfer.
 *
 * Auth: Bearer <ho_session JWT> sent by the Chrome extension.
 */

import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { generateResumeDocx } from "@/lib/resume/docx-generator"
import {
  extensionError,
  extensionCorsHeaders,
  handleExtensionPreflight,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import type { Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 30

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin")
  const cors   = extensionCorsHeaders(origin)

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const { searchParams } = new URL(request.url)
  const resumeId = searchParams.get("resumeId")
  const jobId = searchParams.get("jobId")

  // Resolution priority:
  //   1. resumeId  → exact match (used when the user explicitly picked a version)
  //   2. jobId     → tailored copy for that job, if one exists (autofill on a
  //                  saved job page)
  //   3. fallback  → user's primary resume (or most recently updated)
  const pool = getPostgresPool()
  let result: { rows: Resume[] }
  if (resumeId) {
    result = await pool.query<Resume>(
      `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [resumeId, user.sub],
    )
  } else if (jobId) {
    // Try tailored copy first; fall back to primary inside the same query.
    result = await pool.query<Resume>(
      `(
         SELECT * FROM resumes
         WHERE user_id = $1 AND tailored_for_job_id = $2
         ORDER BY updated_at DESC
         LIMIT 1
       )
       UNION ALL
       (
         SELECT * FROM resumes
         WHERE user_id = $1
         ORDER BY is_primary DESC NULLS LAST, updated_at DESC
         LIMIT 1
       )
       LIMIT 1`,
      [user.sub, jobId],
    )
  } else {
    result = await pool.query<Resume>(
      `SELECT * FROM resumes
       WHERE user_id = $1
       ORDER BY is_primary DESC NULLS LAST, updated_at DESC
       LIMIT 1`,
      [user.sub],
    )
  }
  const resume = result.rows[0]
  if (!resume) {
    return extensionError(
      request,
      404,
      resumeId ? "Resume not found" : "No resume found — upload one in Hireoven first",
      { headers: cors },
    )
  }

  let docxBuffer: Buffer
  try {
    docxBuffer = await generateResumeDocx(resume)
  } catch (err) {
    console.error("[extension/resume/download] DOCX generation failed", err)
    return extensionError(request, 500, "Failed to generate resume document", { headers: cors })
  }

  if (!docxBuffer || docxBuffer.length === 0) {
    return extensionError(request, 500, "Generated document was empty", { headers: cors })
  }

  const safeName = (resume.name ?? resume.file_name ?? "resume")
    .replace(/["\\]/g, "")
    .replace(/\.docx$/i, "")

  return new NextResponse(new Uint8Array(docxBuffer), {
    headers: {
      ...cors,
      "Content-Type":        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeName}.docx"`,
      "Cache-Control":       "no-store",
    },
  })
}

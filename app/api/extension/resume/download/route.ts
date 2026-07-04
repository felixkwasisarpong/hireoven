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
import { restoreResumeFromSnapshot } from "@/lib/resume/hub"
import {
  extensionError,
  extensionCorsHeaders,
  handleExtensionPreflight,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import type { Resume, ResumeVersion } from "@/types"

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
  const versionId = searchParams.get("versionId")
  const resumeId = searchParams.get("resumeId")
  const jobId = searchParams.get("jobId")

  // Resolution priority:
  //   1. versionId → exact resume_versions snapshot (inline tailored resume)
  //   2. resumeId  → exact base resume match
  //   3. jobId     → tailored copy for that job, if one exists (autofill on a
  //                  saved job page)
  //   4. fallback  → user's primary resume (or most recently updated)
  const pool = getPostgresPool()
  let result: { rows: Resume[] } = { rows: [] }
  let resume: Resume | null = null
  // Role this resume was tailored for, folded into the download filename.
  let roleLabel: string | null = null
  if (versionId) {
    const versionResult = await pool.query<ResumeVersion>(
      `SELECT * FROM resume_versions WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [versionId, user.sub],
    )
    const version = versionResult.rows[0]
    if (!version) {
      return extensionError(request, 404, "Resume version not found", { headers: cors })
    }
    const baseResult = await pool.query<Resume>(
      `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [version.resume_id, user.sub],
    )
    const baseResume = baseResult.rows[0]
    if (!baseResume) {
      return extensionError(request, 404, "Resume not found", { headers: cors })
    }
    resume = version.snapshot
      ? restoreResumeFromSnapshot(baseResume, version.snapshot)
      : baseResume
    // Keep the DOCX heading/content from the version, but do NOT let the
    // internal version label ("Tailored for … at …") become the uploaded
    // filename — recruiters see that name. professionalResumeFilename() below
    // derives a clean "<Full Name> Resume.docx" from the candidate instead.
    resume = {
      ...resume,
      name: version.name ?? resume.name,
    }
    // Recover the role from the internal label "Tailored for <role> at <co> · <ats>".
    const roleMatch = (version.name ?? "").match(/^tailored\s+for\s+(.+?)(?:\s+at\s+|\s+·\s+|$)/i)
    if (roleMatch?.[1]) roleLabel = roleMatch[1].trim()
  } else if (resumeId) {
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
  resume = resume ?? result.rows[0] ?? null
  if (!resume) {
    return extensionError(
      request,
      404,
      resumeId || versionId ? "Resume not found" : "No resume found — upload one in Hireoven first",
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

  const safeName = professionalResumeFilename(resume, roleLabel ?? resume.primary_role)

  return new NextResponse(new Uint8Array(docxBuffer), {
    headers: {
      ...cors,
      "Content-Type":        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeName}.docx"`,
      "Cache-Control":       "no-store",
    },
  })
}

/**
 * A clean, recruiter-facing resume filename (returned without the .docx
 * extension), e.g. "Felix Sarpong - Site Reliability Engineer Resume".
 * Prefers the candidate's real name + the role it was tailored for; never
 * leaks internal labels like "Tailored for … at …". Falls back gracefully to
 * name-only, then the base file name, then a generic "Resume".
 */
function professionalResumeFilename(resume: Resume, role?: string | null): string {
  const clean = (s: string): string =>
    s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()

  const roleLabel = clean(role ?? "")

  // Candidate name — full_name, else resume.name when it isn't a tailoring label.
  let person = clean(resume.full_name ?? "")
  if (!person) {
    const name = clean(resume.name ?? "")
    if (name && !/^tailored\b/i.test(name) && !/resume|cv/i.test(name)) person = name
  }

  if (person) {
    return roleLabel ? `${person} - ${roleLabel} Resume` : `${person} Resume`
  }

  // No usable person name: role-only, then base filename, then generic.
  if (roleLabel) return `${roleLabel} Resume`
  const base = clean((resume.file_name ?? "").replace(/\.[a-z0-9]+$/i, ""))
  if (base && !/^tailored\b/i.test(base)) return base
  return "Resume"
}

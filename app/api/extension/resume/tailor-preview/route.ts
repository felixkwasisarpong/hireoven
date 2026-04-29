/**
 * POST /api/extension/resume/tailor-preview
 *
 * Analyzes the user's resume against a detected job with full ATS awareness.
 * Returns a structured preview of suggested changes — without modifying anything.
 *
 * Safety:
 *   - Read-only. Nothing is written to the database here.
 *   - Only fetches job and resume owned by the authenticated user.
 *   - Never invents skills or experience absent from the resume.
 *
 * Auth: Bearer <ho_session JWT> sent by the Chrome extension.
 */

import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { tailorResumeForAts } from "@/lib/resume/ats-tailor"
import {
  extensionError,
  extensionCorsHeaders,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import type { Resume } from "@/types"

export const runtime = "nodejs"

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export type TailorPreviewStatus =
  | "ready"
  | "missing_resume"
  | "missing_job_context"
  | "gated"

export type TailorChangePreview = {
  section: "summary" | "skills" | "experience" | "ats_tip"
  before?: string
  after?: string
  reason: string
}

export type TailorPreviewResponse = {
  status: TailorPreviewStatus
  summary: string
  atsTip: string | null
  atsName: string | null
  resumeId: string | null
  resumeName: string | null
  jobTitle: string | null
  company: string | null
  matchScore: number | null
  changesPreview: TailorChangePreview[]
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  const headers = extensionCorsHeaders(origin)

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const [body, bodyError] = await readExtensionJsonBody<{
    jobId?: string
    resumeId?: string
    ats?: string
  }>(request)
  if (bodyError) return bodyError

  const { jobId, resumeId, ats } = body

  if (!jobId) {
    return extensionError(request, 400, "jobId is required", { headers })
  }

  const pool = getPostgresPool()

  // ── 1. Fetch job ────────────────────────────────────────────────────────────

  const jobRow = await pool.query<{
    id: string
    title: string | null
    description: string | null
    company_name: string | null
  }>(
    `SELECT j.id, j.title, j.description, c.name AS company_name
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.id = $1
     LIMIT 1`,
    [jobId]
  ).catch(() => null)

  const job = jobRow?.rows[0] ?? null

  if (!job || !job.description) {
    const response: TailorPreviewResponse = {
      status: "missing_job_context",
      summary: "No job description found for this listing. Try importing the job first.",
      atsTip: null,
      atsName: null,
      resumeId: null,
      resumeName: null,
      jobTitle: null,
      company: null,
      matchScore: null,
      changesPreview: [],
    }
    return NextResponse.json(response, { headers })
  }

  const jobTitle = job.title ?? null
  const companyName = job.company_name ?? null

  // ── 2. Fetch resume ─────────────────────────────────────────────────────────

  let resume: Resume | null = null

  if (resumeId) {
    const row = await pool.query<Resume>(
      `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [resumeId, user.sub]
    ).catch(() => null)
    resume = row?.rows[0] ?? null
  }

  if (!resume) {
    const row = await pool.query<Resume>(
      `SELECT * FROM resumes WHERE user_id = $1 AND parse_status = 'complete'
       ORDER BY updated_at DESC LIMIT 1`,
      [user.sub]
    ).catch(() => null)
    resume = row?.rows[0] ?? null
  }

  if (!resume) {
    const response: TailorPreviewResponse = {
      status: "missing_resume",
      summary: "No resume found. Upload a resume in Hireoven first.",
      atsTip: null,
      atsName: null,
      resumeId: null,
      resumeName: null,
      jobTitle,
      company: companyName,
      matchScore: null,
      changesPreview: [],
    }
    return NextResponse.json(response, { headers })
  }

  // ── 3. ATS-aware tailoring analysis ─────────────────────────────────────────

  let tailorResult: Awaited<ReturnType<typeof tailorResumeForAts>>
  try {
    tailorResult = await tailorResumeForAts(
      resume,
      job.description,
      jobTitle,
      companyName,
      ats
    )
  } catch (err) {
    console.error("[tailor-preview] tailorResumeForAts failed:", err)
    return extensionError(request, 500, "Analysis failed", { headers })
  }

  const { analysis, atsProfile, atsSummaryRewrite, criticalKeywords, strategyTip } = tailorResult

  // ── 4. Build changesPreview ─────────────────────────────────────────────────

  const changesPreview: TailorChangePreview[] = []

  // ATS strategy tip — always first so the user understands the context
  if (criticalKeywords.length > 0 || atsProfile.keywordStrategy === "exact") {
    changesPreview.push({
      section: "ats_tip",
      reason: `${atsProfile.name}: ${atsProfile.recruiterNote}`,
    })
  }

  // Summary rewrite (AI-generated or heuristic fallback)
  const summaryAfter = atsSummaryRewrite ?? analysis.summarySuggestion?.suggested
  if (summaryAfter && summaryAfter !== resume.summary) {
    changesPreview.push({
      section: "summary",
      before: resume.summary ?? undefined,
      after: summaryAfter,
      reason: analysis.summarySuggestion?.reason
        ?? `Summary rewritten to pass ${atsProfile.name} parsing and lead sharp for the recruiter.`,
    })
  }

  // Skills — only actionable ones (missing_supported = safe to add; missing_needs_confirmation = flagged)
  const skillsToSurface = analysis.skillSuggestions
    .filter((s) => s.status === "missing_supported" || s.status === "missing_needs_confirmation")
    .slice(0, 8)

  for (const s of skillsToSurface) {
    const isConfirmed = s.status === "missing_supported"
    changesPreview.push({
      section: "skills",
      after: s.skill,
      reason: isConfirmed
        ? `"${s.skill}" is in the JD and supported by your experience — safe to align wording. ${s.evidence ?? ""}`
        : `"${s.skill}" is required by the JD but not clearly in your resume — add only if truthfully applicable.`,
    })
  }

  // Experience bullets — top 5 actionable ones
  const bullets = analysis.bulletSuggestions
    .filter((b) => b.confidence !== "low" || b.original.length > 10)
    .slice(0, 5)

  for (const b of bullets) {
    changesPreview.push({
      section: "experience",
      before: b.original,
      after: b.suggested,
      reason: b.issue,
    })
  }

  // ── 5. Build summary text ───────────────────────────────────────────────────

  const score = analysis.matchScore
  const missingCount = criticalKeywords.length
  const presentCount = analysis.presentKeywords.length
  const suggestionCount = changesPreview.filter((c) => c.section !== "ats_tip").length

  let summaryText: string
  if (score >= 80) {
    summaryText = `Strong match (${score}%) · ${presentCount} keywords covered. ${suggestionCount > 0 ? `${suggestionCount} polish suggestion${suggestionCount !== 1 ? "s" : ""} for ${atsProfile.name}.` : `Looks good for ${atsProfile.name}.`}`
  } else if (score >= 55) {
    summaryText = `Good foundation (${score}%) · ${suggestionCount} targeted change${suggestionCount !== 1 ? "s" : ""} close ${missingCount} gap${missingCount !== 1 ? "s" : ""} for ${atsProfile.name}.`
  } else {
    summaryText = `Moderate match (${score}%) · ${suggestionCount} suggestion${suggestionCount !== 1 ? "s" : ""} to surface ${missingCount} missing keyword${missingCount !== 1 ? "s" : ""} that ${atsProfile.name} scores. Only your real experience is used.`
  }

  const response: TailorPreviewResponse = {
    status: "ready",
    summary: summaryText,
    atsTip: strategyTip,
    atsName: atsProfile.name,
    resumeId: resume.id,
    resumeName: resume.file_name ?? resume.full_name ?? "Your resume",
    jobTitle,
    company: companyName,
    matchScore: score,
    changesPreview,
  }

  return NextResponse.json(response, { headers })
}

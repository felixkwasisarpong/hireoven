/**
 * POST /api/extension/resume/tailor-approve
 *
 * Called when the user clicks "Use this tailored resume" in the extension popup.
 * Creates a new resume version (draft) capturing the tailored state.
 * The original resume is never modified.
 *
 * Safety:
 *   - Creates a new `resume_versions` row only — never touches the source resume.
 *   - Returns the new version ID so the popup can reference it.
 *   - No auto-upload, no auto-attach, no form submission.
 *
 * Auth: Bearer <ho_session JWT> sent by the Chrome extension.
 */

import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { getPostgresPool } from "@/lib/postgres/server"
import { createResumeSnapshot } from "@/lib/resume/hub"
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

async function ensureResumeVersionsTable(pool: ReturnType<typeof getPostgresPool>) {
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS resume_versions (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        resume_id UUID REFERENCES resumes(id) ON DELETE CASCADE,
        user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL DEFAULT 1,
        name TEXT,
        file_url TEXT,
        snapshot JSONB,
        changes_summary TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`
    )
  } catch (err) {
    // Table may already exist with a different DDL — log but continue.
    // The INSERT below will surface the real error if the schema is incompatible.
    console.warn("[tailor-approve] ensureResumeVersionsTable warning:", err)
  }
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

  let job: { id: string; title: string | null; description: string | null; company_name?: string | null } | null = null
  try {
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
    )
    job = jobRow.rows[0] ?? null
  } catch (err) {
    console.error("[tailor-approve] job fetch failed:", err)
    return extensionError(request, 500, "Failed to fetch job", { headers })
  }

  if (!job || !job.description) {
    return extensionError(request, 404, "Job not found or missing description", { headers })
  }

  const companyName = job.company_name ?? null
  const jobTitle = job.title ?? null

  // ── 2. Fetch resume ─────────────────────────────────────────────────────────

  let resume: Resume | null = null

  try {
    if (resumeId) {
      const row = await pool.query<Resume>(
        `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [resumeId, user.sub]
      )
      resume = row.rows[0] ?? null
    }

    if (!resume) {
      const row = await pool.query<Resume>(
        `SELECT * FROM resumes WHERE user_id = $1 AND parse_status = 'complete'
         ORDER BY updated_at DESC LIMIT 1`,
        [user.sub]
      )
      resume = row.rows[0] ?? null
    }
  } catch (err) {
    console.error("[tailor-approve] resume fetch failed:", err)
    return extensionError(request, 500, "Failed to fetch resume", { headers })
  }

  if (!resume) {
    return extensionError(request, 404, "Resume not found", { headers })
  }

  // ── 3. ATS-aware tailoring analysis + Claude summary rewrite ────────────────

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
    console.error("[tailor-approve] tailorResumeForAts failed:", err)
    return extensionError(request, 500, "Failed to analyze resume", { headers })
  }

  const { analysis, atsProfile, atsSummaryRewrite } = tailorResult

  // Apply the ATS-optimized summary rewrite (AI-generated is preferred; heuristic
  // fallback is used when the AI key is not available).
  // Bullet and skill changes are recorded in changes_summary so the user can review
  // them in the Hireoven resume studio — they are NOT auto-applied to the snapshot.
  const tailoredResume: Resume = { ...resume }

  const newSummary = atsSummaryRewrite ?? analysis.summarySuggestion?.suggested
  if (newSummary && newSummary !== resume.summary) {
    tailoredResume.summary = newSummary
  }

  // Safely add "missing_supported" skills (indirect evidence present) to top_skills.
  // These are skills where the resume already contains related evidence — safe to list.
  const safeSkillsToAdd = analysis.skillSuggestions
    .filter((s) => s.status === "missing_supported")
    .map((s) => s.skill)

  if (safeSkillsToAdd.length > 0) {
    const existing = new Set((tailoredResume.top_skills ?? []).map((s) => s.toLowerCase().trim()))
    const additions = safeSkillsToAdd.filter((s) => !existing.has(s.toLowerCase().trim()))
    if (additions.length > 0) {
      tailoredResume.top_skills = [...(tailoredResume.top_skills ?? []), ...additions]
    }
  }

  let snapshot: ReturnType<typeof createResumeSnapshot>
  try {
    snapshot = createResumeSnapshot(tailoredResume)
  } catch (err) {
    console.error("[tailor-approve] createResumeSnapshot failed:", err)
    return extensionError(request, 500, "Failed to create resume snapshot", { headers })
  }

  // ── 4. Ensure table exists and compute next version number ──────────────────

  await ensureResumeVersionsTable(pool)

  let nextVersion = 1
  try {
    const maxVersionRow = await pool.query<{ max_version: number }>(
      `SELECT COALESCE(MAX(version_number), 0) AS max_version
       FROM resume_versions
       WHERE resume_id = $1`,
      [resume.id]
    )
    nextVersion = (maxVersionRow.rows[0]?.max_version ?? 0) + 1
  } catch (err) {
    console.warn("[tailor-approve] max version query failed, defaulting to 1:", err)
  }

  const atsLabel = atsProfile.name !== "Generic ATS" ? ` · ${atsProfile.name}` : ""
  const versionName = [
    "Tailored",
    jobTitle ? `for ${jobTitle}` : null,
    companyName ? `at ${companyName}` : null,
    atsLabel || null,
  ].filter(Boolean).join(" ")

  const changeSummaryParts: string[] = []
  if (newSummary && newSummary !== resume.summary) {
    changeSummaryParts.push(`• Summary rewritten for ${atsProfile.name} ATS + recruiter impact`)
  }
  if (safeSkillsToAdd.length > 0) {
    changeSummaryParts.push(`• Skills aligned to JD (supported by existing experience): ${safeSkillsToAdd.join(", ")}`)
  }
  const needsConfirmSkills = analysis.skillSuggestions
    .filter((s) => s.status === "missing_needs_confirmation")
    .map((s) => s.skill)
  if (needsConfirmSkills.length > 0) {
    changeSummaryParts.push(`• Skills to manually verify & add (if truthfully applicable): ${needsConfirmSkills.slice(0, 6).join(", ")}`)
  }
  if (analysis.bulletSuggestions.length > 0) {
    changeSummaryParts.push(
      `• ${analysis.bulletSuggestions.length} bullet${analysis.bulletSuggestions.length !== 1 ? "s" : ""} flagged for strengthening — review in resume studio`
    )
  }
  changeSummaryParts.push(`• Match score: ${analysis.matchScore}% · ATS: ${atsProfile.name}`)
  const changesSummary = changeSummaryParts.join("\n")

  // ── 5. Insert new version row ───────────────────────────────────────────────

  const versionId = randomUUID()

  try {
    await pool.query(
      `INSERT INTO resume_versions (
         id, resume_id, user_id, version_number, name,
         snapshot, changes_summary, created_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6::jsonb, $7, NOW()
       )`,
      [
        versionId,
        resume.id,
        user.sub,
        nextVersion,
        versionName,
        JSON.stringify(snapshot),
        changesSummary,
      ]
    )
  } catch (err) {
    console.error("[tailor-approve] INSERT into resume_versions failed:", err)
    return extensionError(
      request,
      500,
      "Failed to save tailored resume version. The resume_versions table may not be set up yet - open Hireoven Resume Hub first.",
      { headers }
    )
  }

  return NextResponse.json(
    {
      versionId,
      versionName,
      resumeId: resume.id,
      matchScore: analysis.matchScore,
      changesApplied: changeSummaryParts.length,
    },
    { status: 201, headers }
  )
}

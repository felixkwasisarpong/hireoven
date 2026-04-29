/**
 * POST /api/extension/cover-letter/generate
 *
 * Generates a tailored, ATS-aware cover letter for a specific job using the user's resume.
 * Optimized for both ATS keyword scanning AND the human recruiter who reads it.
 *
 * Strategy:
 *   - ATS pass: exact JD keywords woven naturally into opening paragraph
 *   - Recruiter pass: achievement-first, no filler phrases, specific to the company
 *
 * Safety:
 *   - Read-only on resume/job data.
 *   - Never attaches or uploads anything automatically.
 *   - Never submits the application.
 *
 * Auth: Bearer <ho_session JWT> sent by the Chrome extension.
 */

import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getPostgresPool } from "@/lib/postgres/server"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { getAtsProfile } from "@/lib/resume/ats-tailor"
import {
  extensionError,
  extensionCorsHeaders,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import type { Resume } from "@/types"

export const runtime = "nodejs"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

// ── Fallback template (no API key) ─────────────────────────────────────────────

function buildTemplateCoverLetter(params: {
  firstName: string
  lastName: string
  jobTitle: string | null
  company: string | null
  summary: string | null
  topSkills: string[]
  yearsExperience: number | null
  missingKeywords: string[]
}): string {
  const name = [params.firstName, params.lastName].filter(Boolean).join(" ") || "Applicant"
  const role = params.jobTitle ?? "this role"
  const co = params.company ?? "your company"
  const skills = params.topSkills.slice(0, 5).join(", ")
  const exp = params.yearsExperience ? `${params.yearsExperience} years of experience` : "relevant experience"
  // Weave in up to 2 missing keywords naturally
  const kwPhrase = params.missingKeywords.length > 0
    ? ` My experience extends to ${params.missingKeywords.slice(0, 2).join(" and ")}, which align directly with your team's needs.`
    : ""

  return `Dear Hiring Manager,

I am writing to express my strong interest in the ${role} position at ${co}. With ${exp} and proven expertise in ${skills || "software engineering"}, I am confident in my ability to contribute meaningfully from day one.${kwPhrase}

${params.summary ? params.summary.trim() + "\n\n" : ""}I am particularly drawn to ${co} and the opportunity to tackle the challenges this role presents. I would welcome the chance to discuss how my background aligns with your team's needs.

Thank you for your consideration.

Sincerely,
${name}`
}

// ── Route handlers ─────────────────────────────────────────────────────────────

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
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

  let job: {
    title: string | null
    description: string | null
    company_name: string | null
    location: string | null
    is_remote: boolean | null
  } | null = null

  try {
    const jobRow = await pool.query<{
      title: string | null
      description: string | null
      company_name: string | null
      location: string | null
      is_remote: boolean | null
    }>(
      `SELECT j.title, j.description, j.location, j.is_remote,
              c.name AS company_name
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.id = $1
       LIMIT 1`,
      [jobId]
    )
    job = jobRow.rows[0] ?? null
  } catch (err) {
    console.error("[cover-letter/generate] job fetch failed:", err)
    return extensionError(request, 500, "Failed to fetch job", { headers })
  }

  if (!job) {
    return extensionError(request, 404, "Job not found", { headers })
  }

  const jobTitle = job.title ?? null
  const companyName = job.company_name ?? null
  const jobDescription = job.description ?? ""
  const location = job.location ?? null
  const isRemote = job.is_remote ?? false

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
    console.error("[cover-letter/generate] resume fetch failed:", err)
    return extensionError(request, 500, "Failed to fetch resume", { headers })
  }

  if (!resume) {
    return extensionError(request, 404, "Resume not found", { headers })
  }

  // ── 3. Build context ────────────────────────────────────────────────────────

  const nameParts = (resume.full_name ?? "").trim().split(/\s+/)
  const firstName = nameParts[0] ?? ""
  const lastName = nameParts.slice(1).join(" ")
  const rawSkills = Array.isArray(resume.top_skills)
    ? resume.top_skills
    : Array.isArray(resume.skills)
    ? resume.skills
    : []
  const topSkills = (rawSkills as string[]).slice(0, 8)

  // Quick keyword gap check for template fallback
  const jdLower = jobDescription.toLowerCase()
  const missingKeywords = topSkills.filter((s) => !jdLower.includes(s.toLowerCase())).slice(0, 4)

  // ── 4. ATS profile ──────────────────────────────────────────────────────────

  const atsProfile = getAtsProfile(ats)

  // ── 5. Generate cover letter ────────────────────────────────────────────────

  if (!anthropic) {
    const text = buildTemplateCoverLetter({
      firstName,
      lastName,
      jobTitle,
      company: companyName,
      summary: resume.summary ?? null,
      topSkills,
      yearsExperience: resume.years_of_experience ?? null,
      missingKeywords,
    })
    return NextResponse.json({ coverLetter: text, jobTitle, company: companyName, source: "template" }, { headers })
  }

  // Build a structured resume context — rich enough for Claude but not over-long
  const workExperienceSummary = (resume.work_experience ?? [])
    .slice(0, 3)
    .map((w) => {
      const title = w.title ?? "Role"
      const co = w.company ?? "Company"
      const achievements = (w.achievements ?? []).slice(0, 3).join(" | ")
      return `${title} at ${co}: ${achievements || w.description || "(no details)"}`
    })
    .join("\n")

  const systemPrompt = `You are an elite cover letter writer who has placed candidates at FAANG, top startups, and Fortune 500s. Your letters are famous for two things:
1. They pass ATS scanners without sounding keyword-stuffed
2. They make the recruiter stop scrolling in the first 2 sentences

Your rules:
- NEVER start with "I am writing to apply for" or "I am excited to apply"
- NEVER use: passionate, synergy, leverage, dynamic, results-driven, team player, go-getter, rockstar
- ALWAYS open with something specific: a concrete achievement, a product insight, or a direct capability claim
- ALWAYS reference something specific about the company or role — not generic praise
- Connect the candidate's REAL experience to the role's REAL needs with precision
- Every sentence must earn its place — cut filler ruthlessly
- Sound like a smart, confident person wrote it — not AI

ATS REQUIREMENTS for ${atsProfile.name}:
${atsProfile.bulletInstruction}
Keyword strategy: ${atsProfile.keywordStrategy} matching
Recruiter context: ${atsProfile.recruiterNote}`

  const userPrompt = `Write a cover letter for this candidate. Make it pass ${atsProfile.name} ATS AND be sharp enough that a recruiter reads the whole thing.

CANDIDATE:
Name: ${[firstName, lastName].filter(Boolean).join(" ") || "The candidate"}
Current/target role: ${resume.primary_role ?? resume.work_experience?.[0]?.title ?? "Not specified"}
Years experience: ${resume.years_of_experience ?? "Not specified"}
Top skills: ${topSkills.join(", ") || "Not listed"}
${resume.summary ? `Their professional summary:\n${resume.summary}\n` : ""}
Work experience (most recent first):
${workExperienceSummary || "Not available"}

TARGET ROLE:
Title: ${jobTitle ?? "Not specified"}
Company: ${companyName ?? "Not specified"}
${location ? `Location: ${location}${isRemote ? " (Remote)" : ""}` : isRemote ? "Location: Remote" : ""}
Job description:
${jobDescription.slice(0, 3000)}

ATS CONTEXT:
- This cover letter will be submitted through ${atsProfile.name}
- Keyword strategy: ${atsProfile.keywordStrategy} matching
- ${atsProfile.keywordStrategy === "exact" ? `CRITICAL: weave these exact JD terms naturally into the letter — they must appear verbatim for the ATS to score them.` : `Include 4-6 exact skill phrases from the JD naturally in the text.`}

REQUIREMENTS:
1. Opening sentence: a concrete, role-specific claim — NOT "I am excited to apply"
2. Paragraph 1 (3-4 sentences): your strongest relevant experience + a metric or concrete outcome
3. Paragraph 2 (3-4 sentences): why THIS company / THIS role specifically — be precise, not generic
4. Closing (2 sentences): direct call to action
5. Length: 250–320 words
6. Address: "Dear Hiring Manager" (unless company name makes a better salutation)
7. Sign off: "Sincerely,\\n${[firstName, lastName].filter(Boolean).join(" ") || "Applicant"}"
8. Use only skills/experience truthfully in the resume — no invented claims

Return ONLY the cover letter text. No commentary, no JSON wrapper, no preamble.`

  try {
    const message = await anthropic.messages.create({
      // Cover letters are long-form, high-impact output; Sonnet quality is required.
      model: SONNET_MODEL,
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    })

    const coverLetter = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()

    return NextResponse.json(
      { coverLetter, jobTitle, company: companyName, atsName: atsProfile.name, source: "ai" },
      { headers }
    )
  } catch (err) {
    console.error("[cover-letter/generate] AI generation failed, falling back to template:", err)
    const text = buildTemplateCoverLetter({
      firstName,
      lastName,
      jobTitle,
      company: companyName,
      summary: resume.summary ?? null,
      topSkills,
      yearsExperience: resume.years_of_experience ?? null,
      missingKeywords,
    })
    return NextResponse.json({ coverLetter: text, jobTitle, company: companyName, atsName: atsProfile.name, source: "template" }, { headers })
  }
}

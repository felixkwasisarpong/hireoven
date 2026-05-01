import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { ANTHROPIC_TIER_PRICING, SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { logApiUsage } from "@/lib/admin/usage"
import { getPostgresPool } from "@/lib/postgres/server"
import { buildResumeScoreBreakdown, createGeneratedResume } from "@/lib/resume/hub"
import { buildResumeRawText } from "@/lib/resume/state"
import { createClient } from "@/lib/supabase/server"
import { normalizeSkillsBuckets } from "@/lib/skills/taxonomy"
import type { Education, Profile, Project, Resume, Skills, WorkExperience } from "@/types"
import type {
  ResumeExperienceLevel,
  ResumeGenerationInput,
  ResumeSourceType,
  ResumeStyle,
  ResumeTone,
} from "@/types/resume-hub"

export const runtime = "nodejs"
export const maxDuration = 55

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null
// Resume generation is long-form and quality-critical for user-facing output.
const MODEL = SONNET_MODEL
const MODEL_PRICING = ANTHROPIC_TIER_PRICING.sonnet
const SOURCE_TYPES = new Set<ResumeSourceType>(["profile", "upload", "linkedin", "manual"])
const EXPERIENCE_LEVELS = new Set<ResumeExperienceLevel>(["internship", "entry", "mid", "senior", "executive"])
const STYLES = new Set<ResumeStyle>(["concise", "technical", "executive", "new_grad"])
const TONES = new Set<ResumeTone>(["direct", "polished", "impact_focused"])
const EXPERIENCE_GUIDANCE: Record<ResumeExperienceLevel, string> = {
  internship: "Internship: emphasize education, projects, early experience, and learning velocity. Do not imply senior ownership.",
  entry: "Entry level: keep scope realistic, highlight projects, internships, and foundational production exposure.",
  mid: "Mid Level (3-7 years): show independent ownership, delivery impact, systems experience, and collaboration.",
  senior: "Senior (7+ years): emphasize architecture, leadership, mentoring, production operations, and measurable outcomes.",
  executive: "Executive: emphasize strategy, organization-level outcomes, leadership, and business impact.",
}
const STYLE_GUIDANCE: Record<ResumeStyle, string> = {
  concise: "Concise: use tight wording, short summary, and only the strongest bullets.",
  technical: "Technical: prioritize tools, systems, architecture, integrations, reliability, and implementation depth.",
  executive: "Executive: prioritize leadership, strategy, business outcomes, and scope of ownership.",
  new_grad: "Internship / New Grad: prioritize education, projects, internships, technical foundations, and growth potential.",
}
const TONE_GUIDANCE: Record<ResumeTone, string> = {
  direct: "Direct: clear, plain language with minimal flourish.",
  polished: "Polished: professional, smooth, and recruiter-friendly language.",
  impact_focused: "Impact-focused: lead with outcomes, metrics, scope, and measurable value where source material supports it.",
}
const SOURCE_GUIDANCE: Record<ResumeSourceType, string> = {
  profile: "Use My Profile: use the candidate profile as the main source of truth.",
  upload: "Upload Resume: use the uploaded resume as the main source of truth; preserve real employers, dates, and credentials.",
  linkedin: "Paste LinkedIn / Summary: use the pasted summary as the main source of truth and convert it into resume sections.",
  manual: "Manual Input: use the user's manual notes as the main source of truth.",
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim().replace(/,\s*([}\]])/g, "$1")
  const objectMatch = text.match(/\{[\s\S]*\}/)
  if (!objectMatch) throw new Error("Claude did not return a JSON object")
  return objectMatch[0].replace(/,\s*([}\]])/g, "$1")
}

function truncate(value: string, max = 6000) {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value
}

type ClaudeGeneratedResume = {
  name?: unknown
  summary?: unknown
  work_experience?: unknown
  education?: unknown
  skills?: unknown
  projects?: unknown
  certifications?: unknown
  seniority_level?: unknown
  years_of_experience?: unknown
  primary_role?: unknown
  industries?: unknown
  top_skills?: unknown
}

function stringArray(value: unknown, limit = 12) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, limit)
    : []
}

function mergeClaudeResume(
  fallback: Omit<Resume, "id" | "created_at" | "updated_at">,
  generated: ClaudeGeneratedResume
) {
  const next: Omit<Resume, "id" | "created_at" | "updated_at"> = {
    ...fallback,
    name: typeof generated.name === "string" && generated.name.trim() ? generated.name.trim() : fallback.name,
    summary: typeof generated.summary === "string" && generated.summary.trim() ? generated.summary.trim() : fallback.summary,
    work_experience: Array.isArray(generated.work_experience)
      ? (generated.work_experience as WorkExperience[])
      : fallback.work_experience,
    education: Array.isArray(generated.education) ? (generated.education as Education[]) : fallback.education,
    skills: generated.skills && typeof generated.skills === "object"
      ? normalizeSkillsBuckets(generated.skills as Skills)
      : fallback.skills,
    projects: Array.isArray(generated.projects) ? (generated.projects as Project[]) : fallback.projects,
    certifications: Array.isArray(generated.certifications) ? generated.certifications : fallback.certifications,
    seniority_level: typeof generated.seniority_level === "string"
      ? fallback.seniority_level
      : fallback.seniority_level,
    years_of_experience: typeof generated.years_of_experience === "number"
      ? generated.years_of_experience
      : fallback.years_of_experience,
    primary_role: typeof generated.primary_role === "string" && generated.primary_role.trim()
      ? generated.primary_role.trim()
      : fallback.primary_role,
    industries: stringArray(generated.industries, 6).length ? stringArray(generated.industries, 6) : fallback.industries,
    top_skills: stringArray(generated.top_skills, 10).length ? stringArray(generated.top_skills, 10) : fallback.top_skills,
  }
  next.raw_text = buildResumeRawText(next)
  const score = buildResumeScoreBreakdown(next as Resume)
  next.resume_score = score.overall
  next.ats_score = score.atsReadability
  return next
}

async function generateResumeWithClaude(input: ResumeGenerationInput, userId: string) {
  if (!anthropic) return null

  const sourceContext = [
    input.manualInput ? `SOURCE MATERIAL:\n${truncate(input.manualInput)}` : "",
    input.linkedinSummary ? `LINKEDIN / SUMMARY:\n${truncate(input.linkedinSummary, 3000)}` : "",
    input.jobDescription ? `OPTIONAL JOB DESCRIPTION CONTEXT:\n${truncate(input.jobDescription, 4000)}` : "",
  ].filter(Boolean).join("\n\n")
  const selectionGuidance = [
    SOURCE_GUIDANCE[input.sourceType],
    EXPERIENCE_GUIDANCE[input.experienceLevel],
    STYLE_GUIDANCE[input.resumeStyle],
    TONE_GUIDANCE[input.tone],
  ].join("\n")

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3500,
    system:
      "You are Hireoven's resume generation engine. Generate an ATS-friendly resume draft as structured JSON only. Do not return markdown. Do not fabricate employers, degrees, dates, metrics, or credentials. If source material is thin, write honest placeholder-safe content that clearly needs user review.",
    messages: [
      {
        role: "user",
        content: `Create a resume draft for:
- Target role: ${input.targetRole}
- Target industry: ${input.targetIndustry || "not specified"}
- Experience level: ${input.experienceLevel}
- Resume style: ${input.resumeStyle}
- Tone: ${input.tone}
- Source type: ${input.sourceType}

User-selected generation controls to honor:
${selectionGuidance}

Important distinction:
- The optional job description is only context for general role emphasis, keywords, and expected responsibilities.
- Do NOT make this a tailored-to-one-job resume.
- Do NOT mention a specific company from the job description unless it exists in the candidate's source material.
- Do NOT claim direct experience with tools, domains, metrics, or responsibilities unless they appear in the candidate source.

Return ONLY JSON with this exact shape:
{
  "name": string,
  "summary": string,
  "work_experience": [{
    "company": string,
    "title": string,
    "start_date": string,
    "end_date": string | null,
    "is_current": boolean,
    "description": string,
    "achievements": string[]
  }],
  "education": [{
    "institution": string,
    "degree": string,
    "field": string,
    "start_date": string,
    "end_date": string | null,
    "gpa": string | null
  }],
  "skills": {
    "technical": string[],
    "soft": string[],
    "languages": string[],
    "certifications": string[]
  },
  "projects": [{
    "name": string,
    "description": string,
    "url": string | null,
    "technologies": string[]
  }],
  "certifications": [],
  "years_of_experience": number,
  "primary_role": string,
  "industries": string[],
  "top_skills": string[]
}

${sourceContext || "No source material was provided. Generate a conservative draft that clearly requires user review."}`,
      },
    ],
  })

  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  const costUsd =
    (inputTokens / 1_000_000) * MODEL_PRICING.inputPerMillion +
    (outputTokens / 1_000_000) * MODEL_PRICING.outputPerMillion

  await logApiUsage({
    service: "claude",
    operation: "resume_generate",
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(costUsd.toFixed(6)),
  })

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
  const parsed = JSON.parse(extractJsonObject(text)) as ClaudeGeneratedResume
  const fallback = createGeneratedResume(input, userId)
  return mergeClaudeResume(fallback, parsed)
}

function parseInput(body: Record<string, unknown>): ResumeGenerationInput | null {
  const targetRole = asString(body.targetRole).trim()
  if (!targetRole) return null
  const sourceType = SOURCE_TYPES.has(body.sourceType as ResumeSourceType)
    ? (body.sourceType as ResumeSourceType)
    : "profile"
  const experienceLevel = EXPERIENCE_LEVELS.has(body.experienceLevel as ResumeExperienceLevel)
    ? (body.experienceLevel as ResumeExperienceLevel)
    : "mid"
  const resumeStyle = STYLES.has(body.resumeStyle as ResumeStyle)
    ? (body.resumeStyle as ResumeStyle)
    : "concise"
  const tone = TONES.has(body.tone as ResumeTone) ? (body.tone as ResumeTone) : "polished"

  return {
    sourceType,
    sourceResumeId: asString(body.sourceResumeId).trim() || null,
    targetRole,
    experienceLevel,
    resumeStyle,
    tone,
    targetIndustry: asString(body.targetIndustry).trim(),
    jobDescription: asString(body.jobDescription).trim(),
    linkedinSummary: asString(body.linkedinSummary).trim(),
    manualInput: asString(body.manualInput).trim(),
  }
}

async function ensureResumeGenerateColumns() {
  const pool = getPostgresPool()
  await pool.query(
    `ALTER TABLE resumes
       ADD COLUMN IF NOT EXISTS file_type TEXT,
       ADD COLUMN IF NOT EXISTS parse_error TEXT,
       ADD COLUMN IF NOT EXISTS github_url TEXT,
       ADD COLUMN IF NOT EXISTS certifications JSONB,
       ADD COLUMN IF NOT EXISTS ats_score INTEGER,
       ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
       ALTER COLUMN file_url DROP NOT NULL,
       ALTER COLUMN storage_path DROP NOT NULL`
  )
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const input = parseInput(body)
  if (!input) {
    return NextResponse.json({ error: "targetRole is required" }, { status: 400 })
  }

  const pool = getPostgresPool()
  await ensureResumeGenerateColumns()
  let generationInput = input

  if (input.sourceType === "upload" && input.sourceResumeId) {
    const sourceResult = await pool.query<Resume>(
      `SELECT *
       FROM resumes
       WHERE id = $1
         AND user_id = $2
       LIMIT 1`,
      [input.sourceResumeId, user.id]
    )
    const sourceResume = sourceResult.rows[0]
    if (sourceResume) {
      generationInput = {
        ...input,
        manualInput: [
          sourceResume.raw_text,
          sourceResume.summary,
          sourceResume.primary_role ? `Current role focus: ${sourceResume.primary_role}` : "",
          sourceResume.top_skills?.length ? `Skills: ${sourceResume.top_skills.join(", ")}` : "",
          input.manualInput,
        ]
          .filter(Boolean)
          .join("\n\n"),
      }
    }
  }

  if (input.sourceType === "profile") {
    const profileResult = await pool.query<Profile>(
      `SELECT *
       FROM profiles
       WHERE id = $1
       LIMIT 1`,
      [user.id]
    )
    const profile = profileResult.rows[0]
    if (profile) {
      generationInput = {
        ...input,
        manualInput: [
          profile.full_name ? `Candidate: ${profile.full_name}` : "",
          profile.desired_roles?.length ? `Desired roles: ${profile.desired_roles.join(", ")}` : "",
          profile.top_skills?.length ? `Skills: ${profile.top_skills.join(", ")}` : "",
          profile.seniority_level ? `Seniority: ${profile.seniority_level}` : "",
          profile.desired_locations?.length ? `Locations: ${profile.desired_locations.join(", ")}` : "",
          input.manualInput,
        ]
          .filter(Boolean)
          .join("\n\n"),
      }
    }
  }

  const existing = await pool.query<{ has_primary: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM resumes WHERE user_id = $1 AND is_primary = true
     ) AS has_primary`,
    [user.id]
  )
  const shouldBePrimary = !existing.rows[0]?.has_primary
  if (shouldBePrimary) {
    await pool.query(`UPDATE resumes SET is_primary = false WHERE user_id = $1`, [user.id])
  }

  let draft: Omit<Resume, "id" | "created_at" | "updated_at">
  try {
    draft = (await generateResumeWithClaude(generationInput, user.id)) ?? createGeneratedResume(generationInput, user.id)
  } catch (error) {
    console.error("Claude resume generation failed; falling back to local generator", error)
    draft = createGeneratedResume(generationInput, user.id)
  }
  const result = await pool.query<Resume>(
    `INSERT INTO resumes (
      user_id,
      file_name,
      name,
      file_url,
      storage_path,
      file_size,
      file_type,
      is_primary,
      parse_status,
      parse_error,
      full_name,
      email,
      phone,
      location,
      linkedin_url,
      portfolio_url,
      github_url,
      summary,
      work_experience,
      education,
      skills,
      projects,
      certifications,
      seniority_level,
      years_of_experience,
      primary_role,
      industries,
      top_skills,
      resume_score,
      ats_score,
      raw_text
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19::jsonb, $20::jsonb,
      $21::jsonb, $22::jsonb, $23::jsonb, $24,
      $25, $26, $27::text[], $28::text[], $29, $30, $31
    )
    RETURNING *`,
    [
      draft.user_id,
      draft.file_name,
      draft.name,
      draft.file_url,
      draft.storage_path,
      draft.file_size,
      draft.file_type ?? "generated",
      shouldBePrimary,
      draft.parse_status,
      draft.parse_error ?? null,
      draft.full_name,
      draft.email,
      draft.phone,
      draft.location,
      draft.linkedin_url,
      draft.portfolio_url,
      draft.github_url ?? null,
      draft.summary,
      JSON.stringify(draft.work_experience ?? null),
      JSON.stringify(draft.education ?? null),
      JSON.stringify(draft.skills ?? null),
      JSON.stringify(draft.projects ?? null),
      JSON.stringify(draft.certifications ?? null),
      draft.seniority_level,
      draft.years_of_experience,
      draft.primary_role,
      draft.industries ?? [],
      draft.top_skills ?? [],
      draft.resume_score,
      draft.ats_score ?? null,
      draft.raw_text,
    ]
  )

  const resume = result.rows[0]
  return NextResponse.json({ resume, resumeId: resume?.id })
}

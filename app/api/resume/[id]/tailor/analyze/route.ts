import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getSessionUser } from "@/lib/auth/session-user"
import {
  buildLocalTailorAnalysis,
  mergeTailorResults,
  normalizeTailorAnalysis,
  pruneSkillNoiseFromAnalysis,
} from "@/lib/resume/tailor-analysis"
import { getPostgresPool } from "@/lib/postgres/server"
import { isUuid } from "@/lib/resume/hub"
import type { Resume } from "@/types"

export const runtime = "nodejs"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null
const MODEL = "claude-sonnet-4-6"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- allow runtime JSON from LLM
function extractJsonObject(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim().replace(/,\s*([}\]])/g, "$1"))
  }
  const objectMatch = text.match(/\{[\s\S]*\}/)
  if (!objectMatch) throw new Error("no_json_object")
  return JSON.parse(objectMatch[0].replace(/,\s*([}\]])/g, "$1"))
}

type Body = {
  resume?: Resume | null
  jobDescription?: string
  jobTitle?: string | null
  company?: string | null
  currentSkillsText?: string
  currentSummary?: string
  currentExperience?: { company: string; role: string; description: string }[]
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { id: resumeId } = params
  if (!isUuid(resumeId)) {
    return NextResponse.json({ error: "Invalid resume id" }, { status: 400 })
  }
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as Body
  const jobDescription = typeof body.jobDescription === "string" ? body.jobDescription.trim() : ""
  if (!jobDescription) {
    return NextResponse.json({ error: "jobDescription is required" }, { status: 400 })
  }

  const pool = getPostgresPool()
  const own = await pool.query<Resume>(`SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`, [
    resumeId,
    user.sub,
  ])
  const row = own.rows[0] ?? null
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const skillsText = typeof body.currentSkillsText === "string" ? body.currentSkillsText : ""
  const profileSummary = typeof body.currentSummary === "string" ? body.currentSummary : ""
  const experienceDraft = Array.isArray(body.currentExperience)
    ? body.currentExperience
    : (row as Resume).work_experience?.map((w) => ({
        company: w.company ?? "",
        role: w.title ?? "",
        description: [w.description, ...(w.achievements ?? [])].filter(Boolean).join("\n") || "",
      })) ?? []

  const liveResume: Resume = body.resume && typeof body.resume === "object" ? { ...row, ...body.resume, id: resumeId } : row

  const local = buildLocalTailorAnalysis({
    resume: liveResume,
    jobDescription,
    skillsText: skillsText || (typeof liveResume !== "object" ? "" : ""),
    profileSummary,
    experienceDraft,
  })

  if (!anthropic) {
    return NextResponse.json({ analysis: pruneSkillNoiseFromAnalysis(local) })
  }

  try {
    const resumeJson = JSON.stringify(
      {
        id: liveResume.id,
        summary: liveResume.summary,
        work_experience: liveResume.work_experience,
        skills: liveResume.skills,
        top_skills: liveResume.top_skills,
        raw_text: (liveResume.raw_text ?? "").slice(0, 12_000),
        projects: liveResume.projects,
      },
      null,
      0
    )

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 12_000,
      system:
        "You are a resume tailoring engine. You help job seekers align their resume to a job description without fabricating experience. " +
        "Use add_skill only for concrete tools, languages, platforms, frameworks, and domain technologies (e.g. Terraform, TypeScript, Kafka). " +
        "Do NOT use add_skill for traits like 'communication', 'stakeholder management', or generic hiring adjectives. " +
        "Include replace_bullet items for: (1) vague or duty-style lines, (2) short bullets with no impact signal, and (3) lines that omit posting tools that already appear elsewhere in the same work experience. " +
        "For bullet rewrites, propose 1–2 strong alternatives that thread real tools from the job into facts implied by the resume. " +
        "You must only suggest additions that are supported by the resume or clearly mark them as requiring confirmation. " +
        "Never invent employers, dates, certifications, tools, metrics, or responsibilities. Return JSON only, no markdown wrapper.",
      messages: [
        {
          role: "user",
          content: `Analyze this resume and job description.

Return JSON only with this schema (all keys required where applicable, fixes must be a flat array; use "strong"|"moderate"|"weak" for roleAlignment):
{
  "matchScore": number,
  "roleAlignment": "strong" | "moderate" | "weak",
  "presentKeywords": string[],
  "missingKeywords": string[],
  "skillSuggestions": [
    { "skill": string, "status": "present" | "missing_supported" | "missing_needs_confirmation" | "not_recommended", "evidence": string, "reason": string, "targetSection": "skills" | "experience" | "do_not_add" }
  ],
  "bulletSuggestions": [
    { "id": string, "experienceId": string, "company": string, "role": string, "original": string, "issue": string, "suggested": string, "reason": string, "confidence": "high" | "medium" | "low" }
  ],
  "summarySuggestion": { "original": string, "issue": string, "suggested": string, "reason": string, "confidence": "high" | "medium" | "low" },
  "fixes": [
    { "id": string, "type": "add_skill" | "replace_bullet" | "replace_summary", "label": string, "reason": string, "requiresConfirmation": boolean, "skill": string, "target": "skills", "before": string, "after": string, "experienceId": string, "original": string, "suggested": string }
  ],
  "warnings": string[]
}

Resume (JSON, truth source):
${resumeJson}

Current skills text:
${skillsText.slice(0, 8_000)}

Current profile summary:
${profileSummary.slice(0, 4_000)}

Current experience (editor draft, JSON):
${JSON.stringify(experienceDraft).slice(0, 12_000)}

Job description:
${jobDescription.slice(0, 14_000)}

Job title context: ${body.jobTitle ?? ""}
Company context: ${body.company ?? ""}

For fixes: include stable ids. experienceId should match a role block like "exp-0" if the bullet is for the first experience in the order above. Use before/after for add_skill. Only suggest skills as missing_supported if resume evidence exists; use missing_needs_confirmation if uncertain. Use not_recommended when the posting asks for a skill with no support.

Return JSON only.`,
        },
      ],
    })
    const text = message.content
      .map((b) => (b.type === "text" && "text" in b ? b.text : ""))
      .join("\n")
    const parsed = extractJsonObject(text)
    const fromModel = normalizeTailorAnalysis(parsed)
    const analysis = pruneSkillNoiseFromAnalysis(mergeTailorResults(local, fromModel))
    return NextResponse.json({ analysis })
  } catch {
    return NextResponse.json({ analysis: pruneSkillNoiseFromAnalysis(local) })
  }
}

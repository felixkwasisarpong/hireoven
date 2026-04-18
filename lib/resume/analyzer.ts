import Anthropic from "@anthropic-ai/sdk"
import { logApiUsage } from "@/lib/admin/usage"
import { createAdminClient } from "@/lib/supabase/admin"
import type {
  AnalysisRecommendation,
  AnalysisVerdict,
  ApplyRecommendation,
  Company,
  ExperienceMatch,
  Job,
  Resume,
  ResumeAnalysis,
  ResumeAnalysisInsert,
} from "@/types"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const MODEL = "claude-sonnet-4-6"
const MODEL_PRICING = { inputPerMillion: 3, outputPerMillion: 15 }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function buildPrompt(resume: Resume, job: Job & { company: Company }): string {
  const workSummary = (resume.work_experience ?? [])
    .slice(0, 3)
    .map(
      (w) =>
        `${w.title} at ${w.company} (${w.start_date} - ${w.end_date ?? "Present"}): ${w.description.slice(0, 200)}`
    )
    .join("\n")

  const educationSummary = (resume.education ?? [])
    .map((e) => `${e.degree} in ${e.field} from ${e.institution}`)
    .join("\n")

  return `Analyze this candidate's resume against this job posting. Be honest and specific. Return ONLY valid JSON.

JOB POSTING:
Title: ${job.title}
Company: ${job.company.name}
Industry: ${job.company.industry ?? "Unknown"}
Seniority: ${job.seniority_level ?? "Not specified"}
Location: ${job.is_remote ? "Remote" : (job.location ?? "Not specified")}
Required skills: ${(job.skills ?? []).join(", ") || "Not specified"}
Job description:
${(job.description ?? "").slice(0, 4000)}

CANDIDATE RESUME:
Name: ${resume.full_name ?? "Unknown"}
Current/Recent role: ${resume.primary_role ?? "Not specified"}
Years of experience: ${resume.years_of_experience ?? "Unknown"}
Seniority level: ${resume.seniority_level ?? "Not specified"}
Top skills: ${(resume.top_skills ?? []).join(", ") || "Not specified"}
All technical skills: ${(resume.skills?.technical ?? []).join(", ") || "Not specified"}

Work experience summary:
${workSummary || "Not available"}

Education:
${educationSummary || "Not available"}

Full resume text for keyword analysis:
${(resume.raw_text ?? "").slice(0, 3000)}

Return this exact JSON structure:
{
  "overall_score": 0-100,
  "skills_score": 0-100,
  "experience_score": 0-100,
  "education_score": 0-100,
  "keywords_score": 0-100,
  "matching_skills": ["string"],
  "missing_skills": ["string"],
  "bonus_skills": ["string"],
  "matching_keywords": ["string"],
  "missing_keywords": ["string"],
  "keyword_density": { "keyword": count },
  "experience_match": {
    "required_years": number or null,
    "candidate_years": number,
    "matching_roles": ["string"],
    "gaps": ["string"]
  },
  "recommendations": [
    {
      "priority": "high|medium|low",
      "category": "skills|experience|keywords|format",
      "issue": "string",
      "fix": "string"
    }
  ],
  "verdict": "strong_match|good_match|partial_match|weak_match",
  "verdict_summary": "2-3 sentence honest summary",
  "apply_recommendation": "apply_now|apply_with_tweaks|stretch_role|skip",
  "apply_reasoning": "1-2 sentence reasoning"
}

Scoring guide:
- 80-100: Strong match, candidate clearly qualified
- 60-79: Good match, minor gaps
- 40-59: Partial match, significant gaps but not disqualifying
- 0-39: Weak match, major gaps

Be HONEST. Missing required skills should heavily impact the score.
"You're missing React which appears 8 times in the JD" is more useful than vague encouragement.
If the candidate is underqualified, say so. If overqualified, note that too.`
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? text).trim()
  const objectMatch = candidate.match(/\{[\s\S]*\}/)
  if (!objectMatch) throw new Error("No JSON object found in Claude response")
  return objectMatch[0].replace(/,\s*([}\]])/g, "$1")
}

function clampScore(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null
  return Math.min(100, Math.max(0, Math.round(value)))
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string")
}

function normalizeAnalysis(
  raw: unknown,
  candidateYearsFallback: number
): Omit<ResumeAnalysisInsert, "user_id" | "resume_id" | "job_id"> {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const expRaw = (d.experience_match && typeof d.experience_match === "object"
    ? d.experience_match
    : {}) as Record<string, unknown>

  const recommendations: AnalysisRecommendation[] = Array.isArray(d.recommendations)
    ? d.recommendations
        .filter(
          (r): r is Record<string, unknown> =>
            r !== null && typeof r === "object" && typeof r.issue === "string"
        )
        .map((r) => ({
          priority: (["high", "medium", "low"].includes(r.priority as string)
            ? r.priority
            : "medium") as "high" | "medium" | "low",
          category: (["skills", "experience", "keywords", "format"].includes(r.category as string)
            ? r.category
            : "skills") as "skills" | "experience" | "keywords" | "format",
          issue: String(r.issue),
          fix: typeof r.fix === "string" ? r.fix : "",
        }))
    : []

  const VERDICTS: AnalysisVerdict[] = ["strong_match", "good_match", "partial_match", "weak_match"]
  const verdict: AnalysisVerdict = VERDICTS.includes(d.verdict as AnalysisVerdict)
    ? (d.verdict as AnalysisVerdict)
    : "partial_match"

  const RECS: ApplyRecommendation[] = ["apply_now", "apply_with_tweaks", "stretch_role", "skip"]
  const applyRec: ApplyRecommendation = RECS.includes(d.apply_recommendation as ApplyRecommendation)
    ? (d.apply_recommendation as ApplyRecommendation)
    : "apply_with_tweaks"

  const experienceMatch: ExperienceMatch = {
    required_years:
      typeof expRaw.required_years === "number" ? expRaw.required_years : null,
    candidate_years:
      typeof expRaw.candidate_years === "number"
        ? expRaw.candidate_years
        : candidateYearsFallback,
    matching_roles: toStringArray(expRaw.matching_roles),
    gaps: toStringArray(expRaw.gaps),
  }

  const keywordDensity =
    d.keyword_density && typeof d.keyword_density === "object" && !Array.isArray(d.keyword_density)
      ? (d.keyword_density as Record<string, number>)
      : null

  return {
    overall_score: clampScore(d.overall_score),
    skills_score: clampScore(d.skills_score),
    experience_score: clampScore(d.experience_score),
    education_score: clampScore(d.education_score),
    keywords_score: clampScore(d.keywords_score),
    matching_skills: toStringArray(d.matching_skills),
    missing_skills: toStringArray(d.missing_skills),
    bonus_skills: toStringArray(d.bonus_skills),
    matching_keywords: toStringArray(d.matching_keywords),
    missing_keywords: toStringArray(d.missing_keywords),
    keyword_density: keywordDensity,
    experience_match: experienceMatch,
    recommendations,
    verdict,
    verdict_summary: typeof d.verdict_summary === "string" ? d.verdict_summary : null,
    apply_recommendation: applyRec,
    apply_reasoning: typeof d.apply_reasoning === "string" ? d.apply_reasoning : null,
  }
}

async function callClaude(
  resume: Resume,
  job: Job & { company: Company }
): Promise<ReturnType<typeof normalizeAnalysis>> {
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY not configured")

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system:
      "You are an expert career coach and resume analyst with deep knowledge of ATS systems, hiring practices, and what recruiters actually look for. You give honest, actionable analysis — not vague encouragement.",
    messages: [{ role: "user", content: buildPrompt(resume, job) }],
  })

  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  const costUsd =
    (inputTokens / 1_000_000) * MODEL_PRICING.inputPerMillion +
    (outputTokens / 1_000_000) * MODEL_PRICING.outputPerMillion

  await logApiUsage({
    service: "claude",
    operation: "resume_analyze",
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(costUsd.toFixed(6)),
  })

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")

  const parsed = JSON.parse(extractJsonObject(text))
  return normalizeAnalysis(parsed, resume.years_of_experience ?? 0)
}

export async function analyzeResumeForJob(
  resume: Resume,
  job: Job & { company: Company },
  userId: string
): Promise<ResumeAnalysis> {
  const supabase = createAdminClient()

  // Check cache
  const { data: cached } = await (supabase
    .from("resume_analyses")
    .select("*")
    .eq("user_id", userId)
    .eq("resume_id", resume.id)
    .eq("job_id", job.id)
    .gte("created_at", new Date(Date.now() - CACHE_TTL_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single() as any)

  if (cached) return cached as ResumeAnalysis

  let fields: ReturnType<typeof normalizeAnalysis>
  try {
    fields = await callClaude(resume, job)
  } catch (err) {
    console.error("Claude analysis failed, retrying with simplified prompt", err)
    try {
      fields = await callClaude(resume, job)
    } catch {
      fields = normalizeAnalysis(null, resume.years_of_experience ?? 0)
    }
  }

  const payload: ResumeAnalysisInsert = {
    user_id: userId,
    resume_id: resume.id,
    job_id: job.id,
    ...fields,
  }

  const { data: inserted, error } = await (supabase
    .from("resume_analyses")
    .insert(payload as any)
    .select("*")
    .single() as any)

  if (error || !inserted) throw error ?? new Error("Failed to save analysis")
  return inserted as ResumeAnalysis
}

export async function getCachedAnalysis(
  userId: string,
  resumeId: string,
  jobId: string
): Promise<ResumeAnalysis | null> {
  const supabase = createAdminClient()
  const { data } = await (supabase
    .from("resume_analyses")
    .select("*")
    .eq("user_id", userId)
    .eq("resume_id", resumeId)
    .eq("job_id", jobId)
    .gte("created_at", new Date(Date.now() - CACHE_TTL_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single() as any)

  return (data as ResumeAnalysis | null) ?? null
}

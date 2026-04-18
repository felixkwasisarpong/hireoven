import Anthropic from "@anthropic-ai/sdk"
import { logApiUsage } from "@/lib/admin/usage"
import { calculateResumeScore, deriveResumeFields } from "@/lib/resume/scoring"
import type {
  Job,
  Resume,
  ResumeEditContext,
  ResumeEditType,
  ResumeSection,
  Skills,
  WorkExperience,
} from "@/types"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const MODEL = "claude-sonnet-4-20250514"
const MODEL_PRICING = {
  inputPerMillion: 3,
  outputPerMillion: 15,
}

type TargetJobContext = Pick<Job, "title" | "description">

function cleanString(value: unknown) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? text).trim()
  const objectMatch = candidate.match(/\{[\s\S]*\}/)

  if (!objectMatch) {
    throw new Error("No JSON object found in Claude response")
  }

  return objectMatch[0].replace(/,\s*([}\]])/g, "$1")
}

function extractText(message: Anthropic.Messages.Message) {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim()
}

async function logClaudeUsage(message: Anthropic.Messages.Message, operation: string) {
  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  const costUsd =
    (inputTokens / 1_000_000) * MODEL_PRICING.inputPerMillion +
    (outputTokens / 1_000_000) * MODEL_PRICING.outputPerMillion

  await logApiUsage({
    service: "claude",
    operation,
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(costUsd.toFixed(6)),
  })
}

async function requestTextCompletion({
  system,
  user,
  operation,
}: {
  system: string
  user: string
  operation: string
}) {
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY not configured")
  }

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: user }],
  })

  await logClaudeUsage(message, operation)
  return extractText(message)
}

function extractKeywordsAdded(original: string, suggestion: string, keywords: string[]) {
  const originalLower = original.toLowerCase()
  const suggestionLower = suggestion.toLowerCase()

  return keywords.filter((keyword) => {
    const normalized = keyword.toLowerCase()
    return suggestionLower.includes(normalized) && !originalLower.includes(normalized)
  })
}

export async function rewriteBulletPoint(
  original: string,
  context: {
    jobTitle: string
    company: string
    missingKeywords: string[]
    targetJob?: TargetJobContext
    editType: ResumeEditType
  }
): Promise<{ suggestion: string; keywordsAdded: string[] }> {
  const system =
    "You are an expert resume writer who helps candidates present their real experience compellingly. You never fabricate experience or skills. You help candidates articulate what they actually did in stronger terms. Your rewrites sound human and natural, never like AI-generated corporate speak. Keep the candidate's voice and first-person perspective."

  const targetJobLine = context.targetJob
    ? `Target job: ${context.targetJob.title}\nTarget job description:\n${(context.targetJob.description ?? "").slice(0, 1800)}`
    : ""

  let userPrompt = ""

  if (context.editType === "rewrite") {
    userPrompt = `Rewrite this resume bullet point to be stronger and more impactful. Keep it truthful and only use information implied by the original. Start with a strong action verb.

Original: ${original}
Role this was for: ${context.jobTitle} at ${context.company}
${targetJobLine}

Rules:
- Start with a strong past-tense action verb
- Be specific and concrete
- Keep under 2 lines
- Sound human, not robotic
- Do NOT add metrics that are not implied
- Do NOT add skills that are not mentioned

Return ONLY the rewritten bullet, no explanation.`
  } else if (context.editType === "quantify") {
    userPrompt = `This bullet point is missing numbers and metrics. Suggest a version with placeholders for the candidate to fill in with real numbers.

Original: ${original}
Role: ${context.jobTitle} at ${context.company}

Rewrite it with [X%], [X users], [$X], [X projects], or [X hrs] placeholders where metrics would naturally fit.

Return ONLY the rewritten bullet with placeholders.`
  } else if (context.editType === "keyword_inject") {
    userPrompt = `Naturally incorporate these missing keywords into this bullet point without making it sound forced or fake. Only add keywords that genuinely relate to what the bullet is already describing.

Original: ${original}
Keywords to incorporate (use only relevant ones): ${context.missingKeywords.join(", ")}
${targetJobLine}

If no keywords fit naturally, return the original unchanged.
Return ONLY the rewritten bullet, no explanation.`
  } else if (context.editType === "expand") {
    userPrompt = `This bullet point is too vague. Expand it with more detail about what the candidate likely did in this role. Ask yourself: how did they do it, what was the impact, and what tools did they use?

Original: ${original}
Role: ${context.jobTitle} at ${context.company}

Expand to 1-2 sentences max. Stay truthful.
Return ONLY the expanded version.`
  } else {
    userPrompt = `Shorten this bullet point to one clear, punchy line. Keep the most important information.

Original: ${original}

Return ONLY the shortened version.`
  }

  try {
    const suggestion = cleanString(
      await requestTextCompletion({
        system,
        user: userPrompt,
        operation: `resume_edit_${context.editType}`,
      })
    ) ?? original

    return {
      suggestion,
      keywordsAdded: extractKeywordsAdded(original, suggestion, context.missingKeywords),
    }
  } catch (error) {
    console.error("rewriteBulletPoint failed", error)
    return { suggestion: original, keywordsAdded: [] }
  }
}

export async function improveSummary(
  currentSummary: string | null,
  resume: Resume,
  targetJob?: (Job & { company?: { name?: string | null } | null })
): Promise<string> {
  const system =
    "You are an expert resume writer who helps candidates sound sharp, credible, and human. You never use cliched fluff or AI-sounding business jargon."

  const userPrompt = `Write a professional resume summary for this candidate.${targetJob ? " Tailor it toward this specific role." : ""}

Candidate: ${resume.full_name ?? "Unknown candidate"}
Current role: ${resume.primary_role ?? "Unknown"}
Years experience: ${resume.years_of_experience ?? "Unknown"}
Top skills: ${(resume.top_skills ?? []).join(", ") || "Not provided"}
Recent companies: ${(resume.work_experience ?? [])
    .slice(0, 2)
    .map((item) => item.company)
    .join(", ") || "Not provided"}
Current summary: ${currentSummary ?? "None"}
${targetJob ? `Target role: ${targetJob.title} at ${targetJob.company?.name ?? "Unknown company"}\nTarget description:\n${(targetJob.description ?? "").slice(0, 2400)}` : ""}

Rules:
- 2-4 sentences maximum
- Start with years of experience and specialty
- Mention 2-3 key strengths
- End with what they bring to a new role
- Do NOT use: passionate, dynamic, synergy, leverage, guru, ninja, rockstar
- Sound like a real person wrote it
- First person implied, not explicit

Return ONLY the summary text.`

  try {
    return (
      cleanString(
        await requestTextCompletion({
          system,
          user: userPrompt,
          operation: "resume_summary_improve",
        })
      ) ?? currentSummary ?? ""
    )
  } catch (error) {
    console.error("improveSummary failed", error)
    return currentSummary ?? ""
  }
}

export async function generateSkillsSuggestions(
  currentSkills: Skills,
  missingSkills: string[],
  jobDescription: string
): Promise<{
  skillsToAdd: string[]
  skillsToRemove: string[]
  skillsToHighlight: string[]
}> {
  const system =
    "You are a pragmatic resume strategist. Recommend only skills that plausibly belong on the candidate's resume, and never ask them to add tools they do not appear to know."

  const fallback = {
    skillsToAdd: missingSkills.slice(0, 8),
    skillsToRemove: [] as string[],
    skillsToHighlight: currentSkills.technical.slice(0, 5),
  }

  try {
    const text = await requestTextCompletion({
      system,
      user: `Analyze this resume skills list against the job description and return only valid JSON.

Current skills:
Technical: ${currentSkills.technical.join(", ")}
Soft: ${currentSkills.soft.join(", ")}
Languages: ${currentSkills.languages.join(", ")}
Certifications: ${currentSkills.certifications.join(", ")}

Missing skills from analysis: ${missingSkills.join(", ")}

Job description:
${jobDescription.slice(0, 3000)}

Return this exact JSON structure:
{
  "skillsToAdd": ["string"],
  "skillsToRemove": ["string"],
  "skillsToHighlight": ["string"]
}`,
      operation: "resume_skills_suggestions",
    })

    const parsed = JSON.parse(extractJsonObject(text)) as {
      skillsToAdd?: unknown
      skillsToRemove?: unknown
      skillsToHighlight?: unknown
    }

    return {
      skillsToAdd: Array.isArray(parsed.skillsToAdd)
        ? parsed.skillsToAdd.filter((value): value is string => typeof value === "string").slice(0, 10)
        : fallback.skillsToAdd,
      skillsToRemove: Array.isArray(parsed.skillsToRemove)
        ? parsed.skillsToRemove.filter((value): value is string => typeof value === "string").slice(0, 8)
        : fallback.skillsToRemove,
      skillsToHighlight: Array.isArray(parsed.skillsToHighlight)
        ? parsed.skillsToHighlight.filter((value): value is string => typeof value === "string").slice(0, 8)
        : fallback.skillsToHighlight,
    }
  } catch (error) {
    console.error("generateSkillsSuggestions failed", error)
    return fallback
  }
}

export async function rewriteFullExperience(
  experience: WorkExperience,
  targetJob: Job,
  missingKeywords: string[]
): Promise<WorkExperience> {
  const rewrittenAchievements = await Promise.all(
    experience.achievements.map((achievement) =>
      rewriteBulletPoint(achievement, {
        jobTitle: experience.title,
        company: experience.company,
        missingKeywords,
        targetJob: {
          title: targetJob.title,
          description: targetJob.description ?? "",
        },
        editType: "rewrite",
      }).then((result) => result.suggestion)
    )
  )

  return {
    ...experience,
    achievements: rewrittenAchievements,
  }
}

export function buildResumeRawText(resume: Pick<
  Resume,
  | "full_name"
  | "summary"
  | "work_experience"
  | "education"
  | "skills"
  | "projects"
>) {
  const skills = resume.skills
    ? [
        ...resume.skills.technical,
        ...resume.skills.soft,
        ...resume.skills.languages,
        ...resume.skills.certifications,
      ]
    : []

  return [
    resume.full_name,
    resume.summary,
    ...(resume.work_experience ?? []).flatMap((item) => [
      item.title,
      item.company,
      item.description,
      ...item.achievements,
    ]),
    ...(resume.education ?? []).flatMap((item) => [
      item.institution,
      item.degree,
      item.field,
    ]),
    ...skills,
    ...(resume.projects ?? []).flatMap((item) => [
      item.name,
      item.description,
      ...(item.technologies ?? []),
    ]),
  ]
    .filter(Boolean)
    .join("\n")
    .trim()
}

export function applyResumeEditContent(
  resume: Resume,
  section: ResumeSection,
  content: unknown,
  context?: ResumeEditContext | null
) {
  const next: Resume = {
    ...resume,
    work_experience: resume.work_experience ? [...resume.work_experience] : [],
    education: resume.education ? [...resume.education] : [],
    projects: resume.projects ? [...resume.projects] : [],
    skills: resume.skills
      ? {
          technical: [...resume.skills.technical],
          soft: [...resume.skills.soft],
          languages: [...resume.skills.languages],
          certifications: [...resume.skills.certifications],
        }
      : { technical: [], soft: [], languages: [], certifications: [] },
  }

  if (section === "summary" && typeof content === "string") {
    next.summary = content.trim()
  }

  if (section === "work_experience") {
    if (typeof context?.experienceIndex === "number" && typeof context?.bulletIndex === "number" && typeof content === "string") {
      const experience = next.work_experience?.[context.experienceIndex]
      if (experience && Array.isArray(experience.achievements)) {
        experience.achievements = experience.achievements.map((item, index) =>
          index === context.bulletIndex ? content : item
        )
      }
    } else if (typeof context?.experienceIndex === "number" && content && typeof content === "object" && !Array.isArray(content)) {
      const current = next.work_experience?.[context.experienceIndex]
      if (current) {
        next.work_experience![context.experienceIndex] = {
          ...current,
          ...(content as WorkExperience),
        }
      }
    } else if (Array.isArray(content)) {
      next.work_experience = content as WorkExperience[]
    }
  }

  if (section === "skills" && content && typeof content === "object") {
    next.skills = {
      technical: Array.isArray((content as Skills).technical) ? (content as Skills).technical : next.skills?.technical ?? [],
      soft: Array.isArray((content as Skills).soft) ? (content as Skills).soft : next.skills?.soft ?? [],
      languages: Array.isArray((content as Skills).languages) ? (content as Skills).languages : next.skills?.languages ?? [],
      certifications: Array.isArray((content as Skills).certifications) ? (content as Skills).certifications : next.skills?.certifications ?? [],
    }
  }

  if (section === "education" && Array.isArray(content)) {
    next.education = content as Resume["education"]
  }

  if (section === "projects" && Array.isArray(content)) {
    next.projects = content as Resume["projects"]
  }

  next.raw_text = buildResumeRawText(next)
  const derived = deriveResumeFields(next)

  next.resume_score = calculateResumeScore(next)
  next.top_skills = derived.top_skills
  next.primary_role = derived.primary_role
  next.years_of_experience = derived.years_of_experience

  return next
}

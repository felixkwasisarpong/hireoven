import { builtinModules, createRequire } from "node:module"
import Anthropic from "@anthropic-ai/sdk"
import { logApiUsage } from "@/lib/admin/usage"
import {
  extractSkillsFromText,
  normalizeSkillList,
  normalizeSkillsBuckets,
} from "@/lib/skills/taxonomy"
import type {
  Education,
  ParsedResume,
  Project,
  SeniorityLevel,
  Skills,
  WorkExperience,
} from "@/types"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null
const nodeRequire = createRequire(import.meta.url)

const MODEL = "claude-haiku-4-5-20251001"
const MODEL_PRICING = {
  inputPerMillion: 0.8,
  outputPerMillion: 4,
}

function clampScore(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return null
  return Math.min(100, Math.max(0, Math.round(value)))
}

function cleanString(value: unknown) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toStringArray(value: unknown, limit?: number) {
  if (!Array.isArray(value)) return []
  const strings = value
    .map((item) => cleanString(item))
    .filter((item): item is string => Boolean(item))

  return typeof limit === "number" ? strings.slice(0, limit) : strings
}

function normalizeSkills(value: unknown): Skills {
  if (!value || typeof value !== "object") {
    return {
      technical: [],
      soft: [],
      languages: [],
      certifications: [],
    }
  }

  const skills = value as Record<string, unknown>
  return normalizeSkillsBuckets({
    technical: toStringArray(skills.technical),
    soft: toStringArray(skills.soft),
    languages: toStringArray(skills.languages),
    certifications: toStringArray(skills.certifications),
  })
}

function normalizeWorkExperience(value: unknown): WorkExperience[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const entry = item as Record<string, unknown>

      return {
        company: cleanString(entry.company) ?? "Unknown company",
        title: cleanString(entry.title) ?? "Unknown title",
        start_date: cleanString(entry.start_date) ?? "",
        end_date: cleanString(entry.end_date),
        is_current: Boolean(entry.is_current),
        description: cleanString(entry.description) ?? "",
        achievements: toStringArray(entry.achievements),
      }
    })
    .filter((item): item is WorkExperience => Boolean(item))
}

function normalizeEducation(value: unknown): Education[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const entry = item as Record<string, unknown>

      return {
        institution: cleanString(entry.institution) ?? "Unknown institution",
        degree: cleanString(entry.degree) ?? "",
        field: cleanString(entry.field) ?? "",
        start_date: cleanString(entry.start_date) ?? "",
        end_date: cleanString(entry.end_date),
        gpa: cleanString(entry.gpa),
      }
    })
    .filter((item): item is Education => Boolean(item))
}

function normalizeProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const entry = item as Record<string, unknown>

      return {
        name: cleanString(entry.name) ?? "Untitled project",
        description: cleanString(entry.description) ?? "",
        url: cleanString(entry.url),
        technologies: toStringArray(entry.technologies),
      }
    })
    .filter((item): item is Project => Boolean(item))
}

function normalizeSeniority(value: unknown): SeniorityLevel | null {
  const normalized = cleanString(value)?.toLowerCase()

  if (
    normalized === "intern" ||
    normalized === "junior" ||
    normalized === "mid" ||
    normalized === "senior" ||
    normalized === "staff" ||
    normalized === "principal" ||
    normalized === "director" ||
    normalized === "vp" ||
    normalized === "exec"
  ) {
    return normalized
  }

  return null
}

function estimateResumeScore({
  summary,
  email,
  phone,
  location,
  linkedinUrl,
  portfolioUrl,
  workExperience,
  education,
  skills,
  rawText,
}: {
  summary: string | null
  email: string | null
  phone: string | null
  location: string | null
  linkedinUrl: string | null
  portfolioUrl: string | null
  workExperience: WorkExperience[]
  education: Education[]
  skills: Skills
  rawText: string
}) {
  const completenessSections = [
    summary,
    workExperience.length > 0 ? "work" : null,
    education.length > 0 ? "education" : null,
    skills.technical.length > 0 || skills.soft.length > 0 ? "skills" : null,
  ].filter(Boolean).length
  const completeness = Math.min(30, Math.round((completenessSections / 4) * 30))

  const quantifiedHits = rawText.match(
    /\b(\d+%|\$\d[\d,]*|\d+\+|\d+\s*(users|customers|engineers|projects|months|years))\b/gi
  )?.length ?? 0
  const achievements = Math.min(25, quantifiedHits >= 5 ? 25 : quantifiedHits * 5)

  const skillCount =
    skills.technical.length + skills.soft.length + skills.languages.length + skills.certifications.length
  const skillsClarity = Math.min(20, skillCount >= 10 ? 20 : skillCount * 2)

  const summaryLength = summary?.trim().split(/\s+/).length ?? 0
  const summaryQuality = summaryLength >= 45 ? 15 : Math.min(15, Math.round(summaryLength / 3))

  const contactFields = [email, phone, location, linkedinUrl, portfolioUrl].filter(Boolean).length
  const contactInfo = Math.min(10, contactFields * 2)

  return clampScore(completeness + achievements + skillsClarity + summaryQuality + contactInfo)
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

function extractField(pattern: RegExp, text: string) {
  return cleanString(text.match(pattern)?.[0] ?? null)
}

function inferRole(text: string) {
  const lower = text.toLowerCase()

  if (lower.includes("product manager")) return "Product Manager"
  if (lower.includes("data scientist")) return "Data Scientist"
  if (lower.includes("designer")) return "Designer"
  if (lower.includes("frontend")) return "Frontend Engineer"
  if (lower.includes("backend")) return "Backend Engineer"
  if (lower.includes("software engineer")) return "Software Engineer"
  if (lower.includes("developer")) return "Software Developer"

  return null
}

function inferTopSkills(text: string) {
  return extractSkillsFromText(text).slice(0, 10)
}

function inferYearsOfExperience(text: string) {
  const explicit = text.match(/(\d+)\+?\s+years?\s+of\s+experience/i)
  if (explicit) return Number(explicit[1])

  const years = Array.from(text.matchAll(/\b(20\d{2})\b/g))
    .map((match) => Number(match[1]))
    .filter((year) => year >= 1990 && year <= new Date().getFullYear())

  if (years.length < 2) return null
  const span = Math.max(...years) - Math.min(...years)
  return span > 0 ? span : null
}

function fallbackParse(rawText: string): ParsedResume {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const fullName = lines.find(
    (line) =>
      line.length > 3 &&
      !line.includes("@") &&
      !/\d/.test(line) &&
      !/resume|curriculum|linkedin|github/i.test(line)
  ) ?? null

  const email = extractField(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, rawText)
  const phone = extractField(
    /(?:\+?\d{1,2}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/,
    rawText
  )
  const linkedinUrl = extractField(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i, rawText)
  const portfolioUrl =
    extractField(/https?:\/\/(?!www\.linkedin\.com)[^\s)]+/i, rawText) ??
    extractField(/\b[a-z0-9-]+\.(dev|com|io|ai|me|app)\b/i, rawText)

  const summary = lines.slice(1, 4).join(" ").trim() || null
  const topSkills = inferTopSkills(rawText)
  const skills: Skills = {
    technical: topSkills.slice(0, 8),
    soft: [],
    languages: [],
    certifications: [],
  }

  return {
    full_name: fullName,
    email,
    phone,
    location: null,
    linkedin_url: linkedinUrl,
    portfolio_url: portfolioUrl,
    summary,
    work_experience: [],
    education: [],
    skills,
    projects: [],
    seniority_level: null,
    years_of_experience: inferYearsOfExperience(rawText),
    primary_role: inferRole(rawText),
    industries: [],
    top_skills: topSkills,
    resume_score: estimateResumeScore({
      summary,
      email,
      phone,
      location: null,
      linkedinUrl,
      portfolioUrl,
      workExperience: [],
      education: [],
      skills,
      rawText,
    }),
    raw_text: rawText,
  }
}

function normalizeParsedResume(raw: unknown, extractedText: string): ParsedResume {
  if (!raw || typeof raw !== "object") {
    return fallbackParse(extractedText)
  }

  const parsed = raw as Record<string, unknown>
  const workExperience = normalizeWorkExperience(parsed.work_experience)
  const education = normalizeEducation(parsed.education)
  const skills = normalizeSkills(parsed.skills)
  const projects = normalizeProjects(parsed.projects)
  const fullName = cleanString(parsed.full_name)
  const email = cleanString(parsed.email)
  const phone = cleanString(parsed.phone)
  const location = cleanString(parsed.location)
  const linkedinUrl = cleanString(parsed.linkedin_url)
  const portfolioUrl = cleanString(parsed.portfolio_url)
  const summary = cleanString(parsed.summary)
  const industries = toStringArray(parsed.industries)
  const topSkills = normalizeSkillList(toStringArray(parsed.top_skills, 10), 10)
  const yearsOfExperience =
    typeof parsed.years_of_experience === "number"
      ? Math.max(0, Math.round(parsed.years_of_experience))
      : inferYearsOfExperience(extractedText)

  return {
    full_name: fullName,
    email,
    phone,
    location,
    linkedin_url: linkedinUrl,
    portfolio_url: portfolioUrl,
    summary,
    work_experience: workExperience,
    education,
    skills,
    projects,
    seniority_level: normalizeSeniority(parsed.seniority_level),
    years_of_experience: yearsOfExperience,
    primary_role: cleanString(parsed.primary_role) ?? inferRole(extractedText),
    industries,
    top_skills: topSkills.length > 0 ? topSkills : inferTopSkills(extractedText),
    resume_score:
      (typeof parsed.resume_score === "number" ? clampScore(parsed.resume_score) : null) ??
      estimateResumeScore({
        summary,
        email,
        phone,
        location,
        linkedinUrl,
        portfolioUrl,
        workExperience,
        education,
        skills,
        rawText: extractedText,
      }),
    raw_text: extractedText,
  }
}

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const processWithBuiltinModule = process as typeof process & {
    getBuiltinModule?: (id: string) => unknown
  }

  if (typeof processWithBuiltinModule.getBuiltinModule !== "function") {
    processWithBuiltinModule.getBuiltinModule = (id: string) => {
      const normalized = id.startsWith("node:") ? id : `node:${id}`

      if (
        !builtinModules.includes(id) &&
        !builtinModules.includes(normalized)
      ) {
        return undefined
      }

      try {
        return nodeRequire(normalized)
      } catch {
        return undefined
      }
    }
  }

  await import("pdf-parse/worker")
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const result = await parser.getText()
    return result.text.trim()
  } finally {
    await parser.destroy()
  }
}

export async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth")
  const result = await mammoth.extractRawText({ buffer })
  return result.value.trim()
}

async function parseWithClaude(extractedText: string) {
  if (!anthropic) return null

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system:
      "You are a professional resume parser. Extract structured data from the resume text provided. Return ONLY valid JSON with no explanation or markdown.",
    messages: [
      {
        role: "user",
        content: `Parse this resume and return a JSON object with these exact fields:
{
  full_name: string,
  email: string | null,
  phone: string | null,
  location: string | null,
  linkedin_url: string | null,
  portfolio_url: string | null,
  summary: string | null,
  work_experience: [{
    company: string,
    title: string,
    start_date: string,
    end_date: string | null,
    is_current: boolean,
    description: string,
    achievements: string[]
  }],
  education: [{
    institution: string,
    degree: string,
    field: string,
    start_date: string,
    end_date: string | null,
    gpa: string | null
  }],
  skills: {
    technical: string[],
    soft: string[],
    languages: string[],
    certifications: string[]
  },
  projects: [{
    name: string,
    description: string,
    url: string | null,
    technologies: string[]
  }],
  seniority_level: one of: intern junior mid senior staff principal director vp exec,
  years_of_experience: number,
  primary_role: string,
  industries: string[],
  top_skills: string[],
  resume_score: number
}

Resume text:
${extractedText}`,
      },
    ],
  })

  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  const estimatedCost =
    (inputTokens / 1_000_000) * MODEL_PRICING.inputPerMillion +
    (outputTokens / 1_000_000) * MODEL_PRICING.outputPerMillion

  await logApiUsage({
    service: "claude",
    operation: "parse_resume",
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(estimatedCost.toFixed(6)),
  })

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")

  return JSON.parse(extractJsonObject(text))
}

export async function parseResume(
  fileUrl: string,
  fileName: string
): Promise<ParsedResume> {
  const response = await fetch(fileUrl, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`Failed to fetch resume file (${response.status})`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const lowerName = fileName.toLowerCase()

  let extractedText = ""
  if (lowerName.endsWith(".pdf")) {
    extractedText = await extractTextFromPDF(buffer)
  } else if (lowerName.endsWith(".docx")) {
    extractedText = await extractTextFromDOCX(buffer)
  } else {
    throw new Error("Unsupported resume format")
  }

  if (!extractedText.trim()) {
    throw new Error("No text could be extracted from the uploaded resume")
  }

  try {
    const parsed = await parseWithClaude(extractedText)
    return normalizeParsedResume(parsed, extractedText)
  } catch (error) {
    console.error("Resume parsing fell back to heuristic extraction", error)
    return normalizeParsedResume(null, extractedText)
  }
}

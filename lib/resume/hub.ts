import {
  buildResumeScoreBreakdown as buildCoreResumeScoreBreakdown,
  buildResumeSnapshot as buildCoreResumeSnapshot,
  calculateResumeScore as calculateCoreResumeScore,
  deriveResumeFields,
} from "@/lib/resume/scoring"
import { buildResumeRawText } from "@/lib/resume/state"
import {
  extractSkillsFromText,
  getSkillsBucketValues,
  normalizeSkillList,
  normalizeSkillsBuckets,
  skillMatches,
} from "@/lib/skills/taxonomy"
import type {
  Education,
  Project,
  Resume,
  ResumeSnapshot,
  Skills,
  WorkExperience,
} from "@/types"
import type {
  ResumeExperienceLevel,
  ResumeGenerationInput,
  ResumeStyle,
  ResumeTailoringAnalysis,
  ResumeTone,
  TailoredBulletSuggestion,
} from "@/types/resume-hub"

export const RESUME_AI_TOOL_IDS = [
  "improve_bullets",
  "rewrite_summary",
  "ats_optimize",
  "add_metrics",
  "shorten",
  "fix_grammar",
  "improve_keywords",
  "convert_achievements",
] as const

export type ResumeAiToolId = (typeof RESUME_AI_TOOL_IDS)[number]

export type ResumeAiEditPatch = {
  summary?: string | null
  work_experience?: WorkExperience[] | null
  skills?: Skills | null
  top_skills?: string[] | null
  raw_text?: string | null
}

export type ResumeScoreApiResponse = {
  overall: number
  atsReadability: number
  keywordCoverage: number
  impactMetrics: number
  formattingQuality: number
  roleAlignment: number
  lengthClarity: number
  technicalDepth: number
  recruiterReadability: number
  suggestions: string[]
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function cleanString(value: unknown) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function safeArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : []
}

function safeSkills(skills: Skills | null | undefined): Skills {
  return normalizeSkillsBuckets(skills ?? { technical: [], soft: [], languages: [], certifications: [] })
}

function countWords(text: string | null | undefined) {
  return text?.trim().split(/\s+/).filter(Boolean).length ?? 0
}

function countMetricHits(text: string) {
  return text.match(/\b(\d+%|\$\d[\d,]*|\d+\+|\d+\s+(?:users|customers|teams|projects|engineers|months|years|requests|transactions|services))\b/gi)?.length ?? 0
}

function firstSentence(text: string | null | undefined) {
  return cleanString(text)?.split(/(?<=[.!?])\s+/)[0]?.trim() ?? null
}

function getResumeSearchText(resume: Pick<Resume, "raw_text" | "summary" | "work_experience" | "education" | "skills" | "projects" | "full_name">) {
  return resume.raw_text?.trim() || buildResumeRawText(resume)
}

export function normalizeKeyword(keyword: string) {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function extractKeywords(text: string, limit = 24) {
  const skillHits = extractSkillsFromText(text)
  const fallback = Array.from(
    new Set(
      (text.match(/\b[A-Za-z][A-Za-z0-9+#./-]{2,}\b/g) ?? [])
        .map((word) => normalizeKeyword(word))
        .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    )
  )
    .sort((a, b) => scoreKeywordText(b, text) - scoreKeywordText(a, text))
    .slice(0, limit)

  return normalizeSkillList([...skillHits, ...fallback], limit)
}

function scoreKeywordText(keyword: string, text: string) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text.match(new RegExp(`\\b${escaped}\\b`, "gi"))?.length ?? 0
}

export function calculateResumeScore(resume: Parameters<typeof calculateCoreResumeScore>[0]) {
  return calculateCoreResumeScore(resume)
}

type AtsResumeInput = Pick<
  Resume,
  | "parse_status"
  | "parse_error"
  | "file_name"
  | "file_type"
  | "full_name"
  | "email"
  | "phone"
  | "location"
  | "summary"
  | "work_experience"
  | "education"
  | "skills"
  | "projects"
  | "certifications"
  | "seniority_level"
  | "primary_role"
  | "top_skills"
  | "raw_text"
>

export function calculateAtsReadability(resume: AtsResumeInput) {
  const text = getResumeSearchText(resume)
  const wordCount = countWords(text)
  const workExperience = safeArray(resume.work_experience)
  const education = safeArray(resume.education)
  const projects = safeArray(resume.projects)
  const certifications = safeArray(resume.certifications)
  const skills = safeSkills(resume.skills)
  const allSkills = normalizeSkillList([...(resume.top_skills ?? []), ...getSkillsBucketValues(skills)])
  const achievements = workExperience.reduce((sum, item) => sum + safeArray(item.achievements).length, 0)
  const metrics = countMetricHits(text)
  const summaryWords = countWords(resume.summary)
  const fileType = `${resume.file_type ?? ""} ${resume.file_name ?? ""}`.toLowerCase()
  const hasSupportedFile = /pdf|docx|generated/.test(fileType)
  const hasRoleSignal = resume.primary_role
    ? normalizeKeyword(text).includes(normalizeKeyword(resume.primary_role))
    : false

  const parseAndFileScore = Math.min(
    15,
    (resume.parse_status === "complete" && !resume.parse_error ? 9 : resume.parse_status === "complete" ? 6 : 2) +
      (hasSupportedFile ? 3 : 0) +
      (wordCount >= 250 ? 3 : wordCount >= 120 ? 1 : 0)
  )

  const contactScore = Math.min(
    10,
    (resume.full_name ? 2 : 0) +
      (resume.email && /\S+@\S+\.\S+/.test(resume.email) ? 3 : 0) +
      (resume.phone ? 2 : 0) +
      (resume.location ? 2 : 0) +
      (resume.email || resume.phone ? 1 : 0)
  )

  const sectionsScore = Math.min(
    20,
    (summaryWords >= 20 ? 5 : resume.summary ? 2 : 0) +
      (workExperience.length > 0 ? 6 : 0) +
      (education.length > 0 ? 3 : 0) +
      (allSkills.length >= 6 ? 4 : allSkills.length > 0 ? 2 : 0) +
      (projects.length > 0 || certifications.length > 0 ? 2 : 0)
  )

  const formattingScore = Math.min(
    15,
    (wordCount >= 350 && wordCount <= 900 ? 6 : wordCount >= 250 && wordCount <= 1_100 ? 4 : 1) +
      (text.length > 1_500 && text.length < 9_000 ? 4 : text.length > 700 ? 2 : 0) +
      (!/[�]{1,}|\t{3,}|(?:\|.*){4,}/.test(text) ? 3 : 0) +
      (workExperience.every((item) => cleanString(item.title) && cleanString(item.company)) ? 2 : 0)
  )

  const keywordScore = Math.min(
    15,
    Math.min(9, allSkills.length) +
      (allSkills.length >= 8 && allSkills.length <= 16 ? 3 : 0) +
      (resume.primary_role ? 3 : 0)
  )

  const impactScore = Math.min(
    15,
    Math.min(7, achievements * 1.5) +
      Math.min(6, metrics * 2) +
      (workExperience.some((item) => cleanString(item.description)) ? 2 : 0)
  )

  const roleTargetingScore = Math.min(
    10,
    (resume.primary_role ? 4 : 0) +
      (hasRoleSignal ? 3 : 0) +
      (resume.seniority_level ? 2 : 0) +
      (workExperience.some((item) => resume.primary_role && item.title.toLowerCase().includes(resume.primary_role.toLowerCase())) ? 1 : 0)
  )

  return clampScore(
    parseAndFileScore +
      contactScore +
      sectionsScore +
      formattingScore +
      keywordScore +
      impactScore +
      roleTargetingScore
  )
}

export function buildResumeScoreBreakdown(resume: Resume): ResumeScoreApiResponse {
  const text = getResumeSearchText(resume)
  const workExperience = safeArray(resume.work_experience)
  const education = safeArray(resume.education)
  const skills = safeSkills(resume.skills)
  const allSkills = normalizeSkillList([...(resume.top_skills ?? []), ...getSkillsBucketValues(skills)])
  const core = buildCoreResumeScoreBreakdown(resume)

  const atsReadability = calculateAtsReadability(resume)
  const roleTokens = extractKeywords(resume.primary_role ?? "", 8)
  const keywordCoverage = clampScore(
    Math.min(65, allSkills.length * 7) +
      (roleTokens.some((roleToken) => allSkills.some((skill) => skillMatches(roleToken, skill))) ? 25 : 0) +
      (resume.summary ? 10 : 0)
  )
  const metrics = countMetricHits(text)
  const impactMetrics = clampScore(Math.min(100, metrics * 18 + (core.achievements / 25) * 35))
  const formattingQuality = clampScore(
    (resume.parse_status === "complete" ? 30 : 10) +
      (workExperience.length > 0 ? 18 : 0) +
      (education.length > 0 ? 14 : 0) +
      (allSkills.length > 0 ? 18 : 0) +
      (countWords(resume.summary) >= 25 ? 20 : 8)
  )
  const roleAlignment = clampScore(
    (resume.primary_role ? 38 : 0) +
      Math.min(42, allSkills.length * 5) +
      (workExperience.some((item) => resume.primary_role && item.title.toLowerCase().includes(resume.primary_role.toLowerCase())) ? 20 : 0)
  )
  const bullets = workExperience.reduce((sum, item) => sum + safeArray(item.achievements).length, 0)
  const lengthClarity = clampScore(
    (countWords(resume.summary) >= 25 && countWords(resume.summary) <= 90 ? 35 : 18) +
      Math.min(40, bullets * 7) +
      (text.length > 700 && text.length < 8_000 ? 25 : 10)
  )
  const technicalDepth = clampScore(Math.min(100, allSkills.length * 8 + (skills.certifications.length * 6)))
  const recruiterReadability = clampScore(
    (resume.summary ? 25 : 0) +
      (workExperience.length > 0 ? 25 : 0) +
      (workExperience.some((item) => item.description || item.achievements.length > 0) ? 25 : 0) +
      (resume.full_name && (resume.email || resume.phone) ? 25 : 10)
  )

  const overall = clampScore(
    atsReadability * 0.16 +
      keywordCoverage * 0.14 +
      impactMetrics * 0.14 +
      formattingQuality * 0.12 +
      roleAlignment * 0.15 +
      lengthClarity * 0.1 +
      technicalDepth * 0.1 +
      recruiterReadability * 0.09
  )

  const suggestions: string[] = []
  if (!resume.summary) suggestions.push("Add a concise professional summary tailored to your target role.")
  if (allSkills.length < 8) suggestions.push("Add 8-12 relevant technical skills that are truthful for your background.")
  if (metrics < 3) suggestions.push("Add measurable outcomes to bullets where you can verify the numbers.")
  if (!resume.primary_role) suggestions.push("Clarify your target or primary role near the top of the resume.")
  if (workExperience.length === 0) suggestions.push("Add work experience or project experience with concrete responsibilities.")

  return {
    overall,
    atsReadability,
    keywordCoverage,
    impactMetrics,
    formattingQuality,
    roleAlignment,
    lengthClarity,
    technicalDepth,
    recruiterReadability,
    suggestions,
  }
}

export function createResumeSnapshot(resume: Resume): ResumeSnapshot {
  return {
    ...buildCoreResumeSnapshot(resume),
    // Existing frontend reads `resume_score`; `ats_score` is included for newer Resume Hub snapshots.
    ats_score: resume.ats_score ?? null,
    github_url: resume.github_url ?? null,
    certifications: resume.certifications ?? null,
  } as ResumeSnapshot
}

export function restoreResumeFromSnapshot(resume: Resume, snapshot: ResumeSnapshot): Resume {
  const next = {
    ...resume,
    ...snapshot,
  } as Resume
  const derived = deriveResumeFields(next)
  next.raw_text = buildResumeRawText(next)
  next.years_of_experience = derived.years_of_experience
  next.primary_role = derived.primary_role
  next.top_skills = derived.top_skills
  next.resume_score = derived.resume_score
  next.ats_score = buildResumeScoreBreakdown(next).atsReadability
  return next
}

export function parseResumeTextFallback(resume: Resume, textInput?: string | null) {
  // TODO: Replace this deterministic fallback with robust PDF/DOCX extraction + AI structured parsing.
  const text = cleanString(textInput) ?? getResumeSearchText(resume) ?? resume.file_name
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? resume.email
  const phone = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] ?? resume.phone
  const linkedinUrl = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i)?.[0] ?? resume.linkedin_url
  const githubUrl = text.match(/https?:\/\/(?:www\.)?github\.com\/[^\s)]+/i)?.[0] ?? resume.github_url ?? null
  const portfolioUrl = text.match(/https?:\/\/(?!.*(?:linkedin|github))[^\s)]+/i)?.[0] ?? resume.portfolio_url
  const skills = normalizeSkillsBuckets({
    technical: extractSkillsFromText(text).slice(0, 16),
    soft: resume.skills?.soft ?? [],
    languages: resume.skills?.languages ?? [],
    certifications: resume.skills?.certifications ?? [],
  })
  const role = resume.primary_role ?? inferRole(text)
  const fallbackName = resume.name ?? resume.file_name.replace(/\.[^.]+$/, "")
  const fullName = resume.full_name ?? inferName(text) ?? fallbackName
  const workExperience = resume.work_experience?.length
    ? resume.work_experience
    : role
      ? [
          {
            company: "Experience",
            title: role,
            start_date: "",
            end_date: null,
            is_current: false,
            description: firstSentence(text) ?? "",
            achievements: [],
          },
        ]
      : []
  const education = resume.education ?? []
  const projects = resume.projects ?? []
  const nextResume: Resume = {
    ...resume,
    parse_status: "complete",
    parse_error: null,
    full_name: fullName,
    email,
    phone,
    linkedin_url: linkedinUrl,
    github_url: githubUrl,
    portfolio_url: portfolioUrl,
    summary: resume.summary ?? firstSentence(text),
    work_experience: workExperience,
    education,
    skills,
    projects,
    primary_role: role,
    raw_text: text,
  }
  const derived = deriveResumeFields(nextResume)
  nextResume.years_of_experience = derived.years_of_experience
  nextResume.primary_role = derived.primary_role
  nextResume.top_skills = derived.top_skills
  nextResume.resume_score = derived.resume_score
  nextResume.ats_score = buildResumeScoreBreakdown(nextResume).atsReadability
  return nextResume
}

export function createGeneratedResume(input: ResumeGenerationInput, userId: string): Omit<Resume, "id" | "created_at" | "updated_at"> {
  // TODO: Replace this mock-safe generator with a real AI generation workflow.
  const now = new Date().toISOString()
  const targetRole = input.targetRole.trim()
  const sourceText = [input.manualInput, input.linkedinSummary, input.jobDescription, input.targetIndustry].filter(Boolean).join("\n")
  const technical = normalizeSkillList(extractSkillsFromText(sourceText || targetRole), 12)
  const experienceTitle = levelToTitle(input.experienceLevel, targetRole)
  const summary = buildGeneratedSummary(targetRole, input.experienceLevel, input.resumeStyle, input.tone, input.targetIndustry)
  const sourceBullet = firstSentence(sourceText)
  const jobBullet = input.jobDescription
    ? `Aligned resume positioning to the target job description for ${targetRole}, emphasizing relevant keywords and responsibilities.`
    : `Supported ${targetRole.toLowerCase()} responsibilities using skills and experience that should be verified before applying.`
  const workExperience: WorkExperience[] = [
    {
      company: "Recent Experience",
      title: experienceTitle,
      start_date: "",
      end_date: null,
      is_current: true,
      description: sourceBullet ?? `Built experience relevant to ${targetRole}. Review and replace this placeholder with your real work history.`,
      achievements: [
        jobBullet,
      ],
    },
  ]
  const skills = normalizeSkillsBuckets({ technical, soft: ["Communication", "Collaboration"], languages: [], certifications: [] })
  const draft: Resume = {
    id: "00000000-0000-0000-0000-000000000000",
    user_id: userId,
    file_name: `${targetRole.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "generated"}-resume.json`,
    name: `${targetRole} Resume`,
    file_url: "",
    storage_path: "",
    file_size: null,
    file_type: "generated",
    is_primary: false,
    parse_status: "complete",
    parse_error: null,
    full_name: null,
    email: null,
    phone: null,
    location: null,
    linkedin_url: null,
    portfolio_url: null,
    github_url: null,
    summary,
    work_experience: workExperience,
    education: [],
    skills,
    projects: [],
    certifications: [],
    seniority_level: null,
    years_of_experience: experienceLevelYears(input.experienceLevel),
    primary_role: targetRole,
    industries: input.targetIndustry ? [input.targetIndustry] : [],
    top_skills: normalizeSkillList(technical, 10),
    resume_score: null,
    ats_score: null,
    raw_text: "",
    created_at: now,
    updated_at: now,
  }
  draft.raw_text = buildResumeRawText(draft)
  draft.resume_score = calculateCoreResumeScore(draft)
  draft.ats_score = buildResumeScoreBreakdown(draft).atsReadability
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...insertable } = draft
  void _id
  void _createdAt
  void _updatedAt
  return insertable
}

export function createAiEditPatch(resume: Resume, toolId: ResumeAiToolId, instructions?: string | null, jobDescription?: string | null): ResumeAiEditPatch {
  // TODO: Wire this to a real AI editor that returns structured, reviewable patches.
  const next: ResumeAiEditPatch = {}
  const currentSummary = resume.summary ?? `${resume.primary_role ?? "Professional"} with experience across ${normalizeSkillList(resume.top_skills ?? [], 4).join(", ")}.`
  const workExperience = safeArray(resume.work_experience).map((item) => ({ ...item, achievements: [...safeArray(item.achievements)] }))

  if (toolId === "rewrite_summary" || toolId === "ats_optimize" || toolId === "shorten" || toolId === "fix_grammar") {
    next.summary = rewriteSummary(currentSummary, resume.primary_role, instructions)
  }

  if (toolId === "improve_bullets" || toolId === "add_metrics" || toolId === "convert_achievements") {
    next.work_experience = workExperience.map((item) => ({
      ...item,
      achievements: item.achievements.length
        ? item.achievements.map((bullet) => improveBullet(bullet, toolId))
        : [`Improved ${item.title.toLowerCase()} outcomes by focusing on measurable, verifiable impact.`],
    }))
  }

  if (toolId === "improve_keywords" || toolId === "ats_optimize") {
    const keywords = extractKeywords(jobDescription ?? instructions ?? resume.raw_text ?? "", 8)
    const skills = safeSkills(resume.skills)
    next.skills = normalizeSkillsBuckets({
      ...skills,
      technical: normalizeSkillList([...skills.technical, ...keywords], 18),
    })
    next.top_skills = normalizeSkillList([...(resume.top_skills ?? []), ...keywords], 10)
  }

  return next
}

export function applyAiEditPatch(resume: Resume, patch: ResumeAiEditPatch) {
  const next: Resume = {
    ...resume,
    summary: patch.summary !== undefined ? patch.summary : resume.summary,
    work_experience: patch.work_experience !== undefined ? patch.work_experience : resume.work_experience,
    skills: patch.skills !== undefined ? patch.skills : resume.skills,
    top_skills: patch.top_skills !== undefined ? patch.top_skills : resume.top_skills,
  }
  next.raw_text = buildResumeRawText(next)
  const derived = deriveResumeFields(next)
  next.years_of_experience = derived.years_of_experience
  next.primary_role = derived.primary_role
  next.top_skills = derived.top_skills
  next.resume_score = derived.resume_score
  next.ats_score = buildResumeScoreBreakdown(next).atsReadability
  return next
}

function cleanBulletText(line: string | null | undefined): string {
  return (line ?? "")
    .replace(/^[-•*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function buildTailoredReplacementBullet(original: string, keyword: string | null): string {
  const cleaned = cleanBulletText(original)
  const fallback = keyword
    ? `Delivered ${keyword}-focused improvements that strengthened delivery reliability and business outcomes across core workflows.`
    : "Delivered measurable improvements in delivery reliability and business outcomes across core workflows."
  if (!cleaned || /^add a truthful,?\s*role-relevant achievement\.?$/i.test(cleaned)) {
    return fallback
  }

  const stem = cleaned.replace(/[.?!]+$/, "")
  const startsWithStrongVerb = /^(architected|automated|built|created|delivered|designed|developed|drove|enabled|implemented|improved|launched|led|migrated|optimized|owned|reduced|refactored|scaled|streamlined)\b/i.test(
    stem
  )
  const baseClause = startsWithStrongVerb
    ? stem
    : `Delivered ${stem.charAt(0).toLowerCase()}${stem.slice(1)}`

  if (!keyword) {
    return `${baseClause} with clear ownership, technical context, and measurable business impact.`
  }

  const hasKeyword = normalizeKeyword(stem).includes(normalizeKeyword(keyword))
  if (hasKeyword) {
    return `${baseClause} to improve delivery quality, operational reliability, and business outcomes.`
  }
  return `${baseClause} using ${keyword} to improve delivery quality, operational reliability, and business outcomes.`
}

export function compareResumeToJob(resume: Resume, jobDescription: string, jobTitle?: string | null, company?: string | null): ResumeTailoringAnalysis {
  const jobKeywords = extractKeywords(jobDescription, 24)
  const resumeText = getResumeSearchText(resume).toLowerCase()
  const resumeSkills = normalizeSkillList([...(resume.top_skills ?? []), ...getSkillsBucketValues(resume.skills)])
  const presentKeywords = jobKeywords.filter((keyword) =>
    resumeSkills.some((skill) => skillMatches(keyword, skill)) || resumeText.includes(normalizeKeyword(keyword))
  )
  const missingKeywords = jobKeywords.filter((keyword) => !presentKeywords.includes(keyword)).slice(0, 12)
  const matchScore = clampScore(jobKeywords.length ? (presentKeywords.length / jobKeywords.length) * 100 : 35)
  const experienceSources = (resume.work_experience ?? []).flatMap((experience) => {
    const achievements = Array.isArray(experience.achievements) ? experience.achievements : []
    if (achievements.length > 0) return achievements
    return (experience.description ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  })
  const originalBullets = experienceSources
    .map((line) => cleanBulletText(line))
    .filter(Boolean)
  const fallbackOriginal = originalBullets[0] ?? "Improved a core workflow with measurable operational impact."
  const bulletSuggestions: TailoredBulletSuggestion[] = missingKeywords.length > 0
    ? missingKeywords.slice(0, 3).map((keyword, idx) => {
      const original = originalBullets[idx] ?? fallbackOriginal
      return {
        section: "Work Experience",
        original,
        suggested: buildTailoredReplacementBullet(original, keyword),
        reason: "Keyword appears in the job description but was not clearly present in the resume.",
        keywords: [keyword],
      }
    })
    : [
      {
        section: "Work Experience",
        original: fallbackOriginal,
        suggested: buildTailoredReplacementBullet(fallbackOriginal, null),
        reason: "No major keyword gaps detected; this rewrite strengthens clarity and impact for ATS screening.",
        keywords: ["impact"],
      },
    ]

  return {
    jobTitle: jobTitle?.trim() || inferRole(jobDescription) || "Target role",
    company: company?.trim() || null,
    matchScore,
    missingKeywords,
    presentKeywords,
    bulletSuggestions,
    suggestedSummaryRewrite: resume.summary
      ? `${resume.summary} ${missingKeywords.length ? `If true, emphasize experience with ${missingKeywords.slice(0, 3).join(", ")} for this role.` : "This summary already has several relevant signals."}`
      : `Candidate targeting ${jobTitle ?? "this role"}. Add a truthful summary highlighting relevant experience and verified skills.`,
    suggestedSkillsToAdd: missingKeywords.slice(0, 8),
    warnings: ["Add only skills and experience that are true. Do not fabricate experience."],
  }
}

export function isResumeAiToolId(value: unknown): value is ResumeAiToolId {
  return typeof value === "string" && (RESUME_AI_TOOL_IDS as readonly string[]).includes(value)
}

function inferRole(text: string) {
  const lower = text.toLowerCase()
  if (lower.includes("product manager")) return "Product Manager"
  if (lower.includes("data scientist")) return "Data Scientist"
  if (lower.includes("frontend")) return "Frontend Engineer"
  if (lower.includes("backend")) return "Backend Engineer"
  if (lower.includes("full stack")) return "Full Stack Engineer"
  if (lower.includes("software engineer")) return "Software Engineer"
  if (lower.includes("designer")) return "Designer"
  if (lower.includes("analyst")) return "Analyst"
  return null
}

function inferName(text: string) {
  const firstLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
  return firstLines.find((line) => /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(line)) ?? null
}

function experienceLevelYears(level: ResumeExperienceLevel) {
  if (level === "internship") return 0
  if (level === "entry") return 1
  if (level === "mid") return 4
  if (level === "senior") return 8
  return 12
}

function levelToTitle(level: ResumeExperienceLevel, role: string) {
  if (level === "internship") return `${role} Intern`
  if (level === "entry") return `Entry-Level ${role}`
  if (level === "senior") return `Senior ${role}`
  if (level === "executive") return `Executive ${role}`
  return role
}

function buildGeneratedSummary(role: string, level: ResumeExperienceLevel, style: ResumeStyle, tone: ResumeTone, industry: string) {
  const levelText = level === "internship" ? "early-career" : level.replace("_", " ")
  const styleText = style.replace("_", " ")
  const toneText = tone.replace("_", " ")
  return `${levelText} ${role} candidate with a ${styleText}, ${toneText} resume direction${industry ? ` for ${industry}` : ""}. Review this generated draft and replace placeholder details with verified experience before applying.`
}

function rewriteSummary(summary: string, role: string | null, instructions?: string | null) {
  const target = role ? ` as a ${role}` : ""
  const extra = instructions ? ` Focus: ${instructions.trim()}.` : ""
  return `${summary.replace(/\s+/g, " ").trim()} Refined for clarity, ATS readability, and role alignment${target}.${extra}`
}

function improveBullet(bullet: string, toolId: ResumeAiToolId) {
  const cleaned = bullet.replace(/\s+/g, " ").trim()
  if (toolId === "add_metrics" && !/\d/.test(cleaned)) {
    return `${cleaned} Add a verified metric here if you can support it.`
  }
  if (toolId === "convert_achievements") {
    return cleaned.replace(/^Responsible for/i, "Delivered")
  }
  return cleaned.endsWith(".") ? cleaned : `${cleaned}.`
}

const STOP_WORDS = new Set([
  "and",
  "are",
  "for",
  "with",
  "the",
  "this",
  "that",
  "you",
  "your",
  "our",
  "will",
  "from",
  "have",
  "has",
  "job",
  "role",
  "team",
  "work",
  "years",
  "experience",
  "required",
  "preferred",
  "candidate",
  "skills",
  "using",
  "build",
  "develop",
  "strong",
])

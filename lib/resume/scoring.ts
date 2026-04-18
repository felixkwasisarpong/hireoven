import type { Resume, ResumeSnapshot, Skills, WorkExperience } from "@/types"

export type ResumeScoreBreakdown = {
  completeness: number
  achievements: number
  skillsClarity: number
  summaryQuality: number
  contactInfo: number
}

function safeArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : []
}

function safeSkills(skills: Skills | null | undefined): Skills {
  return {
    technical: safeArray(skills?.technical),
    soft: safeArray(skills?.soft),
    languages: safeArray(skills?.languages),
    certifications: safeArray(skills?.certifications),
  }
}

function parseYear(value: string | null | undefined) {
  const match = value?.match(/\b(19|20)\d{2}\b/)
  if (!match) return null
  return Number(match[0])
}

export function deriveYearsOfExperience(
  workExperience: WorkExperience[] | null | undefined
) {
  const experiences = safeArray(workExperience)
  if (experiences.length === 0) return null

  const startYears = experiences
    .map((item) => parseYear(item.start_date))
    .filter((year): year is number => typeof year === "number")

  if (startYears.length === 0) return null

  const earliest = Math.min(...startYears)
  const currentYear = new Date().getFullYear()
  return Math.max(0, currentYear - earliest)
}

export function deriveTopSkills(
  skills: Skills | null | undefined,
  existing: string[] | null | undefined = null
) {
  const normalized = safeSkills(skills)
  const merged = [
    ...normalized.technical,
    ...normalized.certifications,
    ...normalized.languages,
    ...normalized.soft,
    ...safeArray(existing),
  ]

  return Array.from(
    new Set(
      merged
        .map((skill) => skill.trim())
        .filter(Boolean)
    )
  ).slice(0, 10)
}

export function buildResumeScoreBreakdown(
  resume: Pick<
    Resume,
    | "summary"
    | "work_experience"
    | "education"
    | "skills"
    | "email"
    | "phone"
    | "location"
    | "linkedin_url"
    | "portfolio_url"
  >
): ResumeScoreBreakdown {
  const workExperience = safeArray(resume.work_experience)
  const education = safeArray(resume.education)
  const skills = safeSkills(resume.skills)

  const completenessSignals = [
    resume.summary,
    workExperience.length > 0 ? "work" : null,
    education.length > 0 ? "education" : null,
    skills.technical.length + skills.soft.length + skills.languages.length + skills.certifications.length > 0
      ? "skills"
      : null,
  ].filter(Boolean).length

  const quantifiedHits = workExperience.reduce((count, item) => {
    const text = `${item.description} ${item.achievements.join(" ")}`
    return count + (text.match(/\b(\d+%|\$\d[\d,]*|\d+\+|\d+\s+(?:users|customers|teams|projects|engineers|months|years))\b/gi)?.length ?? 0)
  }, 0)

  const totalSkills =
    skills.technical.length +
    skills.soft.length +
    skills.languages.length +
    skills.certifications.length

  const summaryWords = resume.summary?.split(/\s+/).filter(Boolean).length ?? 0
  const contactFields = [
    resume.email,
    resume.phone,
    resume.location,
    resume.linkedin_url,
    resume.portfolio_url,
  ].filter(Boolean).length

  return {
    completeness: Math.min(30, Math.round((completenessSignals / 4) * 30)),
    achievements: Math.min(25, quantifiedHits >= 5 ? 25 : quantifiedHits * 5),
    skillsClarity: Math.min(20, totalSkills >= 10 ? 20 : totalSkills * 2),
    summaryQuality: summaryWords >= 45 ? 15 : Math.min(15, Math.round(summaryWords / 3)),
    contactInfo: Math.min(10, contactFields * 2),
  }
}

export function calculateResumeScore(
  resume: Pick<
    Resume,
    | "summary"
    | "work_experience"
    | "education"
    | "skills"
    | "email"
    | "phone"
    | "location"
    | "linkedin_url"
    | "portfolio_url"
  >
) {
  const breakdown = buildResumeScoreBreakdown(resume)
  return Math.min(
    100,
    breakdown.completeness +
      breakdown.achievements +
      breakdown.skillsClarity +
      breakdown.summaryQuality +
      breakdown.contactInfo
  )
}

export function buildResumeSnapshot(resume: Resume): ResumeSnapshot {
  return {
    full_name: resume.full_name,
    email: resume.email,
    phone: resume.phone,
    location: resume.location,
    linkedin_url: resume.linkedin_url,
    portfolio_url: resume.portfolio_url,
    summary: resume.summary,
    work_experience: resume.work_experience,
    education: resume.education,
    skills: resume.skills,
    projects: resume.projects,
    seniority_level: resume.seniority_level,
    years_of_experience: resume.years_of_experience,
    primary_role: resume.primary_role,
    industries: resume.industries,
    top_skills: resume.top_skills,
    resume_score: resume.resume_score,
    raw_text: resume.raw_text,
  }
}

export function deriveResumeFields(
  nextResume: Pick<
    Resume,
    | "summary"
    | "work_experience"
    | "education"
    | "skills"
    | "email"
    | "phone"
    | "location"
    | "linkedin_url"
    | "portfolio_url"
    | "years_of_experience"
    | "primary_role"
    | "top_skills"
    | "resume_score"
  >
) {
  const yearsOfExperience =
    deriveYearsOfExperience(nextResume.work_experience) ?? nextResume.years_of_experience ?? null
  const primaryRole =
    nextResume.primary_role ??
    safeArray(nextResume.work_experience)[0]?.title ??
    null
  const topSkills = deriveTopSkills(nextResume.skills, nextResume.top_skills)
  const resumeScore = calculateResumeScore(nextResume)

  return {
    years_of_experience: yearsOfExperience,
    primary_role: primaryRole,
    top_skills: topSkills,
    resume_score: resumeScore,
  }
}

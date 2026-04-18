import { calculateResumeScore, deriveResumeFields } from "@/lib/resume/scoring"
import type { Resume, ResumeEditContext, ResumeSection, Skills, WorkExperience } from "@/types"

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
    if (
      typeof context?.experienceIndex === "number" &&
      typeof context?.bulletIndex === "number" &&
      typeof content === "string"
    ) {
      const experience = next.work_experience?.[context.experienceIndex]
      if (experience && Array.isArray(experience.achievements)) {
        experience.achievements = experience.achievements.map((item, index) =>
          index === context.bulletIndex ? content : item
        )
      }
    } else if (
      typeof context?.experienceIndex === "number" &&
      content &&
      typeof content === "object" &&
      !Array.isArray(content)
    ) {
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
      technical: Array.isArray((content as Skills).technical)
        ? (content as Skills).technical
        : next.skills?.technical ?? [],
      soft: Array.isArray((content as Skills).soft)
        ? (content as Skills).soft
        : next.skills?.soft ?? [],
      languages: Array.isArray((content as Skills).languages)
        ? (content as Skills).languages
        : next.skills?.languages ?? [],
      certifications: Array.isArray((content as Skills).certifications)
        ? (content as Skills).certifications
        : next.skills?.certifications ?? [],
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

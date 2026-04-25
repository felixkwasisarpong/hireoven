import {
  extractSkillsFromText,
  getSkillsBucketValues,
  normalizeSkillKey,
  normalizeSkillList,
  skillMatches,
} from "@/lib/skills/taxonomy"
import type { IntelligenceConfidence, ResumeLcaRoleAlignment, Skills } from "@/types"

export type ResumeLcaRoleAlignmentInput = {
  resumeText?: string | null
  resumeSkills?: Skills | string[] | null
  resumeTopSkills?: string[] | null
  jobTitle?: string | null
  jobDescription?: string | null
  inferredRoleFamily?: string | null
  jobSkills?: string[] | null
  historicalSponsoredRoleKeywords?: string[] | null
  companyCommonSkills?: string[] | null
}

type RoleFamilyDefinition = {
  label: string
  titleSignals: string[]
  keywords: string[]
}

const ROLE_FAMILIES: RoleFamilyDefinition[] = [
  {
    label: "Software Engineering",
    titleSignals: ["software", "frontend", "front end", "backend", "back end", "full stack", "web developer", "application engineer"],
    keywords: ["JavaScript", "TypeScript", "React", "Node.js", "SQL", "REST", "AWS", "Docker", "Kubernetes"],
  },
  {
    label: "Data Engineering",
    titleSignals: ["data engineer", "analytics engineer", "etl", "pipeline"],
    keywords: ["Python", "SQL", "Spark", "Airflow", "AWS", "GCP", "Docker"],
  },
  {
    label: "Data Science / Machine Learning",
    titleSignals: ["data scientist", "machine learning", "ml engineer", "ai engineer", "research scientist"],
    keywords: ["Python", "SQL", "Machine Learning", "Deep Learning", "Pandas", "Spark"],
  },
  {
    label: "Product / Program",
    titleSignals: ["product manager", "program manager", "project manager", "product owner"],
    keywords: ["Product Strategy", "Project Management", "Communication", "Leadership", "Data Analysis"],
  },
  {
    label: "Cloud / DevOps",
    titleSignals: ["devops", "site reliability", "sre", "platform engineer", "cloud engineer", "infrastructure"],
    keywords: ["AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "Python", "Go"],
  },
]

function toArraySkills(skills: Skills | string[] | null | undefined) {
  if (!skills) return []
  if (Array.isArray(skills)) return skills
  return getSkillsBucketValues(skills)
}

function includesTerm(text: string, term: string) {
  const key = normalizeSkillKey(term)
  if (!key) return false
  return normalizeSkillKey(text).includes(key)
}

function inferRoleFamily(
  explicit: string | null | undefined,
  jobTitle: string | null | undefined,
  jobDescription: string | null | undefined
) {
  if (explicit?.trim()) return explicit.trim()

  const title = jobTitle ?? ""
  const description = jobDescription ?? ""
  const blob = `${title} ${description}`

  for (const family of ROLE_FAMILIES) {
    if (family.titleSignals.some((signal) => includesTerm(title, signal))) {
      return family.label
    }
  }

  let best: { label: string; hits: number } | null = null
  for (const family of ROLE_FAMILIES) {
    const hits = family.keywords.filter((keyword) => includesTerm(blob, keyword)).length
    if (!best || hits > best.hits) best = { label: family.label, hits }
  }

  return best && best.hits >= 2 ? best.label : null
}

function familyKeywords(roleFamily: string | null) {
  if (!roleFamily) return []
  const key = normalizeSkillKey(roleFamily)
  return ROLE_FAMILIES.find((family) => normalizeSkillKey(family.label) === key)?.keywords ?? []
}

function keywordMatched(target: string, resumeKeywords: string[]) {
  return resumeKeywords.some(
    (candidate) =>
      normalizeSkillKey(candidate) === normalizeSkillKey(target) ||
      skillMatches(target, candidate)
  )
}

function confidenceFor({
  targetCount,
  hasResume,
  hasLcaSignals,
}: {
  targetCount: number
  hasResume: boolean
  hasLcaSignals: boolean
}): IntelligenceConfidence {
  if (!hasResume || targetCount < 3) return "low"
  if (hasLcaSignals && targetCount >= 6) return "high"
  return "medium"
}

function sourceFor({
  hasLcaSignals,
  hasJobSignals,
}: {
  hasLcaSignals: boolean
  hasJobSignals: boolean
}): ResumeLcaRoleAlignment["source"] {
  if (hasLcaSignals && hasJobSignals) return "mixed"
  if (hasLcaSignals) return "lca_history"
  if (hasJobSignals) return "job_description"
  return "insufficient_data"
}

function buildSuggestions(strongMatches: string[], missingKeywords: string[]) {
  const suggestions: string[] = []

  if (strongMatches.length > 0) {
    suggestions.push(
      `Move relevant experience with ${strongMatches.slice(0, 3).join(", ")} closer to the top of your resume.`
    )
  }

  if (missingKeywords.length > 0) {
    suggestions.push(
      `Add ${missingKeywords.slice(0, 3).join(", ")} only if it is true based on your actual experience.`
    )
  }

  if (strongMatches.length > 0 && missingKeywords.length > 0) {
    suggestions.push(
      `Use the job's wording for matched skills where accurate, but do not add tools or duties you have not used.`
    )
  }

  if (suggestions.length === 0) {
    suggestions.push("Upload or complete your resume details to get tailored rewrite suggestions.")
  }

  return suggestions
}

export function calculateResumeLcaRoleAlignment(
  input: ResumeLcaRoleAlignmentInput
): ResumeLcaRoleAlignment {
  const roleFamily = inferRoleFamily(
    input.inferredRoleFamily,
    input.jobTitle,
    input.jobDescription
  )

  const resumeKeywords = normalizeSkillList([
    ...(input.resumeTopSkills ?? []),
    ...toArraySkills(input.resumeSkills),
    ...extractSkillsFromText(input.resumeText),
  ])

  const jobDerivedKeywords = normalizeSkillList([
    ...(input.jobSkills ?? []),
    ...extractSkillsFromText(input.jobTitle, input.jobDescription),
    ...familyKeywords(roleFamily),
  ])

  const lcaDerivedKeywords = normalizeSkillList([
    ...(input.historicalSponsoredRoleKeywords ?? []),
    ...(input.companyCommonSkills ?? []),
  ])

  const targetKeywords = normalizeSkillList([
    ...lcaDerivedKeywords,
    ...jobDerivedKeywords,
  ], 16)

  const hasResume = resumeKeywords.length > 0 || Boolean(input.resumeText?.trim())
  const hasLcaSignals = lcaDerivedKeywords.length > 0
  const hasJobSignals = jobDerivedKeywords.length > 0
  const source = sourceFor({ hasLcaSignals, hasJobSignals })

  if (!hasResume || targetKeywords.length === 0) {
    return {
      alignmentScore: null,
      missingKeywords: targetKeywords.slice(0, 8),
      strongMatches: [],
      roleFamily,
      resumeRewriteSuggestions: buildSuggestions([], targetKeywords.slice(0, 5)),
      explanation: !hasResume
        ? "Upload or select a parsed resume to compare it with this role."
        : "Not enough role or LCA keyword data is available yet.",
      confidence: "low",
      source,
    }
  }

  const strongMatches = targetKeywords.filter((keyword) => keywordMatched(keyword, resumeKeywords))
  const missingKeywords = targetKeywords.filter((keyword) => !keywordMatched(keyword, resumeKeywords))
  const lcaWeight = hasLcaSignals ? 0.65 : 0.5
  const jobWeight = 1 - lcaWeight

  const lcaScore =
    lcaDerivedKeywords.length > 0
      ? Math.round(
          (lcaDerivedKeywords.filter((keyword) => keywordMatched(keyword, resumeKeywords)).length /
            lcaDerivedKeywords.length) *
            100
        )
      : null
  const jobScore =
    jobDerivedKeywords.length > 0
      ? Math.round(
          (jobDerivedKeywords.filter((keyword) => keywordMatched(keyword, resumeKeywords)).length /
            jobDerivedKeywords.length) *
            100
        )
      : null

  const alignmentScore =
    lcaScore !== null && jobScore !== null
      ? Math.round(lcaScore * lcaWeight + jobScore * jobWeight)
      : lcaScore ?? jobScore ?? null

  const confidence = confidenceFor({
    targetCount: targetKeywords.length,
    hasResume,
    hasLcaSignals,
  })

  const explanation =
    source === "lca_history" || source === "mixed"
      ? `Compared your resume against ${roleFamily ?? "this role family"} using sponsored-role keywords and this job description.`
      : `LCA role history is unavailable, so this falls back to normal resume and job-description alignment.`

  return {
    alignmentScore,
    missingKeywords: missingKeywords.slice(0, 8),
    strongMatches: strongMatches.slice(0, 8),
    roleFamily,
    resumeRewriteSuggestions: buildSuggestions(strongMatches, missingKeywords),
    explanation,
    confidence,
    source,
  }
}

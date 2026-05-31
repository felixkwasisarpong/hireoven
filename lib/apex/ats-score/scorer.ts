/**
 * ATS Score Engine
 *
 * Calculates a before/after ATS compatibility score for a resume against
 * a specific job description. Used by TailorMode to show improvement.
 *
 * Score components (100 pts total):
 *   keyword_match   40 — required + preferred keywords present in resume
 *   section_health  25 — expected sections present and non-empty
 *   title_alignment 15 — job title / seniority reflected in resume headline
 *   impact_density  20 — quantified achievements per bullet (numbers, %)
 */

export type ATSScoreBreakdown = {
  total: number           // 0–100
  keyword_match: number   // 0–40
  section_health: number  // 0–25
  title_alignment: number // 0–15
  impact_density: number  // 0–20
  missing_keywords: string[]
  weak_sections: string[]
  suggestions: string[]
}

// ATS systems look for these sections by common heading keywords
const SECTION_PATTERNS: Record<string, RegExp> = {
  experience:  /\b(experience|employment|work history|positions?)\b/i,
  education:   /\b(education|degree|university|college|academic)\b/i,
  skills:      /\b(skills?|technologies|technical|competencies|tools)\b/i,
  summary:     /\b(summary|profile|objective|about)\b/i,
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s+#.]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  )
}

function extractKeywords(jobDescription: string): string[] {
  const tokens = tokenize(jobDescription)
  // Skip stop words; return meaningful multi-char tokens
  const stops = new Set(["with", "and", "the", "for", "you", "are", "will", "have", "that", "this", "from", "our", "your", "their", "able", "work", "team", "role", "job"])
  return [...tokens].filter((t) => !stops.has(t) && t.length > 3).slice(0, 60)
}

function scoreKeywordMatch(resumeText: string, keywords: string[]): { score: number; missing: string[] } {
  if (keywords.length === 0) return { score: 40, missing: [] }
  const resumeTokens = tokenize(resumeText)
  const missing: string[] = []
  let hits = 0
  for (const kw of keywords) {
    if (resumeTokens.has(kw) || [...resumeTokens].some((t) => t.includes(kw) || kw.includes(t))) {
      hits++
    } else {
      missing.push(kw)
    }
  }
  const ratio = hits / keywords.length
  return {
    score: Math.round(ratio * 40),
    missing: missing.slice(0, 10),
  }
}

function scoreSectionHealth(resumeText: string): { score: number; weak: string[] } {
  const weak: string[] = []
  let hits = 0
  for (const [name, pattern] of Object.entries(SECTION_PATTERNS)) {
    if (pattern.test(resumeText)) {
      hits++
    } else {
      weak.push(name)
    }
  }
  return {
    score: Math.round((hits / Object.keys(SECTION_PATTERNS).length) * 25),
    weak,
  }
}

function scoreTitleAlignment(resumeText: string, jobTitle: string): number {
  const jTokens = tokenize(jobTitle)
  const rTokens = tokenize(resumeText)
  let overlap = 0
  for (const t of jTokens) {
    if (rTokens.has(t)) overlap++
  }
  if (jTokens.size === 0) return 10
  return Math.min(15, Math.round((overlap / jTokens.size) * 15))
}

function scoreImpactDensity(resumeText: string): number {
  // Count lines with quantified impact (numbers, %, $, x multipliers)
  const lines = resumeText.split("\n").filter((l) => l.trim().startsWith("•") || l.trim().startsWith("-") || l.trim().startsWith("*"))
  if (lines.length === 0) return 10
  const impactLines = lines.filter((l) => /\d+[%xk$m]?|\$\d+|[0-9]+x\b|\d+%/.test(l))
  const ratio = impactLines.length / lines.length
  return Math.round(ratio * 20)
}

function buildSuggestions(breakdown: Omit<ATSScoreBreakdown, "suggestions" | "total">): string[] {
  const s: string[] = []
  if (breakdown.missing_keywords.length > 0) {
    s.push(`Add these missing keywords: ${breakdown.missing_keywords.slice(0, 5).join(", ")}`)
  }
  if (breakdown.weak_sections.includes("summary")) {
    s.push("Add a Professional Summary section to improve ATS parsing")
  }
  if (breakdown.weak_sections.includes("skills")) {
    s.push("Add a Skills / Technologies section with explicit tool names")
  }
  if (breakdown.impact_density < 12) {
    s.push("Quantify more bullet points with numbers, percentages, or dollar amounts")
  }
  if (breakdown.title_alignment < 10) {
    s.push("Reflect the target job title in your resume headline or summary")
  }
  return s
}

export function scoreResume(resumeText: string, jobDescription: string, jobTitle = ""): ATSScoreBreakdown {
  const keywords = extractKeywords(jobDescription)
  const { score: kwScore, missing } = scoreKeywordMatch(resumeText, keywords)
  const { score: sectionScore, weak } = scoreSectionHealth(resumeText)
  const titleScore = scoreTitleAlignment(resumeText, jobTitle)
  const impactScore = scoreImpactDensity(resumeText)

  const partial = {
    keyword_match: kwScore,
    section_health: sectionScore,
    title_alignment: titleScore,
    impact_density: impactScore,
    missing_keywords: missing,
    weak_sections: weak,
  }

  return {
    ...partial,
    total: kwScore + sectionScore + titleScore + impactScore,
    suggestions: buildSuggestions(partial),
  }
}

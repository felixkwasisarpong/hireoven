/**
 * Lightweight, client-side checks for the AI Studio "Section Analysis" strip.
 * Updates live as the user edits — no network calls.
 */

export type StudioSectionCheckTone = "good" | "warn" | "neutral"

export type StudioSectionCheck = {
  label: string
  value: string
  tone: StudioSectionCheckTone
}

type ExperienceLike = {
  company: string
  role: string
  description: string
}

function stripRichTextMarkers(s: string) {
  return s.replace(/\*\*|__|~~|_/g, "").trim()
}

function countSkillTokens(skillsText: string) {
  const parts = skillsText
    .split(/[\n,|]/)
    .map((p) => stripRichTextMarkers(p.replace(/^[^:]+:/, "").trim()))
    .filter(Boolean)
  return new Set(parts.map((p) => p.toLowerCase())).size
}

/** Heuristic: resume bullets often need %, $, multipliers, or n+ scale / metric-adjacent verbs + digits. */
export function hasMeasurableImpactSignals(text: string): boolean {
  const t = stripRichTextMarkers(text)
  if (!t) return false

  if (/\d+%|\d+\s*[x×]|\$\d|[€£]\d|\d{1,3}(,\d{3})+|\b\d+\s*(k|m|b)\b(?![a-z])/i.test(t)) return true
  if (/\b\d{1,4}\+?\s*(users|customers|teams?|people|projects|requests\/s|req\/s)\b/i.test(t)) return true
  if (/\b(increased|decreased|reduced|improved|grew|cut|saved|scaled|boosted|lowered|raised)\b[^.]{0,80}\d/i.test(t)) return true
  if (/\d[^.]{0,80}\b(increased|decreased|reduced|latency|throughput|revenue|conversion|retention|uptime)\b/i.test(t)) return true
  if (/\b(top|#\d|no\.\s*\d|ranked)\b/i.test(t) && /\d/.test(t)) return true

  return false
}

function analyzeProfile(profileSummary: string, enabled: boolean): StudioSectionCheck {
  if (!enabled) {
    return { label: "Profile", value: "Section hidden", tone: "neutral" }
  }
  const s = profileSummary.trim()
  if (!s) {
    return { label: "Profile", value: "Add a summary", tone: "warn" }
  }
  if (s.length < 45) {
    return { label: "Profile", value: "Too brief — add 2–4 lines", tone: "warn" }
  }
  if (s.length > 1400) {
    return { label: "Profile", value: "Consider tightening", tone: "warn" }
  }
  return { label: "Profile", value: "Good", tone: "good" }
}

function analyzeExperience(drafts: ExperienceLike[], enabled: boolean): StudioSectionCheck {
  if (!enabled) {
    return { label: "Experience", value: "Section hidden", tone: "neutral" }
  }
  const combined = drafts
    .map((d) => `${d.role} ${d.company} ${d.description}`)
    .join("\n")
    .trim()

  if (!drafts.length || !combined.replace(/\s+/g, "")) {
    return { label: "Experience", value: "Add roles and bullets", tone: "warn" }
  }

  const hasAnyDescription = drafts.some((d) => d.description.trim().length > 0)
  if (!hasAnyDescription) {
    return { label: "Experience", value: "Add role descriptions", tone: "warn" }
  }

  if (!hasMeasurableImpactSignals(combined)) {
    return { label: "Experience", value: "Needs measurable impact", tone: "warn" }
  }

  return { label: "Experience", value: "Good", tone: "good" }
}

function analyzeSkills(skillsText: string, enabled: boolean): StudioSectionCheck {
  if (!enabled) {
    return { label: "Skills", value: "Section hidden", tone: "neutral" }
  }
  const n = countSkillTokens(skillsText)
  if (n === 0) {
    return { label: "Skills", value: "Add skills", tone: "warn" }
  }
  if (n < 4) {
    return { label: "Skills", value: "Add a few more", tone: "warn" }
  }
  if (n >= 12) {
    return { label: "Skills", value: "Strong coverage", tone: "good" }
  }
  return { label: "Skills", value: "Good", tone: "good" }
}

export function buildStudioSectionChecks(input: {
  profileSummary: string
  experienceDrafts: ExperienceLike[]
  skillsText: string
  sections: Array<{ type: string; enabled: boolean }>
}): StudioSectionCheck[] {
  const { profileSummary, experienceDrafts, skillsText, sections } = input
  const enabled = (t: string) => sections.find((s) => s.type === t)?.enabled ?? true

  return [
    analyzeProfile(profileSummary, enabled("profile")),
    analyzeExperience(experienceDrafts, enabled("experience")),
    analyzeSkills(skillsText, enabled("skills")),
  ]
}

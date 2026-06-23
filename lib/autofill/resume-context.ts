/**
 * Shared résumé-context formatter for the autofill AI endpoints.
 *
 * Both the single-question (`/api/autofill/answer-question`) and the batch
 * matcher (`/api/extension/match-questions`) ground their answers in the user's
 * primary résumé. This builds one compact-but-complete text block from the
 * parsed résumé so the model fills application forms from real work history,
 * achievements, and education — never invented facts.
 *
 * Keep it structured: prefer the parsed sections, fall back to raw text only
 * when the structured data is too sparse to answer questions from.
 */

type ResumeRole = {
  title?: string | null
  company?: string | null
  location?: string | null
  start_date?: string | null
  end_date?: string | null
  is_current?: boolean | null
  duration?: string | null
  description?: string | null
  achievements?: unknown
}

type ResumeEducation = {
  institution?: string | null
  degree?: string | null
  field?: string | null
  start_date?: string | null
  end_date?: string | null
  year?: number | null
  gpa?: string | null
}

type ResumeProject = {
  name?: string | null
  description?: string | null
  technologies?: unknown
}

export type ResumeContextSource = {
  summary?: string | null
  primary_role?: string | null
  years_of_experience?: number | null
  top_skills?: string[] | null
  // jsonb columns arrive as `unknown` from pg — guarded with Array.isArray below.
  work_experience?: unknown
  education?: unknown
  projects?: unknown
  raw_text?: string | null
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asStringArray(value: unknown): string[] {
  return asArray<unknown>(value).filter(
    (v): v is string => typeof v === "string" && Boolean(v.trim()),
  )
}

type FormatOptions = {
  /** Max work-experience entries to include. Default 5. */
  maxRoles?: number
  /** Max characters of each role description. Default 400. */
  maxDescriptionChars?: number
  /** Max achievement bullets per role. Default 4. */
  maxAchievements?: number
  /** Max education entries. Default 3. */
  maxEducation?: number
  /** Max project entries. Default 3. */
  maxProjects?: number
  /** Max skills listed. Default 20. */
  maxSkills?: number
  /** Append a raw-text excerpt when structured data is thin. Default true. */
  includeRawFallback?: boolean
}

function clean(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen).trimEnd()}…` : trimmed
}

/** "Jan 2020 – Present" / "2019 – 2021" / "" — whatever the data supports. */
function dateRange(start?: string | null, end?: string | null, isCurrent?: boolean | null): string {
  const s = clean(start, 40)
  const e = isCurrent ? "Present" : clean(end, 40)
  if (s && e) return `${s} – ${e}`
  if (s) return `${s} – Present`
  if (e) return e
  return ""
}

/**
 * Format a parsed résumé into a single text block for the model. Returns null
 * when there's nothing usable, so callers can fall back to manual review.
 */
export function formatResumeContext(
  resume: ResumeContextSource | null | undefined,
  opts: FormatOptions = {},
): string | null {
  if (!resume) return null

  const {
    maxRoles = 5,
    maxDescriptionChars = 400,
    maxAchievements = 4,
    maxEducation = 3,
    maxProjects = 3,
    maxSkills = 20,
    includeRawFallback = true,
  } = opts

  const parts: string[] = []
  let structuredSignals = 0

  const role = clean(resume.primary_role, 160)
  if (role) {
    parts.push(`Current/primary role: ${role}`)
    structuredSignals++
  }
  if (typeof resume.years_of_experience === "number" && resume.years_of_experience > 0) {
    parts.push(`Years of experience: ${resume.years_of_experience}`)
  }

  const summary = clean(resume.summary, 700)
  if (summary) {
    parts.push(`Summary: ${summary}`)
    structuredSignals++
  }

  const skills = asStringArray(resume.top_skills)
    .map((s) => s.trim())
    .slice(0, maxSkills)
  if (skills.length) {
    parts.push(`Skills: ${skills.join(", ")}`)
    structuredSignals++
  }

  const roles = asArray<ResumeRole>(resume.work_experience).slice(0, maxRoles)
  if (roles.length) {
    const lines = roles.map((job) => {
      const title = clean(job.title, 160)
      const company = clean(job.company, 160)
      const range = clean(job.duration, 60) ?? dateRange(job.start_date, job.end_date, job.is_current)
      const header = [title, company].filter(Boolean).join(" at ") || "Role"
      let entry = `- ${header}${range ? ` (${range})` : ""}`
      const description = clean(job.description, maxDescriptionChars)
      if (description) entry += `\n  ${description}`
      const achievements = asStringArray(job.achievements)
        .slice(0, maxAchievements)
        .map((a) => `  • ${clean(a, 280)}`)
      if (achievements.length) entry += `\n${achievements.join("\n")}`
      return entry
    })
    parts.push(`Work experience:\n${lines.join("\n")}`)
    structuredSignals++
  }

  const education = asArray<ResumeEducation>(resume.education).slice(0, maxEducation)
  if (education.length) {
    const lines = education.map((e) => {
      const degree = clean(e.degree, 140)
      const field = clean(e.field, 140)
      const institution = clean(e.institution, 180)
      const year =
        clean(e.end_date, 40) ?? (typeof e.year === "number" ? String(e.year) : null)
      const head = [degree, field].filter(Boolean).join(" in ") || degree || field || "Degree"
      return `- ${head}${institution ? ` — ${institution}` : ""}${year ? ` (${year})` : ""}`
    })
    parts.push(`Education:\n${lines.join("\n")}`)
    structuredSignals++
  }

  const projects = asArray<ResumeProject>(resume.projects).slice(0, maxProjects)
  if (projects.length) {
    const lines = projects
      .map((p) => {
        const name = clean(p.name, 160)
        const description = clean(p.description, 240)
        if (!name && !description) return null
        const tech = asStringArray(p.technologies).slice(0, 8)
        return `- ${name ?? "Project"}${description ? `: ${description}` : ""}${
          tech.length ? ` [${tech.join(", ")}]` : ""
        }`
      })
      .filter((l): l is string => Boolean(l))
    if (lines.length) parts.push(`Projects:\n${lines.join("\n")}`)
  }

  // Fall back to raw text only when the structured résumé is too thin to answer from.
  if (includeRawFallback && structuredSignals < 3) {
    const raw = clean(resume.raw_text, 1200)
    if (raw) parts.push(`Résumé text (excerpt): ${raw}`)
  }

  const ctx = parts.join("\n\n").trim()
  return ctx ? ctx : null
}

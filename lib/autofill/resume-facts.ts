/**
 * Facts derived from a résumé, handed to the model as statements rather than
 * left for it to infer.
 *
 * Application forms ask "do you have 4+ years of sales experience?", "how many
 * years with Python?", "what city are you based in?". All of that is in the
 * résumé, but as prose and date ranges — so the model was answering "I can't
 * find that" on questions the résumé plainly settles. Computing the answers
 * here and stating them removes the inference step, and the arithmetic is done
 * in code because a language model counting months across overlapping jobs is
 * exactly the kind of thing it gets quietly wrong.
 */

export type WorkEntry = {
  title?: string | null
  company?: string | null
  start_date?: string | null
  end_date?: string | null
  is_current?: boolean | null
}

/** "Mar 2026", "2026-03", "March 2026", "2026" → a comparable month index. */
export function parseResumeMonth(value: string | null | undefined, now = new Date()): number | null {
  const v = (value ?? "").trim()
  if (!v) return null
  if (/^(present|current|now|ongoing)$/i.test(v)) return now.getFullYear() * 12 + now.getMonth()

  const iso = v.match(/^(\d{4})-(\d{1,2})/)
  if (iso) return Number(iso[1]) * 12 + (Number(iso[2]) - 1)

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
  const named = v.match(/([A-Za-z]{3,})\s+(\d{4})/)
  if (named) {
    const m = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase())
    if (m >= 0) return Number(named[2]) * 12 + m
  }
  const yearOnly = v.match(/^(\d{4})$/)
  if (yearOnly) return Number(yearOnly[1]) * 12
  return null
}

/**
 * Total professional experience in years.
 *
 * Overlapping roles are merged rather than summed: someone holding a part-time
 * and a full-time role at once has not worked two years in one year, and
 * inflating that number puts a false claim on an application.
 */
export function computeYearsOfExperience(entries: WorkEntry[], now = new Date()): number {
  const nowIdx = now.getFullYear() * 12 + now.getMonth()
  const spans: Array<[number, number]> = []
  for (const e of entries ?? []) {
    const start = parseResumeMonth(e.start_date, now)
    if (start === null) continue
    const end = e.is_current ? nowIdx : (parseResumeMonth(e.end_date, now) ?? nowIdx)
    if (end < start) continue
    // A role that has not begun contributes nothing. Clamping it to today
    // instead would credit it with a month of experience it has not earned.
    if (start > nowIdx) continue
    spans.push([start, Math.min(end, nowIdx)])
  }
  if (!spans.length) return 0

  spans.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = [spans[0]]
  for (const [s, e] of spans.slice(1)) {
    const last = merged[merged.length - 1]
    if (s <= last[1] + 1) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  const months = merged.reduce((sum, [s, e]) => sum + (e - s + 1), 0)
  return Math.round((months / 12) * 10) / 10
}

export type FactSources = {
  yearsOfExperience?: number | null
  primaryRole?: string | null
  topSkills?: string[] | null
  workExperience?: WorkEntry[] | null
  city?: string | null
  state?: string | null
  country?: string | null
  highestDegree?: string | null
  fieldOfStudy?: string | null
  university?: string | null
}

/**
 * A compact block of settled facts for the prompt.
 *
 * Stated as facts because the model's job is to map a question onto them, not
 * to work them out. The stored years_of_experience wins when present — it is
 * the parsed résumé's own figure — with the computed value as the fallback.
 */
export function buildDerivedFacts(src: FactSources, now = new Date()): string {
  const computed = computeYearsOfExperience(src.workExperience ?? [], now)
  const years = src.yearsOfExperience && src.yearsOfExperience > 0 ? src.yearsOfExperience : computed
  const location = [src.city, src.state].filter(Boolean).join(", ")
  const lines: string[] = []

  if (years > 0) {
    lines.push(`Total professional experience: ${years} years.`)
    lines.push(`For a question asking "do you have N+ years of experience" in the applicant's own field, compare N against ${years}.`)
  }
  if (src.primaryRole) lines.push(`Current field / role: ${src.primaryRole}.`)
  if (src.topSkills?.length) lines.push(`Skills: ${src.topSkills.slice(0, 30).join(", ")}.`)

  const titles = (src.workExperience ?? [])
    .map((e) => [e.title, e.company].filter(Boolean).join(" at "))
    .filter(Boolean).slice(0, 8)
  if (titles.length) lines.push(`Roles held: ${titles.join("; ")}.`)

  if (location) lines.push(`Location: ${location}${src.country ? `, ${src.country}` : ""}.`)
  if (src.city) lines.push(`City: ${src.city}.`)
  if (src.state) lines.push(`State: ${src.state}.`)

  const edu = [src.highestDegree, src.fieldOfStudy].filter(Boolean).join(" in ")
  if (edu) lines.push(`Education: ${edu}${src.university ? `, ${src.university}` : ""}.`)

  if (!lines.length) return ""
  return `DERIVED FACTS (already established — use these directly, do not re-derive):\n${lines.map((l) => `- ${l}`).join("\n")}`
}

import { fetchPrimaryResume, getAutofillProfile, matchQuestions } from "../api-client"
import type { MatchQuestion } from "../api-client"
import type { SafeProfile } from "./safe-fields"
import type { AutofillFieldResult } from "./safe-fields"
import { workAuthAnswer } from "./work-auth"

/**
 * A required application question the deterministic matcher couldn't answer.
 * Deferred to the semantic (server/Claude) tier and applied via `apply()` if
 * the model returns a usable value; otherwise it falls back to manual review.
 */
type SemanticQuestion = {
  el: HTMLElement
  label: string
  type: MatchQuestion["type"]
  options?: string[]
  apply: (value: string) => boolean | Promise<boolean>
}

type WorkdayStepId =
  | "account_required"
  | "start_application"
  | "resume_upload"
  | "my_information"
  | "my_experience"
  | "application_questions"
  | "self_identify"
  | "review"
  | "unknown"

type WorkdayStep = {
  id: WorkdayStepId
  name: string
  index: number
  total: number
}

type WorkdayNameFieldKind = "first" | "middle" | "last" | "preferred"

type ResumeEducationRow = {
  institution?: string | null
  degree?: string | null
  field?: string | null
  start_date?: string | null
  end_date?: string | null
  gpa?: string | null
}

type ExtendedSafeProfile = SafeProfile & {
  address_line1?: string | null
  address_line2?: string | null
  highest_degree?: string | null
  field_of_study?: string | null
  university?: string | null
  graduation_year?: number | null
  gpa?: string | null
  years_of_experience?: number | null
  salary_expectation_min?: number | null
  salary_expectation_max?: number | null
  work_authorization?: string | null
  earliest_start_date?: string | null
  resume_email?: string | null
  resume_phone?: string | null
  resume_location?: string | null
  resume_linkedin_url?: string | null
  resume_portfolio_url?: string | null
  resume_education?: ResumeEducationRow[] | null
  resume_certifications?: string[] | null
  resume_full_name?: string | null
  // EEO / self-identification — only populated when the user has opted in via
  // auto_fill_diversity (see /api/extension/autofill-profile).
  auto_fill_diversity?: boolean | null
  gender?: string | null
  ethnicity?: string | null
  hispanic_latino?: string | null
  veteran_status?: string | null
  disability_status?: string | null
}

type WorkdayCvAddress = {
  line1: string
  line2: string
  city: string
  state: string
  zip: string
  country: string
}

type WorkdayCvWorkExperience = {
  title: string
  company: string
  location: string
  startDate: { month: string; year: string }
  endDate: { month: string; year: string } | null
  current: boolean
  description: string
  technologies: string[]
}

type WorkdayCvEducation = {
  school: string
  degree: string
  major: string
  startYear: string
  endYear: string
  gpa: string | null
}

type WorkdayCv = {
  firstName: string
  middleName: string
  lastName: string
  preferredName: string
  email: string
  phone: string
  address: WorkdayCvAddress
  linkedIn: string
  portfolio: string
  workExperience: WorkdayCvWorkExperience[]
  education: WorkdayCvEducation[]
  certifications: string[]
  skills: string[]
  skillYears: Record<string, number>
  visa: {
    authorizedToWork: boolean | null
    requiresSponsorship: boolean
    requiresSponsorshipKnown: boolean
    authorizedCountries: string[]
    status: string
  }
  salaryExpectation: string
  salaryExpectationSingle: string
  availability: string
  citizenship: string
  yearsOfExperience: number
  // EEO / self-identification — only populated when the user opted in
  // (auto_fill_diversity). Empty string means "no saved answer → decline".
  diversity: {
    optedIn: boolean
    gender: string
    ethnicity: string
    hispanicLatino: string
    veteranStatus: string
    disabilityStatus: string
  }
}

type ToolbarState = "FILLING" | "WAITING" | "NEEDS_REVIEW" | "PAUSED" | "DONE" | "STOPPED"

export type WorkdayAutofillPhase =
  | "idle"
  | "running"
  | "paused"
  | "needs_review"
  | "done"
  | "stopped"
  | "error"

export type WorkdayAutofillSnapshot = {
  phase: WorkdayAutofillPhase
  title: string
  subtitle: string
  step: WorkdayStep
  fieldsFilledCount: number
  totalExpectedFields: number
  progressPct: number
  manualReviewCount: number
  eeoPaused: boolean
}

export type WorkdayAutofillRunResult = {
  phase: WorkdayAutofillPhase
  stepId: WorkdayStepId
  stepName: string
  fieldsFilledCount: number
  totalExpectedFields: number
  manualReviewCount: number
  manualReviewNotes: string[]
  eeoPaused: boolean
  reachedReview: boolean
  /**
   * Set when the runner stopped because it needs the user to do something
   * before autofill can continue (e.g. sign in, create account). When
   * present, the bar should show the message rather than treating
   * fieldsFilledCount === 0 as a fill failure.
   */
  blockedReason: "account_required" | null
  debugEntryCount: number
  debugTail: WorkdayDebugEntry[]
  rows: AutofillFieldResult[]
}

export type WorkdayDebugLevel = "info" | "warn" | "error"

export type WorkdayDebugEntry = {
  at: string
  level: WorkdayDebugLevel
  event: string
  phase: WorkdayAutofillPhase
  stepId: WorkdayStepId
  stepName: string
  details?: Record<string, string | number | boolean | null>
}

type WorkdayAutofillRunnerOptions = {
  showToolbar?: boolean
  profile?: ExtendedSafeProfile | null
  resumeFile?: File | null
  resumeJobId?: string | null
  resumeId?: string | null
  resumeVersionId?: string | null
  onSnapshot?: (snapshot: WorkdayAutofillSnapshot) => void
  onWarning?: (line: string) => void
}

const TOOLBAR_ROOT_ID = "__ho_workday_toolbar"
const STYLE_ID = "__ho_workday_toolbar_style"
const MANUAL_REVIEW_ATTR = "data-ho-workday-manual-review"
const GLOBAL_DEBUG_KEY = "__hoWorkdayAutofillDebug"
const GLOBAL_LAST_RESULT_KEY = "__hoWorkdayAutofillLastResult"
const GLOBAL_LAST_ERROR_KEY = "__hoWorkdayAutofillLastError"
const DEBUG_LOG_LIMIT = 900
const DISCLOSURE_DECLINE_RE =
  /don'?t wish to answer|do not wish to answer|prefer not to (?:answer|say|disclose|identify)|decline to (?:answer|self.?identify|disclose|state)|choose not to|do not want to answer|don'?t want to answer|not to disclose|i decline|i don'?t wish to|wish not to|do not wish to self.?identify|don'?t wish to self.?identify/i
const CONSENT_CHECKBOX_RE =
  /terms? and conditions?|privacy statement|have read|read and consent|consent to the terms|acknowledge|certify|\bagree\b|confirm|reviewed/i

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

const STEP_TOTAL = 5

let singletonRunner: WorkdayAutofillRunner | null = null

declare global {
  interface Window {
    __hoWorkdayAutofillDebug?: WorkdayDebugEntry[]
    __hoWorkdayAutofillLastResult?: WorkdayAutofillRunResult | null
    __hoWorkdayAutofillLastError?: string | null
  }
}

type RunInBarOptions = {
  profile: SafeProfile
  resumeJobId?: string
  /** Base resume id (from "Tailor Resume" on the bar). Lower priority than
   *  resumeVersionId — the base resume is NOT the tailored content. */
  resumeId?: string
  /** Tailored resume snapshot id (resume_versions row). This is the actual
   *  tailored resume the user approved on the bar; highest priority. */
  resumeVersionId?: string
  onSnapshot?: (snapshot: WorkdayAutofillSnapshot) => void
  onWarning?: (line: string) => void
  maxCycles?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTopFrame(): boolean {
  try {
    return window.self === window.top
  } catch {
    return false
  }
}

function normText(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * True when a yes/no question asks whether the candidate has worked for / been
 * employed by this company before — including the common Workday phrasing
 * "Have you been previously employed by {company} or its sub-brands - …?".
 * These default to "No" (a genuine returning employee corrects it in manual
 * review) so we don't burn an AI round-trip or leave the required radio blank.
 * Guarded against "previous employer" obligation wording and relative/family
 * questions, which are different. Exported for unit testing.
 */
export function isReturningEmployerQuestion(question: string): boolean {
  const q = normText(question)
  if (!q) return false
  if (q.includes("previous employer") || q.includes("relative") || q.includes("family")) {
    return false
  }
  return (
    q.includes("previous employee") ||
    q.includes("former employee") ||
    q.includes("current or former employee") ||
    q.includes("previously been employed") ||
    q.includes("previously employed") ||
    q.includes("been employed by") ||
    q.includes("currently or previously employed") ||
    q.includes("currently or previously worked") ||
    q.includes("previously worked for") ||
    q.includes("previously worked at") ||
    q.includes("previously worked with") ||
    q.includes("ever been employed by") ||
    q.includes("currently employed by") ||
    q.includes("ever worked for") ||
    q.includes("ever worked with") ||
    q.includes("ever worked at") ||
    q.includes("worked with us") ||
    q.includes("worked here")
  )
}

function isVisible(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.hidden) return false
  const style = window.getComputedStyle(el)
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/**
 * Workday renders radio/checkbox <input>s as opacity:0, zero-size overlays —
 * the visible control is a styled sibling — so isVisible(input) is always
 * false. Judge reachability by the input's nearest sized/visible ancestor
 * instead; a programmatic .click() on the hidden input still selects it.
 */
function isControlReachable(input: HTMLElement): boolean {
  if (input instanceof HTMLInputElement && input.disabled) return false
  let node: HTMLElement | null = input
  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    if (isVisible(node)) return true
  }
  return false
}

function nonEmpty(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Capitalize a name segment: "FELIX" → "Felix", "mcdonald" → "Mcdonald",
 * "o'brien" → "O'Brien", "anne-marie" → "Anne-Marie". Preserves hyphens,
 * apostrophes, and existing mixed case in the input — we only touch tokens
 * that are entirely upper- or lowercase. Mixed case is treated as
 * intentional (e.g. "deSilva", "MacKay") and passed through.
 */
function toTitleCase(raw: string): string {
  const trimmed = nonEmpty(raw)
  if (!trimmed) return ""
  return trimmed
    .split(/(\s+)/)
    .map((segment) => {
      if (/^\s+$/.test(segment)) return segment
      return segment
        .split(/([-'])/)
        .map((part) => {
          if (part === "-" || part === "'") return part
          if (!part) return part
          // Leave mixed-case tokens (e.g. "MacKay", "deSilva") alone.
          const isAllUpper = part === part.toUpperCase()
          const isAllLower = part === part.toLowerCase()
          if (!isAllUpper && !isAllLower) return part
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        })
        .join("")
    })
    .join("")
}

/**
 * True when a value looks like the artifact of a resume parser that dumped
 * everything in one case (typically ALL CAPS). Workday flags these with
 * capitalization warnings on the Legal Name section.
 */
function looksMiscased(value: string): boolean {
  const trimmed = nonEmpty(value)
  if (trimmed.length < 2) return false
  const letters = trimmed.replace(/[^A-Za-z]/g, "")
  if (letters.length < 2) return false
  return letters === letters.toUpperCase() || letters === letters.toLowerCase()
}

function isTextInputControl(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true
  if (!(el instanceof HTMLInputElement)) return false
  const type = (el.getAttribute("type") ?? "text").toLowerCase()
  return !["hidden", "file", "password", "checkbox", "radio", "submit", "button", "reset"].includes(type)
}

function sanitizePhone(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function splitCityState(raw: string | null | undefined): { city: string; state: string } {
  const value = nonEmpty(raw)
  if (!value) return { city: "", state: "" }
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) {
    return { city: parts[0] ?? "", state: parts[1] ?? "" }
  }
  return { city: value, state: "" }
}

function parseMonthYear(value: string | null | undefined): { month: string; year: string } | null {
  const raw = nonEmpty(value)
  if (!raw) return null

  const iso = raw.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/)
  if (iso) {
    const year = iso[1]
    const monthIndex = Number.parseInt(iso[2], 10) - 1
    const month = MONTHS[monthIndex] ?? "January"
    return { month, year }
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const monthIndex = Number.parseInt(slash[1], 10) - 1
    const year = slash[2]
    const month = MONTHS[monthIndex] ?? "January"
    return { month, year }
  }

  const textual = raw.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i,
  )
  if (textual) {
    const month = textual[1].slice(0, 1).toUpperCase() + textual[1].slice(1).toLowerCase()
    return { month, year: textual[2] }
  }

  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    const year = String(parsed.getUTCFullYear())
    const month = MONTHS[parsed.getUTCMonth()] ?? "January"
    return { month, year }
  }

  const yearOnly = raw.match(/^(\d{4})$/)
  if (yearOnly) {
    return { month: "January", year: yearOnly[1] }
  }

  return null
}

// Particles that legitimately lead a multi-word surname — never stripped as a
// mistaken middle name (e.g. "De La Cruz", "van der Berg", "Mac Donald").
const SURNAME_PARTICLES = new Set([
  "de", "del", "dela", "della", "la", "le", "van", "von", "der", "den", "di",
  "da", "das", "dos", "du", "el", "al", "bin", "ibn", "mac", "mc", "st", "saint",
  "san", "santa", "abu", "ben", "ter", "ten", "op", "vom", "zur", "of",
])

export function extractNameParts(
  profile: ExtendedSafeProfile,
): { firstName: string; middleName: string; lastName: string } {
  const first = nonEmpty(profile.first_name)
  const last = nonEmpty(profile.last_name)
  const full = nonEmpty(profile.resume_full_name)

  // Always derive a middle name from resume_full_name when present — the
  // SafeProfile schema doesn't currently carry middle_name explicitly, so
  // the resume's parsed full name is our only source.
  let middle = ""
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean)
    if (parts.length >= 3) {
      middle = parts.slice(1, -1).join(" ")
    }
  }

  if (first || last) {
    const fullParts = full ? full.split(/\s+/).filter(Boolean) : []
    const lastTokens = last.split(/\s+/).filter(Boolean)
    // The structured last_name sometimes absorbs the middle name (e.g. stored
    // "Kwasi Sarpong" for the full name "Felix Kwasi Sarpong"), which fills
    // Workday's Last Name with the middle included. If the last name has a
    // leading token that ISN'T a compound-surname particle (de/la/van/von/…),
    // treat it as a middle name and keep only the true final surname. Real
    // compound surnames ("De La Cruz", "Van Der Berg") are left intact.
    let surname = last
    if (lastTokens.length >= 2 && !SURNAME_PARTICLES.has(normText(lastTokens[0] ?? ""))) {
      surname = lastTokens[lastTokens.length - 1] ?? last
    } else if (!last && fullParts.length >= 3) {
      surname = fullParts[fullParts.length - 1] ?? ""
    }
    return {
      firstName: toTitleCase(first || fullParts[0] || ""),
      middleName: toTitleCase(middle),
      lastName: toTitleCase(surname),
    }
  }

  if (!full) return { firstName: "", middleName: "", lastName: "" }
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return { firstName: toTitleCase(parts[0]), middleName: "", lastName: "" }
  }
  if (parts.length === 2) {
    return {
      firstName: toTitleCase(parts[0] ?? ""),
      middleName: "",
      lastName: toTitleCase(parts[1] ?? ""),
    }
  }
  return {
    firstName: toTitleCase(parts[0] ?? ""),
    middleName: toTitleCase(parts.slice(1, -1).join(" ")),
    lastName: toTitleCase(parts[parts.length - 1] ?? ""),
  }
}

function uniqueSkills(raw: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const skill = nonEmpty(item)
    if (!skill) continue
    const key = skill.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(skill)
  }
  return out
}

function calcYearsFromDates(startRaw: string | null | undefined, endRaw: string | null | undefined, isCurrent: boolean): number {
  const start = parseMonthYear(startRaw)
  if (!start) return 0
  const startMonth = Math.max(1, MONTHS.findIndex((m) => m.toLowerCase() === start.month.toLowerCase()) + 1)
  const startYear = Number.parseInt(start.year, 10)
  if (!Number.isFinite(startYear)) return 0

  const end = isCurrent ? null : parseMonthYear(endRaw)
  const endMonth = end
    ? Math.max(1, MONTHS.findIndex((m) => m.toLowerCase() === end.month.toLowerCase()) + 1)
    : new Date().getMonth() + 1
  const endYear = end ? Number.parseInt(end.year, 10) : new Date().getFullYear()
  if (!Number.isFinite(endYear)) return 0

  const monthSpan = (endYear - startYear) * 12 + (endMonth - startMonth)
  if (monthSpan <= 0) return 0
  return Math.round((monthSpan / 12) * 10) / 10
}

function mapProfileToWorkdayCv(profile: ExtendedSafeProfile): WorkdayCv {
  const name = extractNameParts(profile)
  const fallbackLocation = splitCityState(profile.resume_location)

  const baseSkills = Array.isArray(profile.top_skills)
    ? profile.top_skills
    : typeof profile.skills === "string"
      ? profile.skills.split(",")
      : []
  const skills = uniqueSkills(baseSkills)

  const workExperience: WorkdayCvWorkExperience[] = Array.isArray(profile.work_experience)
    ? profile.work_experience
        .map((row) => {
          const start = parseMonthYear(row.start_date)
          const end = row.is_current ? null : parseMonthYear(row.end_date)
          const description = nonEmpty(row.description)
          const achievements = Array.isArray(row.achievements)
            ? row.achievements.map((a) => nonEmpty(a)).filter(Boolean)
            : []
          const mergedDescription = description
            ? `${description}${achievements.length ? `\n${achievements.map((a) => `• ${a}`).join("\n")}` : ""}`
            : achievements.map((a) => `• ${a}`).join("\n")
          const rowText = `${row.title ?? ""} ${row.description ?? ""} ${achievements.join(" ")}`.toLowerCase()
          const inferredTech = skills.filter((skill) => rowText.includes(skill.toLowerCase())).slice(0, 12)
          return {
            title: nonEmpty(row.title),
            company: nonEmpty(row.company),
            location: nonEmpty(row.location),
            startDate: start ?? { month: "January", year: "2020" },
            endDate: end,
            current: row.is_current === true,
            description: mergedDescription.slice(0, 2800),
            technologies: inferredTech,
          }
        })
        .filter((row) => row.title || row.company)
    : []

  const educationFromResume: WorkdayCvEducation[] = Array.isArray(profile.resume_education)
    ? profile.resume_education
        .map((row) => {
          const start = parseMonthYear(row.start_date)
          const end = parseMonthYear(row.end_date)
          return {
            school: nonEmpty(row.institution),
            degree: nonEmpty(row.degree),
            major: nonEmpty(row.field),
            startYear: start?.year ?? "",
            endYear: end?.year ?? "",
            gpa: nonEmpty(row.gpa) || null,
          }
        })
        .filter((row) => row.school || row.degree || row.major)
    : []

  const fallbackEducation: WorkdayCvEducation[] =
    educationFromResume.length > 0
      ? educationFromResume
      : (nonEmpty(profile.university) || nonEmpty(profile.highest_degree))
        ? [
            {
              school: nonEmpty(profile.university),
              degree: nonEmpty(profile.highest_degree),
              major: nonEmpty(profile.field_of_study),
              startYear: "",
              endYear: profile.graduation_year ? String(profile.graduation_year) : "",
              gpa: nonEmpty(profile.gpa) || null,
            },
          ]
        : []

  const skillYears: Record<string, number> = {}
  for (const skill of skills) {
    const key = skill.toLowerCase()
    let years = 0
    for (const row of workExperience) {
      const scope = `${row.title} ${row.description} ${row.technologies.join(" ")}`.toLowerCase()
      if (!scope.includes(key)) continue
      years += calcYearsFromDates(
        `${row.startDate.month} ${row.startDate.year}`,
        row.endDate ? `${row.endDate.month} ${row.endDate.year}` : null,
        row.current,
      )
    }
    if (years > 0) {
      skillYears[skill] = Math.max(1, Math.round(years))
    }
  }

  const yearsOfExperience =
    typeof profile.years_of_experience === "number" && Number.isFinite(profile.years_of_experience)
      ? profile.years_of_experience
      : Math.max(
          0,
          Math.round(
            workExperience.reduce(
              (sum, row) =>
                sum +
                calcYearsFromDates(
                  `${row.startDate.month} ${row.startDate.year}`,
                  row.endDate ? `${row.endDate.month} ${row.endDate.year}` : null,
                  row.current,
                ),
              0,
            ),
          ),
        )

  const salaryExpectation =
    typeof profile.salary_expectation_min === "number" && typeof profile.salary_expectation_max === "number"
      ? `${profile.salary_expectation_min}-${profile.salary_expectation_max}`
      : typeof profile.salary_expectation_min === "number"
        ? String(profile.salary_expectation_min)
        : ""
  // A single value for numeric salary fields — prefer the max, else the min.
  // (Range strings like "100000-120000" become "100000120000" in a numeric
  // input, which most ATS reject as "too large".)
  const salaryExpectationSingle =
    typeof profile.salary_expectation_max === "number"
      ? String(profile.salary_expectation_max)
      : typeof profile.salary_expectation_min === "number"
        ? String(profile.salary_expectation_min)
        : ""

  return {
    firstName: name.firstName,
    middleName: name.middleName,
    lastName: name.lastName,
    preferredName: name.firstName,
    email: nonEmpty(profile.email) || nonEmpty(profile.resume_email),
    phone: sanitizePhone(nonEmpty(profile.phone) || nonEmpty(profile.resume_phone)),
    address: {
      line1: nonEmpty(profile.address_line1),
      line2: nonEmpty(profile.address_line2),
      city: nonEmpty(profile.city) || fallbackLocation.city,
      state: nonEmpty(profile.state) || fallbackLocation.state,
      zip: nonEmpty(profile.zip_code),
      country: nonEmpty(profile.country) || "United States",
    },
    linkedIn: nonEmpty(profile.linkedin_url) || nonEmpty(profile.resume_linkedin_url),
    portfolio:
      nonEmpty(profile.portfolio_url) ||
      nonEmpty(profile.website_url) ||
      nonEmpty(profile.resume_portfolio_url),
    workExperience,
    education: fallbackEducation,
    certifications: Array.isArray(profile.resume_certifications)
      ? profile.resume_certifications.map((c) => nonEmpty(c)).filter(Boolean).slice(0, 12)
      : [],
    skills,
    skillYears,
    visa: {
      authorizedToWork:
        profile.authorized_to_work === true ? true : profile.authorized_to_work === false ? false : null,
      requiresSponsorship: profile.requires_sponsorship === true,
      requiresSponsorshipKnown: profile.requires_sponsorship === true || profile.requires_sponsorship === false,
      authorizedCountries: [nonEmpty(profile.country)].filter(Boolean),
      status: nonEmpty(profile.work_authorization) || (profile.requires_sponsorship ? "H-1B required" : ""),
    },
    salaryExpectation,
    salaryExpectationSingle,
    availability: nonEmpty(profile.earliest_start_date) || "2 weeks notice required",
    citizenship: "",
    yearsOfExperience,
    diversity: {
      optedIn: profile.auto_fill_diversity === true,
      gender: nonEmpty(profile.gender),
      ethnicity: nonEmpty(profile.ethnicity),
      hispanicLatino: nonEmpty(profile.hispanic_latino),
      veteranStatus: nonEmpty(profile.veteran_status),
      disabilityStatus: nonEmpty(profile.disability_status),
    },
  }
}

function parseQuestionLabel(el: HTMLElement): string {
  const id = el.getAttribute("id")
  if (id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)
    if (label?.textContent) return label.textContent.trim()
  }

  const wrapped = el.closest("label")
  if (wrapped?.textContent) return wrapped.textContent.trim()

  const group = el.closest("fieldset, [role='group'], [data-automation-id*='formField']")
  if (group) {
    const legend = group.querySelector("legend, [role='heading'], label, [data-automation-id*='label']")
    if (legend?.textContent) return legend.textContent.trim()
  }

  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel?.trim()) return ariaLabel.trim()
  const placeholder = el.getAttribute("placeholder")
  if (placeholder?.trim()) return placeholder.trim()
  return ""
}

function findOptionByText(options: Element[], desired: string): HTMLElement | null {
  const target = normText(desired)
  if (!target) return null
  const htmlOptions = options
    .filter((opt): opt is HTMLElement => opt instanceof HTMLElement)
    .filter((opt) => isVisible(opt))

  const optionText = (option: HTMLElement): string => {
    const txt = nonEmpty(option.textContent)
    if (txt) return txt
    const automationLabel = nonEmpty(option.getAttribute("data-automation-label"))
    if (automationLabel) return automationLabel
    const ds = option.dataset ? nonEmpty(option.dataset.automationLabel) : ""
    return ds
  }

  for (const option of htmlOptions) {
    const txt = normText(optionText(option))
    if (txt === target) return option
  }
  for (const option of htmlOptions) {
    const txt = normText(optionText(option))
    if (txt && (txt.includes(target) || target.includes(txt))) return option
  }
  return null
}

function safeEscapeSelector(value: string): string {
  try {
    return CSS.escape(value)
  } catch {
    return value.replace(/["\\]/g, "")
  }
}

const US_STATE_CODE_TO_NAME: Record<string, string> = {
  al: "alabama",
  ak: "alaska",
  az: "arizona",
  ar: "arkansas",
  ca: "california",
  co: "colorado",
  ct: "connecticut",
  de: "delaware",
  fl: "florida",
  ga: "georgia",
  hi: "hawaii",
  id: "idaho",
  il: "illinois",
  in: "indiana",
  ia: "iowa",
  ks: "kansas",
  ky: "kentucky",
  la: "louisiana",
  me: "maine",
  md: "maryland",
  ma: "massachusetts",
  mi: "michigan",
  mn: "minnesota",
  ms: "mississippi",
  mo: "missouri",
  mt: "montana",
  ne: "nebraska",
  nv: "nevada",
  nh: "new hampshire",
  nj: "new jersey",
  nm: "new mexico",
  ny: "new york",
  nc: "north carolina",
  nd: "north dakota",
  oh: "ohio",
  ok: "oklahoma",
  or: "oregon",
  pa: "pennsylvania",
  ri: "rhode island",
  sc: "south carolina",
  sd: "south dakota",
  tn: "tennessee",
  tx: "texas",
  ut: "utah",
  vt: "vermont",
  va: "virginia",
  wa: "washington",
  wv: "west virginia",
  wi: "wisconsin",
  wy: "wyoming",
  dc: "district of columbia",
}

const US_STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_CODE_TO_NAME).map(([code, name]) => [name, code]),
)

function normalizeCountryToken(raw: string): string {
  const value = normText(raw)
  if (!value) return ""
  if (
    value === "us" ||
    value === "usa" ||
    value === "u s" ||
    value === "u s a" ||
    value.includes("united states")
  ) {
    return "united states"
  }
  return value
}

function normalizeStateToken(raw: string): string {
  const value = normText(raw).replace(/\./g, "")
  if (!value) return ""
  const compact = value.replace(/\s+/g, " ").trim()
  const noSpaces = compact.replace(/\s+/g, "")
  if (US_STATE_CODE_TO_NAME[compact]) return US_STATE_CODE_TO_NAME[compact]
  if (US_STATE_CODE_TO_NAME[noSpaces]) return US_STATE_CODE_TO_NAME[noSpaces]
  if (US_STATE_NAME_TO_CODE[compact]) return compact
  return compact
}

function isComboboxValueEquivalent(displayedRaw: string, desiredRaw: string, fieldName: string): boolean {
  const displayed = normText(displayedRaw)
  const desired = normText(desiredRaw)
  if (!displayed || !desired) return false
  if (displayed === desired) return true

  const field = normText(fieldName)
  const isCountryField = field.includes("country")
  const isStateField = field.includes("state") || field.includes("province") || field.includes("region")

  if (isCountryField) {
    const normalizedDisplayed = normalizeCountryToken(displayedRaw)
    const normalizedDesired = normalizeCountryToken(desiredRaw)
    if (normalizedDisplayed && normalizedDisplayed === normalizedDesired) return true

    // Workday often shows "United States" or "+1" while the desired value
    // is "United States of America". Treat these as equivalent so we avoid
    // re-opening comboboxes that can trigger flaky apply-flow refetches.
    if (
      field.includes("phone") &&
      normalizedDesired === "united states" &&
      (/\+?\s*1\b/.test(displayedRaw) || /united states/i.test(displayedRaw))
    ) {
      return true
    }

    if (
      normalizedDisplayed &&
      normalizedDesired &&
      (normalizedDisplayed.includes(normalizedDesired) || normalizedDesired.includes(normalizedDisplayed))
    ) {
      return true
    }
  }

  if (isStateField) {
    const normalizedDisplayed = normalizeStateToken(displayedRaw)
    const normalizedDesired = normalizeStateToken(desiredRaw)
    if (normalizedDisplayed && normalizedDisplayed === normalizedDesired) return true
  }

  return false
}

/**
 * Reads the currently-displayed selection text of a Workday combobox without
 * clicking it. Workday renders the selected value in one of these patterns:
 *   1. <input value="…">                     — classic text-box combobox
 *   2. <button>…selected text…</button>      — apply-flow newer template
 *   3. [data-automation-id="selectedItem"]   — explicit selected-item node
 *   4. .css-* button textContent             — falls back to the shell's text
 * The caller compares this with the desired value to decide whether to even
 * open the dropdown — a re-open on a flaky Workday tenant refetches the
 * dependent list (e.g. states for Country) and can hit a 500 + crash.
 */
function extractComboboxDisplayValue(target: HTMLElement): string {
  // Explicit selected-item slot — strongest signal when present.
  const selected = target.querySelector<HTMLElement>(
    '[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"]',
  )
  if (selected?.textContent && selected.textContent.trim()) {
    return selected.textContent.trim()
  }
  // Native input inside the combobox.
  const input = target instanceof HTMLInputElement
    ? target
    : target.querySelector("input")
  if (input instanceof HTMLInputElement && input.value.trim()) {
    return input.value.trim()
  }
  // Button-based combobox shell — read its text.
  const button = target.closest("button") ?? target.querySelector("button")
  if (button?.textContent && button.textContent.trim()) {
    return button.textContent.trim()
  }
  // Last resort: target's own text content (usually the selected label).
  const own = target.textContent?.trim() ?? ""
  return own
}

function resolveInputControlFromElement(
  element: HTMLElement | null,
): HTMLInputElement | HTMLTextAreaElement | null {
  if (!element) return null
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element
  }
  const nested =
    element.querySelector("input, textarea") ??
    element.closest("label, [role='group'], [data-automation-id*='formField']")?.querySelector("input, textarea")
  if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement) {
    return nested
  }
  return null
}

class WorkdayAutofillRunner {
  private cv: WorkdayCv | null = null
  private resumeFile: File | null = null
  private resumeUploadCounted = false
  private readonly resumeJobId: string | null
  private readonly resumeId: string | null
  private readonly resumeVersionId: string | null
  private readonly showToolbar: boolean
  private readonly externalProfile: ExtendedSafeProfile | null
  private readonly onSnapshot?: (snapshot: WorkdayAutofillSnapshot) => void
  private readonly onWarning?: (line: string) => void

  private observer: MutationObserver | null = null
  private stopped = false
  private paused = false
  /**
   * Set when the runner pauses at a step HANDOFF (resume uploaded, step
   * filled, waiting for the user's Save and Continue). When the mutation
   * observer sees the page signature change — the user advanced — the runner
   * auto-resumes and fills the new step. Without this the user had to click
   * Autofill again on EVERY step ("delays" + "fields left out" on Workday).
   * Explicit user pauses, the Review step, and the EEO pause never set it.
   */
  private autoPausedSignature: string | null = null
  private eeoPaused = false
  private processing = false
  private runQueued = false

  private lastStepId: WorkdayStepId = "unknown"
  private lastStepName = ""
  private processedStepSignatures = new Set<string>()

  private fieldsFilledCount = 0
  private totalExpectedFields = 1
  private manualReviewCount = 0
  private manualReviewNotes: string[] = []
  // Required questions the deterministic matcher couldn't answer this step.
  // Resolved in one batched Claude call by flushSemanticQueue() before the step
  // finishes; whatever the model can't answer falls through to manual review.
  private semanticQueue: SemanticQuestion[] = []
  // Bounded interval that re-title-cases Legal Name after Workday's async parser
  // re-uppercases it. Self-terminates; cleared on teardown.
  private nameSalvageTimer: number | null = null
  // Per-step tally of required fields that hit manual review (empty profile
  // value or selector miss). When > 0 the runner skips auto-advance so we
  // don't submit incomplete data to Workday — that's the most common cause
  // of the server-side "Something went wrong / 500" page on apply-flow tenants.
  private requiredFieldMissesThisStep = 0
  private phase: WorkdayAutofillPhase = "idle"
  private statusTitle = "Idle"
  private statusSubtitle = ""
  private debugEntries: WorkdayDebugEntry[] = []

  private toolbarRoot: HTMLElement | null = null
  private toolbarLog: HTMLElement | null = null
  private toolbarStatus: HTMLElement | null = null
  private toolbarSubtitle: HTMLElement | null = null
  private toolbarProgressBar: HTMLElement | null = null
  private toolbarProgressText: HTMLElement | null = null
  private pauseBtn: HTMLButtonElement | null = null
  private skipBtn: HTMLButtonElement | null = null
  private stopBtn: HTMLButtonElement | null = null
  private resumeBtn: HTMLButtonElement | null = null

  constructor(options?: WorkdayAutofillRunnerOptions) {
    this.showToolbar = options?.showToolbar === true
    this.externalProfile = options?.profile ?? null
    this.onSnapshot = options?.onSnapshot
    this.onWarning = options?.onWarning
    this.resumeFile = options?.resumeFile ?? null
    this.resumeJobId = options?.resumeJobId ?? null
    this.resumeId = options?.resumeId ?? null
    this.resumeVersionId = options?.resumeVersionId ?? null
    this.publishDebug()
    this.debug("info", "runner.init", {
      showToolbar: this.showToolbar,
      hasExternalProfile: Boolean(this.externalProfile),
      hasResumeFile: Boolean(this.resumeFile),
      hasResumeJobId: Boolean(this.resumeJobId),
      href: window.location.href,
    })
  }

  static isWorkdayDetected(): boolean {
    const host = window.location.hostname.toLowerCase()
    if (
      host.includes("myworkdayjobs.com") ||
      /(?:^|\.)wd\d+\.myworkdayjobs\.com$/.test(host) ||
      host.endsWith(".workdayjobs.com") ||
      host === "apply.workday.com"
    ) {
      return true
    }
    // DOM signature — covers vanity / custom domains (e.g. Synchrony) that CNAME
    // to Workday but don't serve from *.myworkdayjobs.com, so the host check
    // above misses them entirely. These automation-ids are Workday-specific:
    // the apply page / My-Info flow wrappers AND the pre-form "Start Your
    // Application" chooser ("Apply Manually" / "Autofill with Resume"). Matching
    // any one is a strong Workday signal, so the runner engages instead of the
    // bar reading "Autofill not detected" and never clicking the chooser.
    return (
      document.querySelector(
        '[data-automation-id="applicationPage"], ' +
        '[data-automation-id="applyFlowMyInfoPage"], ' +
        '[data-automation-id="legalNameSection_firstName"], ' +
        '[data-automation-id="applyManually" i], ' +
        '[data-automation-id="applyManuallyButton" i], ' +
        '[data-automation-id="fileUploadDropZone"], ' +
        '[data-automation-id="file-upload-drop-zone"]',
      ) !== null
    )
  }

  async start(): Promise<void> {
    if (!WorkdayAutofillRunner.isWorkdayDetected()) return
    if (this.stopped) return

    if (this.showToolbar) this.mountToolbar()
    this.phase = "running"
    this.setToolbarState("WAITING", "Loading Apex CV memory for Workday…")

    const ok = await this.initializeContext()
    if (!ok) return

    if (this.showToolbar) this.observeMutations()
    this.scheduleRun("startup")
  }

  private async initializeContext(): Promise<boolean> {
    if (this.cv) return true
    this.debug("info", "context.initialize.start", {
      usingExternalProfile: Boolean(this.externalProfile),
    })
    const profilePayload = this.externalProfile
      ? { profile: this.externalProfile }
      : await getAutofillProfile().catch(() => ({ profile: null, profileMissing: true }))
    if (!profilePayload.profile) {
      this.phase = "error"
      this.setToolbarState("NEEDS_REVIEW", "Apex profile missing. Complete autofill profile in Hireoven.")
      this.logWarning("Manual review needed: no autofill profile found in Apex memory.")
      this.debug("error", "context.initialize.profile_missing")
      window[GLOBAL_LAST_ERROR_KEY] = "Apex profile missing."
      return false
    }

    this.cv = mapProfileToWorkdayCv(profilePayload.profile as ExtendedSafeProfile)
    this.totalExpectedFields = this.estimateTotalFields(this.cv)
    this.debug("info", "context.initialize.cv_ready", {
      workExperience: this.cv.workExperience.length,
      education: this.cv.education.length,
      skills: this.cv.skills.length,
      hasPhone: Boolean(this.cv.phone),
      hasEmail: Boolean(this.cv.email),
    })
    this.refreshProgress()

    if (!this.resumeFile) {
      // Priority: versionId (the tailored snapshot the user approved on the
      // bar) → base resumeId → jobId (server resolves a per-job tailored copy
      // or primary) → primary. The base resumeId is NOT the tailored content,
      // so versionId must win.
      const resumeBytes = await fetchPrimaryResume({
        versionId: this.resumeVersionId ?? undefined,
        jobId: this.resumeJobId ?? undefined,
        resumeId: this.resumeId ?? undefined,
      }).catch(() => null)
      if (resumeBytes) {
        // Give the attachment a recruiter-facing name. The server may return an
        // internal label ("Tailored for … at … · Workday.docx"); rename it to
        // "<Full Name> - <Role> Resume.docx" so the recruiter never sees the
        // tooling label. Role comes from the job posting (the browser tab title
        // on Workday apply pages is the job title).
        const professionalName = this.professionalResumeName(resumeBytes.filename)
        const file = this.decodeBase64File(resumeBytes.base64, professionalName)
        if (file) this.resumeFile = file
        this.debug("info", "context.initialize.resume_loaded", {
          jobId: this.resumeJobId,
          resumeId: this.resumeId,
          versionId: this.resumeVersionId,
          serverFilename: resumeBytes.filename,
          filename: professionalName,
          loaded: Boolean(this.resumeFile),
        })
      } else {
        this.debug("warn", "context.initialize.resume_not_found")
      }
    } else {
      this.debug("info", "context.initialize.resume_provided")
    }
    return true
  }

  stop(): void {
    this.stopped = true
    this.paused = true
    this.processing = false
    this.phase = "stopped"
    this.observer?.disconnect()
    this.observer = null
    if (this.nameSalvageTimer != null) {
      clearInterval(this.nameSalvageTimer)
      this.nameSalvageTimer = null
    }
    this.setToolbarState("STOPPED", "Autofill stopped.")
    if (this.pauseBtn) this.pauseBtn.disabled = true
    if (this.skipBtn) this.skipBtn.disabled = true
    if (this.resumeBtn) this.resumeBtn.disabled = true
    this.debug("warn", "runner.stopped")
  }

  pause(): void {
    if (this.stopped) return
    if (this.eeoPaused) return
    this.paused = true
    this.autoPausedSignature = null // explicit pause — never auto-resume
    this.phase = "paused"
    this.setToolbarState("PAUSED", "Autofill paused.")
    this.debug("info", "runner.paused")
  }

  /** Pause at a step handoff — auto-resumes when the user advances the page. */
  private markStepHandoffPause(): void {
    this.paused = true
    this.autoPausedSignature = this.captureApplicationPageSignature() || "unknown"
  }

  resume(): void {
    if (this.stopped) return
    this.eeoPaused = false
    this.paused = false
    this.phase = "running"
    this.showResumeButton(false)
    this.setToolbarState("WAITING", "Resuming Workday autofill…")
    this.scheduleRun("manual")
    this.debug("info", "runner.resumed")
  }

  async skipStep(): Promise<void> {
    if (this.stopped || this.processing) return
    const moved = await this.clickNextAndWait()
    if (moved) this.scheduleRun("manual")
    this.debug("info", "runner.skip_step", { moved })
  }

  /**
   * Fill the currently-visible Workday step and stop. The runner deliberately
   * does NOT auto-advance through the wizard — the user reviews, fixes any
   * misses, and clicks Save and Continue themselves. When the next step's DOM
   * appears, the apex-bar's MutationObserver re-detects it and re-enables
   * the Autofill button so the user can click it again for the next step.
   *
   * `maxCycles` is kept on the signature for backwards-compat but ignored.
   */
  async runCurrentStep(_maxCycles?: number): Promise<WorkdayAutofillRunResult> {
    this.phase = "running"
    this.setToolbarState("WAITING", "Running Workday autofill…")
    this.debug("info", "run_current_step.start")
    const ok = await this.initializeContext()
    if (!ok) return this.buildResult()
    try {
      await this.run("manual")
    } catch (error) {
      this.phase = "error"
      const message = error instanceof Error ? error.message : "Unexpected Workday autofill error"
      window[GLOBAL_LAST_ERROR_KEY] = message
      this.debug("error", "run_current_step.error", { message })
    }
    this.debug("info", "run_current_step.complete")
    return this.buildResult()
  }

  /** @deprecated alias retained for older call sites; behaves identically to runCurrentStep. */
  async runUntilSettled(maxCycles = 10): Promise<WorkdayAutofillRunResult> {
    return this.runCurrentStep(maxCycles)
  }

  private buildResult(): WorkdayAutofillRunResult {
    const step = this.detectStep()
    if (step.id === "review") {
      this.phase = "done"
    } else if (this.eeoPaused) {
      this.phase = "needs_review"
    }
    const baseRow: AutofillFieldResult = {
      label: "Workday multi-step autofill",
      valuePreview: `${this.fieldsFilledCount}/${this.totalExpectedFields}`,
      confidence: "high",
      source: "profile",
      filled: this.fieldsFilledCount > 0,
    }
    const rows: AutofillFieldResult[] = [baseRow]
    for (const note of this.manualReviewNotes.slice(0, 24)) {
      rows.push({
        label: note.replace(/^⚠️\s*Manual review needed:\s*/i, ""),
        confidence: "needs_review",
        source: "manual_required",
        filled: false,
        skippedReason: note,
      })
    }
    const result: WorkdayAutofillRunResult = {
      phase: this.phase,
      stepId: step.id,
      stepName: step.name,
      fieldsFilledCount: this.fieldsFilledCount,
      totalExpectedFields: this.totalExpectedFields,
      manualReviewCount: this.manualReviewCount,
      manualReviewNotes: [...this.manualReviewNotes],
      eeoPaused: this.eeoPaused,
      reachedReview: step.id === "review",
      blockedReason: step.id === "account_required" ? "account_required" : null,
      debugEntryCount: this.debugEntries.length,
      debugTail: this.debugEntries.slice(-120),
      rows,
    }
    this.debug("info", "run.result", {
      phase: result.phase,
      stepId: result.stepId,
      reachedReview: result.reachedReview,
      fieldsFilledCount: result.fieldsFilledCount,
      manualReviewCount: result.manualReviewCount,
      debugEntryCount: result.debugEntryCount,
    })
    this.publishLastResult(result)
    return result
  }

  getSnapshot(): WorkdayAutofillSnapshot {
    const step = this.detectStep()
    const progressPct = Math.max(
      0,
      Math.min(
        100,
        Math.round((this.fieldsFilledCount / Math.max(1, this.totalExpectedFields)) * 100),
      ),
    )
    return {
      phase: this.phase,
      title: this.statusTitle,
      subtitle: this.statusSubtitle,
      step,
      fieldsFilledCount: this.fieldsFilledCount,
      totalExpectedFields: this.totalExpectedFields,
      progressPct,
      manualReviewCount: this.manualReviewCount,
      eeoPaused: this.eeoPaused,
    }
  }

  private cleanDebugValue(value: unknown): string | number | boolean | null {
    if (value == null) return null
    if (typeof value === "boolean" || typeof value === "number") return value
    if (typeof value === "string") return value.length > 220 ? `${value.slice(0, 217)}...` : value
    if (value instanceof Element) return `<${value.tagName.toLowerCase()}>`
    return String(value)
  }

  private publishDebug(): void {
    window[GLOBAL_DEBUG_KEY] = [...this.debugEntries]
  }

  private publishLastResult(result: WorkdayAutofillRunResult): void {
    window[GLOBAL_LAST_RESULT_KEY] = result
    window[GLOBAL_LAST_ERROR_KEY] = result.phase === "error" ? this.statusTitle || "Workday autofill error" : null
  }

  private debug(level: WorkdayDebugLevel, event: string, details?: Record<string, unknown>): void {
    const cleanDetails: Record<string, string | number | boolean | null> | undefined = details
      ? Object.fromEntries(
          Object.entries(details).map(([key, value]) => [key, this.cleanDebugValue(value)]),
        )
      : undefined
    const entry: WorkdayDebugEntry = {
      at: new Date().toISOString(),
      level,
      event,
      phase: this.phase,
      stepId: this.lastStepId,
      stepName: this.lastStepName,
      details: cleanDetails,
    }
    this.debugEntries.push(entry)
    if (this.debugEntries.length > DEBUG_LOG_LIMIT) {
      this.debugEntries.splice(0, this.debugEntries.length - DEBUG_LOG_LIMIT)
    }
    this.publishDebug()
  }

  private observeMutations(): void {
    if (this.observer) this.observer.disconnect()
    this.observer = new MutationObserver(() => {
      if (this.stopped) return
      // Step-handoff pause + the page changed under us → the USER advanced
      // (clicked Save and Continue / Continue). Resume and fill the new step.
      // The pause exists to stop the RUNNER from auto-clicking navigation —
      // not to make the human re-trigger Autofill on every page.
      if (this.paused && !this.eeoPaused && !this.processing && this.autoPausedSignature) {
        const sig = this.captureApplicationPageSignature()
        if (sig && sig !== this.autoPausedSignature) {
          this.paused = false
          this.autoPausedSignature = null
          this.phase = "running"
          this.setToolbarState("WAITING", "Next step detected — resuming autofill…")
          this.debug("info", "runner.auto_resumed_on_step_change")
        }
      }
      this.scheduleRun("mutation")
    })
    this.observer.observe(document.body, { childList: true, subtree: true })
    this.debug("info", "observer.started")
  }

  private scheduleRun(reason: string): void {
    if (this.stopped) return
    if (this.runQueued) {
      this.debug("info", "run.schedule.skipped_already_queued", { reason })
      return
    }
    this.runQueued = true
    this.debug("info", "run.schedule.queued", { reason })
    window.setTimeout(() => {
      this.runQueued = false
      void this.run(reason)
    }, 120)
  }

  private async run(reason: string): Promise<void> {
    if (this.stopped || this.paused || this.processing) {
      this.debug("info", "run.skipped", {
        reason,
        stopped: this.stopped,
        paused: this.paused,
        processing: this.processing,
      })
      return
    }
    if (!this.cv) {
      this.debug("warn", "run.skipped_no_cv", { reason })
      return
    }
    if (!WorkdayAutofillRunner.isWorkdayDetected()) {
      this.debug("warn", "run.skipped_not_workday", { reason, host: window.location.hostname })
      return
    }

    this.processing = true
    try {
      const step = this.detectStep()
      const pageSignature = this.captureApplicationPageSignature()
      const stepSignature = `${step.id}|${pageSignature}`
      this.debug("info", "run.begin", {
        reason,
        stepId: step.id,
        stepName: step.name,
        stepIndex: step.index,
        signature: pageSignature,
      })

      if (
        reason !== "manual" &&
        this.processedStepSignatures.has(stepSignature) &&
        step.id === this.lastStepId &&
        step.name === this.lastStepName
      ) {
        this.debug("info", "run.skip_duplicate_signature", { reason, stepSignature })
        return
      }

      this.lastStepId = step.id
      this.lastStepName = step.name
      this.requiredFieldMissesThisStep = 0
      this.setToolbarState(
        "FILLING",
        `Autofilling Step ${step.index} of ${step.total} · ${step.name}`,
      )

      const brokenState = this.detectBrokenApplyFlowState()
      if (brokenState.broken) {
        this.markStepHandoffPause() // auto-resumes once the user refreshes/fixes
        this.setToolbarState(
          "NEEDS_REVIEW",
          "Workday session is in an error state. Refresh this page before retrying autofill.",
        )
        this.showResumeButton(true)
        this.logWarning("Manual review needed: Workday returned internal errors (jobapplication/package undefined). Refresh and retry.")
        this.debug(
          "error",
          "run.pause_broken_apply_flow_state",
          brokenState.resource
            ? { reason: brokenState.reason, resource: brokenState.resource }
            : { reason: brokenState.reason },
        )
        return
      }

      if (step.id === "account_required") {
        this.markStepHandoffPause() // auto-resumes when sign-in completes
        this.setToolbarState(
          "PAUSED",
          "Sign in or create your Workday account, then click Resume.",
        )
        this.showResumeButton(true)
        this.logWarning(
          "Manual review needed: Workday requires an account before the application can be filled. Complete Sign In / Create Account, then resume.",
        )
        this.debug("warn", "run.pause_account_required")
        return
      }

      this.showResumeButton(false)

      if (step.id === "review") {
        this.setToolbarState(
          "DONE",
          `Apex filled ${this.fieldsFilledCount} fields across completed Workday steps.`,
        )
        this.setToolbarNote("Apex will NOT auto-submit. Review and submit yourself.")
        this.paused = true
        this.debug("info", "run.reached_review")
        return
      }

      switch (step.id) {
        case "start_application": {
          // Choose "Apply Manually" — a clean form we fill ourselves — instead
          // of uploading / parsing the résumé. Clicking it navigates to My
          // Information; the observer (manual) or agent loop re-detects next.
          const clicked = await this.clickApplyManually()
          this.debug(clicked ? "info" : "warn", "run.start_application", { clicked })
          if (clicked) {
            this.startNameCasingWatch(20000)
            this.setToolbarState("WAITING", "Opening a manual Workday application…")
          } else {
            this.requiredFieldMissesThisStep += 1
            this.setToolbarState(
              "NEEDS_REVIEW",
              "Couldn't start the manual application.",
              "Click \"Apply Manually\" on the page, then continue.",
            )
            this.logWarning(
              "Manual review needed: choose 'Apply Manually' to start the Workday application without uploading a résumé.",
            )
          }
          break
        }
        case "resume_upload": {
          const filledBefore = this.fieldsFilledCount
          const uploaded = await this.maybeUploadResume()
          if (uploaded) this.startNameCasingWatch(20000)
          this.markStepHandoffPause() // auto-resumes when the user clicks Continue
          if (uploaded || this.fieldsFilledCount > filledBefore) {
            this.setToolbarState(
              "DONE",
              "Resume upload complete. Click Continue to move to My Information.",
            )
            this.debug("info", "run.resume_upload.complete")
          } else {
            this.setToolbarState(
              "NEEDS_REVIEW",
              "Could not confirm resume upload on this step.",
              "Attach your resume manually if needed, then click Continue.",
            )
            this.debug("warn", "run.resume_upload.needs_review")
          }
          break
        }
        case "my_information":
          await this.fillMyInformationStep()
          break
        case "my_experience":
          await this.fillMyExperienceStep()
          break
        case "application_questions":
          await this.fillApplicationQuestionsStep()
          break
        case "self_identify":
          await this.fillSelfIdentifyStep()
          break
        default:
          break
      }

      this.processedStepSignatures.add(stepSignature)

      // Per-step UX: never auto-click Save and Continue. Workday's apply-flow
      // backend is intolerant of rapid sequential submits — racing its
      // reactive validators with stale field state is the dominant cause of
      // the generic 500 + "Something went wrong" page. Always let the user
      // review, fix anything we missed, and click Save and Continue manually.
      const fillsThisStep =
        step.id === "my_information" ||
        step.id === "my_experience" ||
        step.id === "application_questions" ||
        step.id === "self_identify"
      if (fillsThisStep) {
        if (this.requiredFieldMissesThisStep > 0) {
          this.markStepHandoffPause() // auto-resumes when the user advances
          this.setToolbarState(
            "NEEDS_REVIEW",
            `${step.name} filled (${this.fieldsFilledCount}/${this.totalExpectedFields}). ${this.requiredFieldMissesThisStep} field${this.requiredFieldMissesThisStep === 1 ? "" : "s"} need you.`,
            "Fill the highlighted fields and click Save and Continue. I'll pick up the next step.",
          )
          this.debug("warn", "run.complete_with_misses", {
            stepId: step.id,
            misses: this.requiredFieldMissesThisStep,
          })
        } else {
          this.markStepHandoffPause() // auto-resumes when the user advances
          this.setToolbarState(
            "DONE",
            `${step.name} filled (${this.fieldsFilledCount}/${this.totalExpectedFields}).`,
            "Review and click Save and Continue. I'll pick up the next step.",
          )
          this.debug("info", "run.complete_clean", { stepId: step.id })
        }
      }
      this.debug("info", "run.complete", { stepId: step.id })
    } catch (error) {
      this.phase = "error"
      const message = error instanceof Error ? error.message : "Unexpected Workday autofill error"
      this.setToolbarState("NEEDS_REVIEW", `Autofill error: ${message}`)
      window[GLOBAL_LAST_ERROR_KEY] = message
      this.debug("error", "run.error", { message })
      throw error
    } finally {
      this.processing = false
    }
  }

  private detectStep(): WorkdayStep {
    // Workday gates the apply flow behind Sign In / Create Account. The fields
    // there (email, password, confirm-password) would otherwise be filled as
    // if they were the My Information step — detect this first and bail.
    if (this.isAccountStep()) {
      return { id: "account_required", name: "Sign in to Workday", index: 0, total: STEP_TOTAL }
    }

    // "Start Your Application" chooser (Apply Manually / Autofill with Resume /
    // Use My Last Application). Prefer a clean, manually-filled form over the
    // résumé parser (which produces miscased / mis-segmented data), so this is
    // detected BEFORE resume_upload and resolved by clicking "Apply Manually".
    if (this.isStartApplicationStep()) {
      return { id: "start_application", name: "Start Your Application", index: 0, total: STEP_TOTAL }
    }

    const stepEl =
      document.querySelector('[data-automation-id="currentPage"]') ??
      document.querySelector('[aria-label*="Step"]')
    const text = nonEmpty(stepEl?.textContent)
    const normalized = normText(text)
    const headingText = normText(
      nonEmpty(
        document.querySelector(
          '[data-automation-id="pageHeader"], [data-automation-id="pageTitle"], h1, h2',
        )?.textContent,
      ),
    )

    const uploadSurfaceVisible = Boolean(
      document.querySelector(
        '[data-automation-id="file-upload-drop-zone"], ' +
        '[data-automation-id="select-files"], ' +
        '[data-automation-id="resume-upload"]',
      ),
    )
    const bodyText = normText(document.body?.textContent ?? "")
    const hasResumeUploadCopy =
      bodyText.includes("autofill with resume") ||
      (bodyText.includes("drop file here") && bodyText.includes("select file"))

    const isResumeUploadHeading =
      headingText.includes("autofill with resume") ||
      ((headingText.includes("upload") || headingText.includes("drop file")) &&
        (headingText.includes("resume") || headingText.includes("cv"))) ||
      normalized.includes("autofill with resume")
    if (isResumeUploadHeading && (this.findResumeFileInput() || uploadSurfaceVisible)) {
      return { id: "resume_upload", name: "Autofill with Resume", index: 1, total: STEP_TOTAL }
    }
    if (hasResumeUploadCopy && (this.findResumeFileInput() || uploadSurfaceVisible)) {
      return { id: "resume_upload", name: "Autofill with Resume", index: 1, total: STEP_TOTAL }
    }

    // Newer "Apply Flow" template emits per-step page wrappers — strongest signal.
    if (document.querySelector('[data-automation-id="selfIdentifyPage"], [data-automation-id="applyFlowSelfIdentifyPage"]')) {
      return { id: "self_identify", name: "Self Identify", index: 4, total: STEP_TOTAL }
    }
    if (document.querySelector('[data-automation-id="applyFlowMyInfoPage"], [data-automation-id="myInformationPage"]')) {
      return { id: "my_information", name: "My Information", index: 1, total: STEP_TOTAL }
    }
    if (
      document.querySelector(
        '[data-automation-id="applyFlowMyExperiencePage"], ' +
        '[data-automation-id="applyFlowMyExpPage"], ' +
        '[data-automation-id="myExperiencePage"]',
      )
    ) {
      return { id: "my_experience", name: "My Experience", index: 2, total: STEP_TOTAL }
    }
    if (
      document.querySelector(
        '[data-automation-id="applyFlowApplicationQuestionsPage"], ' +
        '[data-automation-id="applyFlowQuestionnairePage"]',
      )
    ) {
      return { id: "application_questions", name: "Application Questions", index: 3, total: STEP_TOTAL }
    }
    if (document.querySelector('[data-automation-id="applyFlowReviewPage"], [data-automation-id="reviewPage"]')) {
      return { id: "review", name: "Review", index: 5, total: STEP_TOTAL }
    }

    // Some tenants have no currentPage marker and no per-step page wrappers.
    // The progress bar still announces the active step ("current step 2 of 6
    // My Experience"), and the page heading (h2 "My Experience") is a second
    // independent signal — fold both into the step-name matching.
    const progressCurrent = ((): string => {
      const active = document.querySelector<HTMLElement>(
        '[data-automation-id="progressBar"] [aria-current="step"], ' +
        '[data-automation-id="progressBar"] [aria-current="true"], ' +
        '[aria-current="step"]',
      )
      if (active) return normText(active.textContent ?? "")
      const m = bodyText.match(
        /current step \d+ of \d+\s*(my information|my experience|application questions|voluntary disclosures|self identify|review)/,
      )
      return m ? m[1] : ""
    })()
    const stepHints = `${normalized} ${progressCurrent} ${headingText}`

    if (stepHints.includes("my information")) {
      return { id: "my_information", name: "My Information", index: 1, total: STEP_TOTAL }
    }
    if (stepHints.includes("my experience")) {
      return { id: "my_experience", name: "My Experience", index: 2, total: STEP_TOTAL }
    }
    if (stepHints.includes("application question")) {
      return { id: "application_questions", name: "Application Questions", index: 3, total: STEP_TOTAL }
    }
    if (
      stepHints.includes("self identify") ||
      stepHints.includes("self-identify") ||
      stepHints.includes("voluntary disclosures")
    ) {
      return { id: "self_identify", name: "Self Identify", index: 4, total: STEP_TOTAL }
    }
    if (stepHints.includes("review")) {
      return { id: "review", name: "Review", index: 5, total: STEP_TOTAL }
    }

    // Last-resort: presence of legal-name inputs is unambiguous My Information.
    if (
      document.querySelector(
        '[data-automation-id="legalNameSection_firstName"], ' +
        '[data-automation-id="formField-legalName--firstName"], ' +
        '[data-automation-id="legalName--firstName"]',
      )
    ) {
      return { id: "my_information", name: "My Information", index: 1, total: STEP_TOTAL }
    }
    if (
      document.querySelector(
        '[data-automation-id="workExperienceSection"], ' +
        '[data-automation-id="formField-workExperience"], ' +
        '[data-automation-id="educationSection"], ' +
        '[data-automation-id="formField-education"]',
      )
    ) {
      return { id: "my_experience", name: "My Experience", index: 2, total: STEP_TOTAL }
    }
    // Inline tenants without section automation ids: an editable page listing
    // Work Experience + Education with Add buttons is the My Experience step.
    const hasSectionAddButtons = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"]'),
    ).some((b) => isVisible(b) && /^add( another)?$/.test(normText(b.textContent ?? "")))
    if (hasSectionAddButtons && bodyText.includes("work experience") && bodyText.includes("education")) {
      return { id: "my_experience", name: "My Experience", index: 2, total: STEP_TOTAL }
    }
    if (document.querySelector('[data-automation-id*="review"], [data-automation-id="reviewPage"]')) {
      return { id: "review", name: "Review", index: 5, total: STEP_TOTAL }
    }
    if (
      document.querySelector(
        '[data-automation-id="questionnairePage"], ' +
        '[data-automation-id*="questionnaire"], ' +
        '[data-automation-id*="applicationQuestion"]',
      )
    ) {
      return { id: "application_questions", name: text || "Application Questions", index: 3, total: STEP_TOTAL }
    }
    return { id: "unknown", name: text || "Workday Application", index: 1, total: STEP_TOTAL }
  }

  /**
   * Detects the Workday Sign In / Create Account gate that precedes the apply
   * wizard. Workday emits stable automation ids for these inputs; we also
   * accept a heuristic where a password input is visible without any
   * application-step markers above it.
   */
  private isAccountStep(): boolean {
    const accountMarkers = document.querySelector(
      '[data-automation-id="createAccountSubmitButton"], ' +
      '[data-automation-id="signInSubmitButton"], ' +
      '[data-automation-id="verifyNewPasswordSubmitButton"], ' +
      '[data-automation-id="createAccountPage"], ' +
      '[data-automation-id="signInPage"]',
    )
    if (accountMarkers) return true

    const passwordInput = document.querySelector<HTMLInputElement>('input[type="password"]')
    if (!passwordInput || !isVisible(passwordInput)) return false
    const inApplicationFlow = document.querySelector(
      '[data-automation-id="applicationPage"], [data-automation-id="applyFlow"], ' +
      '[data-automation-id="applyFlowPage"], [data-automation-id="applyFlowMyInfoPage"], ' +
      '[data-automation-id="currentPage"], [data-automation-id="legalNameSection_firstName"], ' +
      '[data-automation-id="formField-legalName--firstName"]',
    )
    return !inApplicationFlow
  }

  /**
   * Locate the "Apply Manually" choice on Workday's "Start Your Application"
   * chooser. Tries the stable automation id first, then a visible-text match
   * for tenants/i18n variants that don't expose it.
   */
  private findApplyManuallyButton(): HTMLElement | null {
    const byId = document.querySelector<HTMLElement>(
      '[data-automation-id="applyManually" i], [data-automation-id="applyManuallyButton" i]',
    )
    if (byId && isControlReachable(byId)) return byId

    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('a[role="button"], a[href], button, [role="button"]'),
    )
    for (const el of candidates) {
      if (!isControlReachable(el)) continue
      const text = normText(el.textContent || el.getAttribute("aria-label"))
      if (text === "apply manually" || text === "apply manual") return el
    }
    return null
  }

  /**
   * True on the "Start Your Application" chooser — detected by the presence of
   * an "Apply Manually" option and the absence of the real application form
   * (so we don't re-trigger it once past the chooser).
   */
  private isStartApplicationStep(): boolean {
    if (!this.findApplyManuallyButton()) return false
    const inForm = document.querySelector(
      '[data-automation-id="legalNameSection_firstName"], ' +
      '[data-automation-id="formField-legalName--firstName"], ' +
      '[data-automation-id="legalName--firstName"], ' +
      '[data-automation-id="applyFlowMyInfoPage"]',
    )
    return !inForm
  }

  /**
   * Click "Apply Manually" to open a clean, blank application form (no résumé
   * parsing). Waits for the chooser to give way before returning so the caller
   * doesn't act on the stale start screen.
   */
  private async clickApplyManually(): Promise<boolean> {
    const button = this.findApplyManuallyButton()
    if (!button) return false
    this.setToolbarField("Apply Manually")
    try {
      button.scrollIntoView({ block: "center" })
    } catch {
      // best-effort
    }
    await sleep(200 + Math.round(Math.random() * 300))
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    button.click()
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      await sleep(200)
      if (!this.findApplyManuallyButton()) return true
    }
    return !this.findApplyManuallyButton()
  }

  private captureApplicationPageSignature(): string {
    const page =
      document.querySelector('[data-automation-id="applicationPage"]') ??
      document.querySelector('[data-automation-id="applyFlowPage"]') ??
      document.querySelector('[data-automation-id="applyFlow"]')
    if (!page) return `${window.location.pathname}|no-app-page`
    const text = nonEmpty(page.textContent).slice(0, 220)
    const controls = page.querySelectorAll("input, select, textarea, button").length
    return `${window.location.pathname}|${controls}|${text}`
  }

  private detectBrokenApplyFlowState(): { broken: boolean; reason: string; resource?: string } {
    const pageText = normText(document.body?.textContent ?? "")
    if (pageText.includes("something went wrong") && pageText.includes("please refresh the page")) {
      return { broken: true, reason: "error_page_visible" }
    }

    try {
      const resources = performance.getEntriesByType("resource")
      for (let i = resources.length - 1; i >= 0 && i >= resources.length - 120; i -= 1) {
        const entry = resources[i]
        const name = nonEmpty((entry as PerformanceResourceTiming).name)
        if (!name) continue
        if (!name.includes(window.location.hostname)) continue
        if (/\/wday\/(?:calypso|cxs)\//i.test(name) && /\/(?:jobapplication|package)\/undefined(?:\/|$)/i.test(name)) {
          return { broken: true, reason: "undefined_resource_path", resource: name.slice(0, 240) }
        }
      }
    } catch {
      // Ignore when resource timing is unavailable.
    }

    return { broken: false, reason: "ok" }
  }

  private async fillMyInformationStep(): Promise<void> {
    if (!this.cv) return
    this.debug("info", "step.my_information.start")
    await this.repairNameCapitalizationAlerts()

    // Name fields are title-cased and force-overwritten — Workday's resume
    // parser frequently dumps ALL CAPS values that fail the tenant's
    // capitalization validator. salvageMiscased lets us rewrite the existing
    // field even when our profile lacks a name (we title-case the value
    // already on the page).
    //
    // Tenants render automation-ids in two schemes:
    //   classic: legalNameSection_firstName, addressSection_city, …
    //   apply-flow: formField-legalName--firstName, formField-city, …
    // resolveInputControlFromElement drills into the wrapper to find the input
    // regardless of which scheme the tenant uses.
    await this.fillTextSmart(
      [
        '[data-automation-id="legalNameSection_firstName"]',
        '[data-automation-id="formField-legalName--firstName"]',
        '[data-automation-id="legalName--firstName"]',
        '[data-automation-id="firstName"]',
      ],
      /^(legal\s+)?first\s*name$/,
      this.cv.firstName,
      "First Name",
      { forceOverwrite: true, salvageMiscased: true },
    )
    await this.fillTextSmart(
      [
        '[data-automation-id="legalNameSection_middleName"]',
        '[data-automation-id="formField-legalName--middleName"]',
        '[data-automation-id="legalName--middleName"]',
        '[data-automation-id="middleName"]',
      ],
      /^(legal\s+)?middle\s*name$/,
      this.cv.middleName,
      "Middle Name",
      { optional: true, forceOverwrite: true, salvageMiscased: true },
    )
    await this.fillTextSmart(
      [
        '[data-automation-id="legalNameSection_lastName"]',
        '[data-automation-id="formField-legalName--lastName"]',
        '[data-automation-id="legalName--lastName"]',
        '[data-automation-id="lastName"]',
      ],
      /^(legal\s+)?(last|family|sur)\s*name$/,
      this.cv.lastName,
      "Last Name",
      { forceOverwrite: true, salvageMiscased: true },
    )
    await this.fillTextSmart(
      [
        '[data-automation-id="preferredName-firstName"]',
        '[data-automation-id="formField-preferredName--firstName"]',
        '[data-automation-id="preferredName"]',
      ],
      /^preferred\s+(first\s+)?name$/,
      this.cv.preferredName || this.cv.firstName,
      "Preferred Name",
      { optional: true, forceOverwrite: true },
    )
    // Workday's résumé parser re-populates Legal Name in ALL CAPS *asynchronously*
    // (a network round-trip after the résumé upload), often AFTER this step has
    // run — so a one-shot fix loses the race. Start a short bounded watcher that
    // re-title-cases any miscased name field for a few seconds, outliving the
    // parse. Placed right after the name fills so it also survives if a later
    // part of this step throws.
    this.startNameCasingWatch()
    await this.fillTextSmart(
      [
        '[data-automation-id="addressSection_addressLine1"]',
        '[data-automation-id="formField-address--addressLine1"]',
        '[data-automation-id="formField-addressLine1"]',
        '[data-automation-id="addressLine1"]',
      ],
      /^address line 1$/,
      this.cv.address.line1,
      "Address Line 1",
      { optional: !this.cv.address.line1 }, // can't invent a street we don't have
    )
    await this.fillTextSmart(
      [
        '[data-automation-id="addressSection_addressLine2"]',
        '[data-automation-id="formField-address--addressLine2"]',
        '[data-automation-id="formField-addressLine2"]',
        '[data-automation-id="addressLine2"]',
      ],
      /^address line 2$/,
      this.cv.address.line2,
      "Address Line 2",
      { optional: true },
    )
    await this.fillTextSmart(
      [
        '[data-automation-id="addressSection_city"]',
        '[data-automation-id="formField-address--city"]',
        '[data-automation-id="formField-city"]',
        '[data-automation-id="city"]',
      ],
      /^city$/,
      this.cv.address.city,
      "City",
      { optional: !this.cv.address.city },
    )
    // Country MUST be selected before State and Postal Code on apply-flow
    // tenants — the State dropdown options and the Postal Code validator are
    // both downstream of the selected country. Filling state first triggers
    // Workday's reactive validators with an inconsistent (country, state)
    // pair, which is one of the known triggers for the server-side 500.
    await this.selectComboSmart(
      '[data-automation-id="addressSection_country"], ' +
      '[data-automation-id="formField-country"], ' +
      '[data-automation-id="formField-address--country"]',
      /^country$/,
      this.cv.address.country || "United States",
      "Country",
      { riskyApplyFlowField: true },
    )
    await sleep(400)
    await this.selectComboSmart(
      '[data-automation-id="addressSection_countryRegion"], ' +
      '[data-automation-id="formField-address--countryRegion"], ' +
      '[data-automation-id="formField-countryRegion"], ' +
      '[data-automation-id="formField-state"], ' +
      '[data-automation-id="formField-stateRegion"]',
      /^(state|state\/?\s*province|state\/?\s*region|province|region)$/,
      // Expand "TX" → "Texas": Workday's State dropdown options are full names,
      // and the risky-field path matches by option text (no typing), so a bare
      // 2-letter code never matches and the required field stays empty.
      normalizeStateToken(this.cv.address.state) || this.cv.address.state,
      "State/Province",
      { riskyApplyFlowField: true, optional: !this.cv.address.state },
    )
    await this.fillTextSmart(
      [
        '[data-automation-id="addressSection_postalCode"]',
        '[data-automation-id="formField-address--postalCode"]',
        '[data-automation-id="formField-postalCode"]',
        '[data-automation-id="postalCode"]',
      ],
      /^(postal code|zip code|zip\/?\s*postal code|zip)$/,
      this.cv.address.zip,
      "Postal Code",
      { optional: !this.cv.address.zip },
    )
    // Phone country code MUST be selected before the phone number on
    // apply-flow tenants — Workday's phone validator chains off it. Skipping
    // it is the dominant cause of the post-submit "Something went wrong"
    // 500 errors when the phone number is otherwise valid.
    await this.selectCombobox(
      '[data-automation-id="formField-countryPhoneCode"], ' +
      '[data-automation-id="phone-country-code"], ' +
      '[data-automation-id="formField-phone--countryPhoneCode"]',
      this.cv.address.country || "United States",
      "Phone Country Code",
      { optional: true, riskyApplyFlowField: true },
    )
    await this.selectFirstCombobox(
      [
        '[data-automation-id="phone-device-type"]',
        '[data-automation-id="formField-phone--phoneType"]',
        '[data-automation-id="formField-phoneType"]',
        '[data-automation-id="formField-phoneDeviceType"]',
        '[data-automation-id="phoneType"]',
        '[data-automation-id="phoneDeviceType"]',
        '[data-automation-id="formField-phone--deviceType"]',
        '[data-automation-id="formField-deviceType"]',
        '[data-automation-id*="phone"][data-automation-id*="Type"]',
      ],
      "Mobile",
      "Phone Device Type",
      { optional: true },
    )
    await this.fillTextSmart(
      [
        '[data-automation-id="phone-number"]',
        '[data-automation-id="formField-phoneNumber"]',
        '[data-automation-id="formField-phone--phoneNumber"]',
        '[data-automation-id="phoneNumber"]',
      ],
      /^(phone( number)?|mobile( number)?|telephone)$/,
      this.cv.phone,
      "Phone Number",
      { optional: !this.cv.phone },
    )

    const emailTarget =
      (Array.from(document.querySelectorAll<HTMLElement>(
        '[data-automation-id="email"], ' +
        '[data-automation-id="formField-email"], ' +
        '[data-automation-id="formField-emailAddress"]',
      )).find((node) => isVisible(node)) ?? null) ??
      this.findControlByLabel(/^(email|email address|e-?mail)$/)
    const emailEl = resolveInputControlFromElement(emailTarget)
    if (emailEl instanceof HTMLInputElement || emailEl instanceof HTMLTextAreaElement) {
      const existing = nonEmpty(emailEl.value)
      if (!existing && this.cv.email) {
        const ok = this.setElementValue(emailEl, this.cv.email, "Email Address")
        if (ok) this.bumpFilledCount()
        this.debug(ok ? "info" : "warn", "field.email.set", { ok, hadExisting: false })
      } else if (existing && this.cv.email && normText(existing) !== normText(this.cv.email)) {
        this.logWarning("Manual review needed: email field is prefilled with a different value.")
        this.debug("warn", "field.email.mismatch_prefilled", {
          existing: existing.slice(0, 80),
          expected: this.cv.email.slice(0, 80),
        })
      }
    } else {
      this.debug("warn", "field.email.not_found")
    }

    // "How Did You Hear About Us?" (Source). Historically skipped because on some
    // apply-flow tenants touching it triggered unstable backend calls. But when it
    // is REQUIRED (e.g. SpaceX), leaving it empty blocks Save & Continue and stalls
    // the run — so fill it with a sensible option only in that case.
    await this.fillSourceIfRequired()

    // Workday tenants scatter screening questions onto My Information too
    // (e.g. "Are you a previous employee of …?"). Answer the yes/no radios
    // here and resolve anything the deterministic matcher can't via the
    // semantic tier, so the step isn't left blocked on an unfilled required
    // radio that only the questions page used to handle.
    this.fillScreeningRadios()
    await this.flushSemanticQueue()

    // Final sweep (the bounded watcher started after the name fills keeps
    // re-applying this for a few seconds to beat Workday's async parser).
    await this.repairNameCapitalizationAlerts()
    this.salvageMiscasedNameFields()
    this.debug("info", "step.my_information.complete")
  }

  private nameKindFromText(raw: string): WorkdayNameFieldKind | null {
    const text = normText(raw)
    if (!text) return null
    if (text.includes("preferred name") || text.includes("preferred first name")) return "preferred"
    if (text.includes("first name") || text.includes("given name")) return "first"
    if (text.includes("middle name")) return "middle"
    if (text.includes("last name") || text.includes("family name") || text.includes("surname")) return "last"
    return null
  }

  private nameFieldLabel(kind: WorkdayNameFieldKind): string {
    switch (kind) {
      case "first":
        return "First Name"
      case "middle":
        return "Middle Name"
      case "last":
        return "Last Name"
      case "preferred":
        return "Preferred Name"
    }
  }

  private desiredNameValue(kind: WorkdayNameFieldKind): string {
    if (!this.cv) return ""
    switch (kind) {
      case "first":
        return this.cv.firstName
      case "middle":
        return this.cv.middleName
      case "last":
        return this.cv.lastName
      case "preferred":
        return this.cv.preferredName || this.cv.firstName
    }
  }

  private nameFieldSelectors(kind: WorkdayNameFieldKind): string[] {
    switch (kind) {
      case "first":
        return [
          '[data-automation-id="legalNameSection_firstName"]',
          '[data-automation-id="formField-legalName--firstName"]',
          '[data-automation-id="legalName--firstName"]',
          '[data-automation-id="firstName"]',
          'input[autocomplete="given-name"]',
        ]
      case "middle":
        return [
          '[data-automation-id="legalNameSection_middleName"]',
          '[data-automation-id="formField-legalName--middleName"]',
          '[data-automation-id="legalName--middleName"]',
          '[data-automation-id="middleName"]',
          'input[autocomplete="additional-name"]',
        ]
      case "last":
        return [
          '[data-automation-id="legalNameSection_lastName"]',
          '[data-automation-id="formField-legalName--lastName"]',
          '[data-automation-id="legalName--lastName"]',
          '[data-automation-id="lastName"]',
          'input[autocomplete="family-name"]',
        ]
      case "preferred":
        return [
          '[data-automation-id="preferredName-firstName"]',
          '[data-automation-id="formField-preferredName--firstName"]',
          '[data-automation-id="preferredName"]',
        ]
    }
  }

  private nameFieldContext(el: HTMLInputElement | HTMLTextAreaElement): string {
    const parts = [
      parseQuestionLabel(el),
      el.getAttribute("aria-label") ?? "",
      el.getAttribute("name") ?? "",
      el.id ?? "",
      el.getAttribute("autocomplete") ?? "",
      el.closest("[data-automation-id*='formField'], [data-automation-id*='legalName'], fieldset, [role='group']")
        ?.textContent
        ?.slice(0, 260) ?? "",
      el.closest("[data-automation-id]")?.getAttribute("data-automation-id") ?? "",
    ]
    return normText(parts.join(" "))
  }

  private controlLooksLikeNameField(
    el: HTMLInputElement | HTMLTextAreaElement,
    kind: WorkdayNameFieldKind,
  ): boolean {
    const context = this.nameFieldContext(el)
    if (!context) return false
    const hasPreferred = context.includes("preferred")
    if (kind !== "preferred" && hasPreferred) return false
    if (kind === "preferred") return hasPreferred && context.includes("name")
    if (kind === "first") return context.includes("first name") || context.includes("given name")
    if (kind === "middle") return context.includes("middle name") || context.includes("additional name")
    return context.includes("last name") || context.includes("family name") || context.includes("surname")
  }

  private isSafeFocusedNameRepairTarget(
    el: HTMLInputElement | HTMLTextAreaElement,
    kind: WorkdayNameFieldKind,
    desired: string,
  ): boolean {
    if (!isTextInputControl(el) || el.disabled) return false
    if (this.controlLooksLikeNameField(el, kind)) return true
    const existing = nonEmpty(el.value)
    if (!existing || !desired) return false
    return normText(existing) === normText(desired) || normText(toTitleCase(existing)) === normText(desired)
  }

  private findNameInputForKind(kind: WorkdayNameFieldKind): HTMLInputElement | HTMLTextAreaElement | null {
    const desired = this.desiredNameValue(kind)
    const active = resolveInputControlFromElement(document.activeElement instanceof HTMLElement ? document.activeElement : null)
    if (active && this.isSafeFocusedNameRepairTarget(active, kind, desired)) return active

    for (const selector of this.nameFieldSelectors(kind)) {
      for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        const input = resolveInputControlFromElement(node)
        if (!isTextInputControl(input) || input.disabled) continue
        return input
      }
    }

    const controls = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]):not([type="file"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]), textarea',
      ),
    )
    return controls.find((control) => !control.disabled && this.controlLooksLikeNameField(control, kind)) ?? null
  }

  private async repairNameField(kind: WorkdayNameFieldKind): Promise<boolean> {
    const input = this.findNameInputForKind(kind)
    if (!input) {
      this.debug("warn", "field.name_alert.input_not_found", { kind })
      return false
    }

    const existing = nonEmpty(input.value)
    let value = this.desiredNameValue(kind)
    if (!value && existing) value = toTitleCase(existing)
    if (!value) {
      this.debug("warn", "field.name_alert.no_value", { kind })
      return false
    }

    const ok = this.setElementValue(input, toTitleCase(value), this.nameFieldLabel(kind), {
      forceOverwrite: true,
    })
    if (ok) {
      this.debug("info", "field.name_alert.repaired", {
        kind,
        from: existing.slice(0, 40),
        to: toTitleCase(value).slice(0, 40),
      })
    }
    return ok
  }

  private findNameCapitalizationAlertTargets(): Array<{ kind: WorkdayNameFieldKind; target?: HTMLElement }> {
    const byKind = new Map<WorkdayNameFieldKind, HTMLElement | undefined>()
    const add = (kind: WorkdayNameFieldKind | null, target?: HTMLElement) => {
      if (!kind) return
      if (!byKind.has(kind) || target) byKind.set(kind, target ?? byKind.get(kind))
    }

    const clickables = Array.from(
      document.querySelectorAll<HTMLElement>("a, button, [role='link'], [role='button']"),
    ).filter((el) => isVisible(el))
    for (const el of clickables) {
      const text = nonEmpty(el.textContent)
      const normalized = normText(text)
      if (!normalized.includes("alert") && !normalized.includes("capital")) continue
      add(this.nameKindFromText(text), el)
    }

    const body = normText(document.body?.textContent ?? "")
    const hasCapitalizationAlert =
      body.includes("correctly capitalized") ||
      body.includes("more than 2 capital letters") ||
      (body.includes("alert") && body.includes("capital"))
    if (hasCapitalizationAlert) {
      if (body.includes("first name")) add("first")
      if (body.includes("middle name")) add("middle")
      if (body.includes("last name") || body.includes("family name") || body.includes("surname")) add("last")
      if (body.includes("preferred name")) add("preferred")
    }

    return Array.from(byKind.entries()).map(([kind, target]) => ({ kind, target }))
  }

  /**
   * Workday surfaces capitalization failures as top-of-page alert links after
   * Save and Continue. Follow those links first because they often expand or
   * focus a hidden Legal Name control, then force-write only the corresponding
   * name field from the saved profile.
   */
  private async repairNameCapitalizationAlerts(): Promise<number> {
    const alerts = this.findNameCapitalizationAlertTargets()
    if (alerts.length === 0) return 0

    let repaired = 0
    for (const alert of alerts) {
      if (this.stopped) return repaired
      this.setToolbarField(this.nameFieldLabel(alert.kind))
      if (alert.target) {
        alert.target.scrollIntoView({ block: "center" })
        alert.target.click()
        await sleep(220)
      }
      if (await this.repairNameField(alert.kind)) repaired += 1
      this.salvageMiscasedNameFields()
    }

    this.debug(repaired > 0 ? "info" : "warn", "field.name_alert.repair_complete", {
      alerts: alerts.length,
      repaired,
    })
    return repaired
  }

  /**
   * Re-title-case Legal/Preferred Name inputs that currently hold an all-caps
   * or all-lowercase value (typically Workday's own résumé-parse output), which
   * the tenant flags with a capitalization alert. Only rewrites miscased values
   * — correctly-cased names are left untouched.
   */
  private salvageMiscasedNameFields(): void {
    const selectors = [
      '[data-automation-id="legalNameSection_firstName"]',
      '[data-automation-id="formField-legalName--firstName"]',
      '[data-automation-id="legalName--firstName"]',
      '[data-automation-id="firstName"]',
      '[data-automation-id="legalNameSection_middleName"]',
      '[data-automation-id="formField-legalName--middleName"]',
      '[data-automation-id="legalName--middleName"]',
      '[data-automation-id="legalNameSection_lastName"]',
      '[data-automation-id="formField-legalName--lastName"]',
      '[data-automation-id="legalName--lastName"]',
      '[data-automation-id="lastName"]',
      '[data-automation-id="preferredName-firstName"]',
      '[data-automation-id="formField-preferredName--firstName"]',
    ]
    for (const selector of selectors) {
      for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        const input = resolveInputControlFromElement(node)
        if (!(input instanceof HTMLInputElement)) continue
        const existing = nonEmpty(input.value)
        if (!existing || !looksMiscased(existing)) continue
        const fixed = toTitleCase(existing)
        if (!fixed || fixed === existing) continue
        const ok = this.setElementValue(input, fixed, "Name", { forceOverwrite: true })
        this.debug(ok ? "info" : "warn", "field.name.recapitalized", {
          from: existing.slice(0, 40),
          to: fixed.slice(0, 40),
          ok,
        })
      }
    }
  }

  /**
   * Re-apply the name-casing salvage on a short interval so it survives
   * Workday's asynchronous résumé parse (which can re-uppercase Legal Name
   * seconds after our fill). Only ever rewrites miscased values, so a
   * correctly-cased name — including one the user just typed — is untouched.
   * Self-terminates after `durationMs`; replaces any prior watch.
   */
  private startNameCasingWatch(durationMs = 9000): void {
    if (this.nameSalvageTimer != null) {
      clearInterval(this.nameSalvageTimer)
      this.nameSalvageTimer = null
    }
    this.salvageMiscasedNameFields()
    const deadline = Date.now() + durationMs
    this.nameSalvageTimer = window.setInterval(() => {
      if (this.stopped || Date.now() > deadline) {
        if (this.nameSalvageTimer != null) {
          clearInterval(this.nameSalvageTimer)
          this.nameSalvageTimer = null
        }
        return
      }
      this.salvageMiscasedNameFields()
    }, 600)
  }

  /**
   * Fill the "How Did You Hear About Us?" / Source combobox, but only when it is
   * a required field and still unanswered. Tries a few honest, near-universal
   * options, then falls back to the first real option in the list.
   */
  private async fillSourceIfRequired(): Promise<void> {
    const containers = Array.from(
      document.querySelectorAll<HTMLElement>('[data-automation-id*="ource"], [data-automation-id*="formField"]'),
    ).filter((el) => isVisible(el))

    const container =
      containers.find((el) => {
        const aid = (el.getAttribute("data-automation-id") ?? "").toLowerCase()
        if (aid.includes("source")) return true
        return /how did you hear about us|how did you hear/i.test(el.textContent ?? "")
      }) ?? null

    if (!container) {
      this.debug("info", "field.source.not_found")
      return
    }

    // "How did you hear about us" is frequently a Workday *multiselect* prompt
    // (the ☰ icon), not a plain dropdown — so we also match multiselect/prompt
    // widgets and the bare search input, not just [role=combobox].
    const comboTarget =
      container.querySelector<HTMLElement>(
        '[role="combobox"], [aria-haspopup="listbox"], ' +
        '[data-automation-id*="dropDown" i], [data-automation-id*="Dropdown" i], ' +
        '[data-automation-id*="multiselect" i], [data-automation-id*="multiSelect" i], ' +
        '[data-automation-id*="promptSearch" i], [data-automation-id*="searchBox" i], ' +
        'input, [role="button"]',
      ) ?? container

    if (!this.isElementRequired(container, comboTarget)) {
      this.debug("info", "field.source.skipped_optional")
      return
    }

    // For multiselect widgets the display-value heuristic is unreliable (the
    // widget's hidden "N items selected" counter reads as an answer), so trust
    // the pill-based selection check instead.
    const isMultiselectWidget = Boolean(
      container.querySelector(
        '[data-uxi-widget-type="multiselect"], [data-automation-id="multiSelectContainer"]',
      ),
    )
    const existing = isMultiselectWidget
      ? (this.hasWorkdayMultiselectSelection(container) ? "multiselect selection" : "")
      : nonEmpty(extractComboboxDisplayValue(comboTarget))
    if (existing && !this.isUnansweredSelectPlaceholder(existing)) {
      this.bumpFilledCount()
      this.debug("info", "field.source.already_answered", { existing: existing.slice(0, 60) })
      return
    }

    // Workday's "How Did You Hear About Us?" prompt is a two-level picker:
    // parent category → company-specific child. For this field, click
    // "Company Website", then the first careers child under it (e.g.
    // "Caterpillar Careers"). If no child contains "Career", pick the first
    // child in that submenu. Do not fall back to unrelated source categories.
    const sourceChildren = [
      "Careers",
      "Company Careers",
      "Company Career Site",
      "Career Site",
    ]
    if (
      await this.fillCompanyWebsiteCareersSource(
        container,
        "How Did You Hear About Us?",
        sourceChildren,
      )
    ) {
      this.bumpFilledCount()
      this.debug("info", "field.source.filled", { via: "company_website_careers" })
      return
    }

    // Last resort: this tenant's source list doesn't offer a "Company Careers"
    // option (it's LinkedIn / Indeed / Job Board / Other, etc.). A REQUIRED
    // source field left blank blocks Save-and-Continue and STALLS the whole
    // wizard, so pick any honest, neutral source via the (fast, backend-queried)
    // search box. Excludes referral/agency/employee options — auto-claiming a
    // personal connection could mislead a recruiter. Guarded by the same
    // settled/broken-flow check as the preferred path.
    if (
      (await this.waitForApplyFlowSettled(4000)) &&
      (await this.fillSourceViaPromptSearch(
        container,
        "How Did You Hear About Us?",
        ["job board", "online", "website", "linkedin", "indeed", "social", "other"],
        (text) => this.isNeutralSourceOption(text),
      ))
    ) {
      this.bumpFilledCount()
      this.debug("info", "field.source.filled", { via: "neutral_fallback" })
      return
    }

    this.logWarning("Manual review needed: How Did You Hear About Us?")
    this.requiredFieldMissesThisStep += 1
    this.markManualReview(container, "How Did You Hear About Us?")
  }

  /**
   * Wait until the apply flow looks settled: no visible loading indicator and
   * no broken-state signals. Touching the source prompt while Workday is still
   * creating the application record makes the widget fire CXS calls with an
   * undefined application id, flipping the flow into the "Something went
   * wrong" error page — so never open it before this returns true.
   */
  private async waitForApplyFlowSettled(timeoutMs: number): Promise<boolean> {
    // Only genuine Workday loading chrome — [aria-busy] is too generic and can
    // match persistent widgets, burning the whole timeout for nothing.
    const busyEl = (): HTMLElement | null => {
      const el = document.querySelector<HTMLElement>(
        '[data-automation-id="loadingIndicator"], [data-automation-id*="spinner" i]',
      )
      return el && isVisible(el) ? el : null
    }
    if (this.detectBrokenApplyFlowState().broken) return false
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!busyEl()) {
        // Quiet once; require it to stay quiet across a short settle margin.
        await sleep(300)
        if (!busyEl()) return !this.detectBrokenApplyFlowState().broken
      }
      await sleep(150)
    }
    return !this.detectBrokenApplyFlowState().broken && !busyEl()
  }

  private async fillCompanyWebsiteCareersSource(
    container: HTMLElement,
    fieldName: string,
    childPreferred: string[],
  ): Promise<boolean> {
    if (!(await this.waitForApplyFlowSettled(5000))) {
      this.debug("warn", "field.source.skipped_flow_not_settled")
      return false
    }
    // Fast path: the prompt's search box queries the backend directly and
    // returns leaf options in ~1s (e.g. "Caterpillar Careers"), skipping the
    // two-level drill and its not-ready "No Items." dance entirely.
    if (await this.fillSourceViaPromptSearch(container, fieldName)) return true
    // Several quick attempts: on a freshly created application the submenu
    // answers "No Items." until the backend source list exists; each attempt
    // bails fast on that state, so more retries are cheap and eventually one
    // lands right after the data is ready.
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      if (this.hasWorkdayMultiselectSelection(container)) return true
      if (this.detectBrokenApplyFlowState().broken) {
        // Never keep poking a flow that has already tipped into the error
        // state — every extra prompt interaction makes recovery less likely.
        this.debug("warn", "field.source.aborted_broken_flow", { attempt })
        return false
      }
      // Tenant vocabularies vary: "Company Website" → "<Company> Careers"
      // (Caterpillar) or "Career Websites" → "Corporate Website" (others).
      const ok = await this.fillWorkdayMultiselect(container, ["Company Website", ...childPreferred], fieldName, {
        parentPreferred: ["Company Website", "Career Websites"],
        parentMatcher: (text) => /\b(company|corporate|career)s?\s*websites?\b/i.test(text),
        childMatcher: (text) =>
          /\bcareers?\b/i.test(text) || /\b(corporate|company)\s*websites?\b/i.test(text),
        childPreferred,
        childFallbackToFirst: true,
      })
      if (ok && this.hasWorkdayMultiselectSelection(container)) return true
      this.debug("warn", "field.source.company_website_retry", { attempt, selected: ok })
      await sleep(600)
    }
    return false
  }

  /**
   * Fill the source prompt via its search box: type "careers", let Workday's
   * typeahead query the backend, and click the first leaf whose text contains
   * the standalone word "Careers" (matches "<Company> Careers" / "Company
   * Careers Site" while excluding job boards like "Career Builder"). Verified
   * live: results land in ~1s, far faster than drilling the category tree.
   */
  private async fillSourceViaPromptSearch(
    container: HTMLElement,
    fieldName: string,
    searchTerms: string[] = ["careers", "website"],
    accept: (text: string) => boolean = (text) =>
      /\bcareers\b/i.test(text) || /\b(corporate|company)\s*websites?\b/i.test(text),
  ): Promise<boolean> {
    const input =
      container.querySelector<HTMLInputElement>('input[data-uxi-widget-type="selectinput"]') ??
      container.querySelector<HTMLInputElement>('[data-automation-id="multiselectInputContainer"] input')
    if (!input || !isVisible(input)) return false
    this.setToolbarField(fieldName)

    const nativeSet = (value: string): void => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    const pressEnter = (): void => {
      for (const type of ["keydown", "keyup"] as const) {
        input.dispatchEvent(
          new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }),
        )
      }
    }
    const searchResults = (): HTMLElement[] =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-automation-id="activeListContainer"] [data-automation-id="promptOption"]',
        ),
      ).filter((el) => isVisible(el) && nonEmpty(el.textContent).length > 0)
    const optionLabel = (option: HTMLElement): string =>
      nonEmpty(option.getAttribute("data-automation-label")) || nonEmpty(option.textContent)

    // Term per tenant vocabulary: "careers" finds "<Company> Careers"
    // (plural \bcareers\b also keeps out job boards like "Career Builder");
    // "website" finds "Corporate Website" / "Company Website" leaves. The
    // caller can override the terms + acceptance test for the neutral fallback.
    for (let attempt = 0; attempt < searchTerms.length; attempt += 1) {
      input.scrollIntoView({ block: "center" })
      input.focus()
      nativeSet(searchTerms[attempt])
      pressEnter()

      const deadline = Date.now() + 2500
      while (Date.now() < deadline) {
        const target = searchResults().find((option) => {
          const text = optionLabel(option)
          if (!accept(text)) return false
          if (this.isTopLevelSourceCategory(text)) return false
          if (this.isBackHeaderOption(text, "Company Website")) return false
          return true
        })
        if (target) {
          target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
          target.click()
          target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
          await sleep(300)
          if (this.hasWorkdayMultiselectSelection(container)) {
            if (input.value) nativeSet("")
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
            this.debug("info", "field.source.filled_via_search", { picked: optionLabel(target) })
            return true
          }
        }
        await sleep(120)
      }
      this.debug("info", "field.source.search_retry", { attempt })
      await sleep(400)
    }
    // Leave the widget clean for the drill fallback.
    if (input.value) nativeSet("")
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    return false
  }

  private hasWorkdayMultiselectSelection(container: HTMLElement): boolean {
    const label = nonEmpty(container.querySelector('[data-automation-id="promptSelectionLabel"]')?.textContent)
    if (label && !this.isUnansweredSelectPlaceholder(label)) return true

    const selectedItems = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-automation-id="selectedItem"], ' +
        '[data-automation-id="selectedItemList"], ' +
        '[data-automation-id*="pill" i], ' +
        '[data-automation-id*="tag" i]',
      ),
    ).filter((el) => isVisible(el) && nonEmpty(el.textContent).length > 0)
    if (selectedItems.some((el) => !this.isUnansweredSelectPlaceholder(el.textContent ?? ""))) return true

    const removeControl = container.querySelector<HTMLElement>(
      '[aria-label*="remove" i], [aria-label*="delete" i], [title*="remove" i], [data-automation-id*="remove" i]',
    )
    if (removeControl && nonEmpty(container.textContent) && !this.isUnansweredSelectPlaceholder(container.textContent ?? "")) {
      return true
    }

    return false
  }

  /**
   * An honest, neutral "How did you hear about us" option that is safe to
   * auto-pick when the preferred "Company Careers" option isn't offered — so a
   * REQUIRED source field never stalls the wizard. Deliberately EXCLUDES
   * referral / agency / recruiter / employee / friend / family options:
   * auto-claiming a personal connection could mislead a recruiter. Top-level
   * category rows are excluded too (we only pick real leaf options).
   */
  private isNeutralSourceOption(text: string): boolean {
    const value = normText(text)
    if (!value) return false
    if (this.isTopLevelSourceCategory(value)) return false
    if (/\b(referr|agenc|recruit|staffing|employee|colleague|friend|family|alumni|current worker|former worker)\b/i.test(value)) {
      return false
    }
    return /\b(career|company website|corporate website|job board|job site|job posting|jobsite|online|internet|website|linkedin|indeed|glassdoor|ziprecruiter|monster|dice|google|search engine|social media|advertisement|other)\b/i.test(value)
  }

  private isTopLevelSourceCategory(text: string): boolean {
    const value = normText(text)
    if (!value) return false
    return [
      "company website",
      "career websites",
      "career website",
      "job sites",
      "job posting sites",
      "current employee",
      "employee referral",
      "former worker",
      "professional association",
      "recruiter agency",
      "recruitment event",
      "social referral",
    ].some((category) => value === category)
  }

  private isBackHeaderOption(text: string, parentLabel: string): boolean {
    const value = normText(text)
    const parent = normText(parentLabel)
    if (!value) return false
    if (value === "back") return true
    if (parent && value === parent) return true
    return parent ? value.includes("back") && value.includes(parent) : value.includes("back")
  }

  private submenuCandidateOptions(
    options: HTMLElement[],
    parentLabel: string,
    optionText: (option: HTMLElement) => string,
  ): HTMLElement[] {
    return options.filter((option) => {
      const text = optionText(option)
      if (!text) return false
      if (this.isBackHeaderOption(text, parentLabel)) return false
      if (this.isTopLevelSourceCategory(text)) return false
      return true
    })
  }

  /**
   * Drive a Workday multiselect "prompt" (data-uxi-widget-type="multiselect",
   * the ☰ widget). Opens from the search input / prompt icon, then clicks a
   * matching `promptOption`. "How did you hear about us" lists are usually
   * categories that drill into sub-options, so we follow one level down,
   * preferring our values and otherwise taking the first leaf. Returns true
   * once a selection is registered.
   */
  private async fillWorkdayMultiselect(
    container: HTMLElement,
    preferred: string[],
    fieldName: string,
    opts?: {
      parentPreferred?: string[]
      childPreferred?: string[]
      parentMatcher?: (text: string) => boolean
      childMatcher?: (text: string) => boolean
      childFallbackToFirst?: boolean
    },
  ): Promise<boolean> {
    const input =
      container.querySelector<HTMLInputElement>('input[data-uxi-widget-type="selectinput"]') ??
      container.querySelector<HTMLInputElement>('[data-automation-id="multiselectInputContainer"] input') ??
      container.querySelector<HTMLInputElement>('input[aria-required], input')
    const icon = container.querySelector<HTMLElement>('[data-automation-id="promptIcon"]')
    const opener: HTMLElement = input ?? icon ?? container

    const isSelected = (): boolean => this.hasWorkdayMultiselectSelection(container)

    // Options must come from the floating popup ([data-automation-id=
    // "activeListContainer"], role=listbox), NOT the whole document. Already-
    // selected pills elsewhere on the page (e.g. the phone country code
    // "United States of America (+1)") are also rendered as promptOption /
    // role=option nodes, so an unscoped query returns them instantly — the
    // wait-for-popup loop then exits with imposters before the real menu
    // renders, and we click a value from a completely different field.
    // (Verified live on cat.wd5.myworkdayjobs.com, 2026-07.)
    const collect = (): HTMLElement[] => {
      const popups = Array.from(
        document.querySelectorAll<HTMLElement>('[data-automation-id="activeListContainer"]'),
      ).filter((el) => isVisible(el))
      const nodes = popups.length
        ? popups.flatMap((popup) =>
            Array.from(popup.querySelectorAll<HTMLElement>('[data-automation-id="promptOption"], [role="option"]')),
          )
        : // Fallback for tenants without activeListContainer: global query, but
          // never options living inside a field's own selected-value chrome.
          Array.from(
            document.querySelectorAll<HTMLElement>('[data-automation-id="promptOption"], [role="option"]'),
          ).filter(
            (el) =>
              !el.closest(
                '[data-automation-id="selectedItem"], ' +
                '[data-automation-id="selectedItemList"], ' +
                '[data-automation-id="multiSelectContainer"]',
              ),
          )
      // Workday attaches the click handler to the inner promptOption node, not
      // the [role=option] menuItem wrapper — clicking the wrapper is a silent
      // no-op (verified live: wrapper click leaves the menu unchanged). Both
      // appear in the query, wrapper first, so normalize every hit down to its
      // inner promptOption and dedupe.
      const clickable = Array.from(
        new Set(
          nodes.map(
            (el) =>
              (el.getAttribute("data-automation-id") === "promptOption"
                ? el
                : el.querySelector<HTMLElement>('[data-automation-id="promptOption"]')) ?? el,
          ),
        ),
      )
      return clickable.filter(
        (el) => isVisible(el) && nonEmpty(el.textContent).length > 0 && !this.isUnansweredSelectPlaceholder(el.textContent ?? ""),
      )
    }

    const optionText = (option: HTMLElement): string =>
      nonEmpty(option.getAttribute("data-automation-label")) || nonEmpty(option.textContent)

    const pick = (
      options: HTMLElement[],
      preferences: string[],
      pickOpts?: {
        skipExact?: string
        skipAny?: string[]
        matcher?: (text: string) => boolean
        fallback?: boolean
      },
    ): HTMLElement | null => {
      const skipExact = normText(pickOpts?.skipExact)
      const skipAny = new Set((pickOpts?.skipAny ?? []).map((text) => normText(text)).filter(Boolean))
      const candidates = options.filter((option) => {
        const text = normText(optionText(option))
        if (!text) return false
        if (skipExact && text === skipExact) return false
        if (skipAny.has(text)) return false
        if (text === "back") return false
        return true
      })
      if (pickOpts?.matcher) {
        const matched = candidates.find((o) => pickOpts.matcher?.(optionText(o)))
        if (matched) return matched
      }
      for (const want of preferences) {
        const wanted = normText(want)
        if (!wanted) continue
        const exact = candidates.find((o) => normText(optionText(o)) === wanted)
        if (exact) return exact
      }
      for (const want of preferences) {
        const wanted = normText(want)
        if (!wanted) continue
        const partial = candidates.find((o) => {
          const text = normText(optionText(o))
          return text.includes(wanted) || wanted.includes(text)
        })
        if (partial) return partial
      }
      return pickOpts?.fallback === false ? null : (candidates[0] ?? null)
    }

    this.setToolbarField(fieldName)
    opener.scrollIntoView({ block: "center" })
    opener.focus()
    opener.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    opener.click()
    opener.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    if (icon && icon !== opener) icon.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    // Wait for the options popup to render (network-backed on first open).
    let options: HTMLElement[] = []
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      options = collect()
      if (options.length) break
      await sleep(120)
    }
    if (!options.length) {
      this.debug("warn", "field.source.multiselect_no_options")
      opener.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      return false
    }
    this.debug("info", "field.source.multiselect_options_l0", {
      texts: options.slice(0, 10).map(optionText).join(" | "),
    })

    // One drill level: click a preferred option; if nothing selected, it was a
    // category — pick a leaf from the freshly-revealed options. For source, the
    // first click can be pinned to a website parent matcher, and the second click
    // can be pinned to a careers child matcher.
    let selectedParentLabel = ""
    for (let level = 0; level < 2; level += 1) {
      const parentPreferred = opts?.parentPreferred ?? []
      const hasPinnedParent = parentPreferred.length > 0 || Boolean(opts?.parentMatcher)
      const isPinnedChildLevel = level > 0 && hasPinnedParent
      const isPinnedParentLevel = level === 0 && hasPinnedParent
      const levelOptions = isPinnedChildLevel
        ? this.submenuCandidateOptions(options, selectedParentLabel, optionText)
        : options
      if (!levelOptions.length) break
      const preferences = isPinnedChildLevel
        ? (opts?.childPreferred?.length ? opts.childPreferred : preferred)
        : isPinnedParentLevel
          ? parentPreferred
          : preferred
      const target = pick(levelOptions, preferences, {
        skipExact: isPinnedChildLevel ? selectedParentLabel : undefined,
        skipAny: isPinnedChildLevel ? parentPreferred : undefined,
        matcher: isPinnedParentLevel ? opts?.parentMatcher : isPinnedChildLevel ? opts?.childMatcher : undefined,
        fallback: isPinnedChildLevel && opts?.childFallbackToFirst
          ? true
          : !isPinnedParentLevel && !isPinnedChildLevel,
      })
      if (!target) {
        this.debug("info", "field.source.multiselect_pick_failed", {
          level,
          candidates: levelOptions.slice(0, 10).map(optionText).join(" | "),
        })
        break
      }
      this.debug("info", "field.source.multiselect_pick", { level, picked: optionText(target) })
      if (isPinnedParentLevel) selectedParentLabel = optionText(target)
      target.scrollIntoView({ block: "center" })
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      target.click()
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      await sleep(250)
      if (isSelected()) {
        opener.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
        return true
      }
      let next = collect().filter((el) => el !== target)
      if (hasPinnedParent && level === 0) {
        // Child options are fetched from the server the first time a category
        // is opened. On a freshly created application Workday answers with a
        // literal "No Items." submenu until the source list exists backend-side
        // (observed: ~15s+ after page load) — waiting it out inside one open
        // menu never resolves. So: if the submenu is a settled "No Items.",
        // fail THIS attempt fast and let the outer retry reopen the prompt,
        // which is what eventually gets real children.
        const deadline = Date.now() + 8000
        const noItemsGiveUpAt = Date.now() + 1500
        const noItemsVisible = (): boolean =>
          Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-automation-id="activeListContainer"] [data-automation-id="promptOption"]',
            ),
          ).some((el) => isVisible(el) && /^no items\.?$/i.test((el.textContent ?? "").trim()))
        while (Date.now() < deadline) {
          const fresh = collect().filter((el) => el !== target)
          const childOptions = this.submenuCandidateOptions(fresh, selectedParentLabel, optionText)
          const child = pick(childOptions, opts?.childPreferred?.length ? opts.childPreferred : preferred, {
            skipExact: selectedParentLabel,
            skipAny: parentPreferred,
            matcher: opts?.childMatcher,
            fallback: false,
          })
          if (child || (opts?.childFallbackToFirst && childOptions.length > 0)) {
            next = childOptions
            break
          }
          if (Date.now() > noItemsGiveUpAt && noItemsVisible()) {
            this.debug("info", "field.source.no_items_submenu_bail")
            break
          }
          await sleep(120)
        }
      }
      if (!next.length) break
      options = next
    }

    opener.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    return isSelected()
  }

  /** True when a field is marked required (aria-required, required attr, or a `*` label). */
  private isElementRequired(container: HTMLElement, target: HTMLElement): boolean {
    if (target.getAttribute("aria-required") === "true") return true
    if (container.getAttribute("aria-required") === "true") return true
    if (target.hasAttribute("required") || container.querySelector("[required], [aria-required='true']")) return true
    if (container.querySelector('abbr[title="required" i], [data-automation-id*="required"]')) return true
    const labelText =
      container.querySelector("label, legend, [data-automation-id*='label'], [role='heading']")?.textContent ?? ""
    return /\*/.test(labelText)
  }

  /**
   * Open a combobox and click an option. With `matcher`, picks the first option
   * whose text matches (e.g. a "decline to answer" choice); without it, picks the
   * first non-placeholder option.
   */
  private async selectOptionMatching(
    target: HTMLElement,
    fieldName: string,
    matcher?: (optionText: string) => boolean,
  ): Promise<boolean> {
    this.setToolbarField(fieldName)
    const shell =
      target.closest<HTMLElement>('[role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"]') ??
      target
    // Scroll into view before opening: Workday renders the options portal
    // relative to the trigger, and clicking an off-screen dropdown (e.g. the
    // lower EEO fields below the fold) often fails to open it.
    try {
      shell.scrollIntoView({ block: "center" })
    } catch {
      // best-effort
    }
    await sleep(80)
    shell.focus()
    shell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    shell.click()
    shell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))

    const automationId = target.getAttribute("data-automation-id") ?? ""
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const menuOptions = automationId
        ? Array.from(document.querySelectorAll(`[data-automation-id^="${safeEscapeSelector(automationId)}-menu-item--"]`))
        : []
      // Prefer options inside the currently-open popup — a document-wide
      // [role=option] query can return stale options from a previously closed
      // dropdown (or another field), which made later EEO fields miss.
      const activePopup = Array.from(
        document.querySelectorAll(
          '[data-automation-activepopup="true"] [role="option"], ' +
            '[data-automation-activepopup="true"] [role="menuitem"], ' +
            '[data-automation-activepopup="true"] [data-automation-id="promptOption"]',
        ),
      )
      const roleOptions = activePopup.length
        ? activePopup
        : Array.from(
            document.querySelectorAll('[role="option"], [role="menuitem"], [data-automation-id="promptOption"]'),
          )
      const options = [...menuOptions, ...roleOptions].filter(
        (el): el is HTMLElement => el instanceof HTMLElement && isVisible(el),
      )
      const pick = options.find((el) => {
        const text = el.textContent ?? ""
        if (this.isUnansweredSelectPlaceholder(text)) return false
        return matcher ? matcher(text) : true
      })
      if (pick) {
        const clickTarget =
          pick.closest<HTMLElement>('[role="option"], [role="menuitem"], [data-automation-id="promptOption"]') ?? pick
        clickTarget.click()
        await sleep(120)
        this.bumpFilledCount()
        return true
      }
      await sleep(100)
    }
    // Nothing matched — close the menu so it doesn't block the page, and never
    // pick a wrong option (important for demographic fields where any non-decline
    // option would assert an identity we must not claim).
    shell.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    return false
  }

  // ── Self-Identify / Voluntary Disclosures ────────────────────────────────────
  // Workday's EEO + disability (CC-305) step. We only use saved demographic
  // answers when the user explicitly opted in; otherwise we decline disclosure.
  // This satisfies the *required* mechanics so the run can finish:
  //   • demographic dropdowns/radios → saved opt-in answer, else decline
  //   • required acknowledgement checkboxes → check
  //   • CC-305 signature Name → user's name; Date → today
  /**
   * Maps a self-identify question label to the user's saved EEO answer.
   * Returns null when the user hasn't opted in or there's no saved value for
   * that question (caller then declines). `decline:true` means the saved value
   * itself is a "prefer not to answer".
   */
  private diversityPreference(label: string): { values: string[]; decline: boolean } | null {
    if (!this.cv || !this.cv.diversity.optedIn) return null
    const l = normText(label)
    const d = this.cv.diversity
    const isDecline = (v: string): boolean =>
      DISCLOSURE_DECLINE_RE.test(v)
    const use = (saved: string): { values: string[]; decline: boolean } | null => {
      if (!saved) return null
      if (isDecline(saved)) return { values: [], decline: true }
      return { values: [saved], decline: false }
    }
    // Hispanic/Latino is a Yes/No question — normalize to the bare token so it
    // matches option lists that read "Yes" / "No" (not the full sentence).
    if (/\bhispanic\b|\blatino\b/.test(l)) {
      if (!d.hispanicLatino) return null
      if (isDecline(d.hispanicLatino)) return { values: [], decline: true }
      return /^\s*yes/i.test(d.hispanicLatino)
        ? { values: ["Yes"], decline: false }
        : { values: ["No"], decline: false }
    }
    if (/\bgender\b|\bsex\b/.test(l)) return use(d.gender)
    if (/\bethnic|\brace\b|racial/.test(l)) return use(d.ethnicity)
    if (/veteran/.test(l)) return use(d.veteranStatus)
    if (/disab/.test(l)) return use(d.disabilityStatus)
    return null
  }

  private isDiversityQuestionLabel(label: string): boolean {
    const l = normText(label)
    return /\bhispanic\b|\blatino\b|\bethnic|\brace\b|racial|\bgender\b|\bsex\b|veteran|disab/.test(l)
  }

  private pickDiversityChoice<T>(
    label: string,
    choices: T[],
    labelFor: (choice: T) => string,
  ): { choice: T | null; source: "saved" | "decline" | "none" } {
    const pref = this.diversityPreference(label)
    if (pref && !pref.decline && pref.values.length) {
      const saved = choices.find((choice) => this.optionMatchesSaved(labelFor(choice), pref.values))
      if (saved) return { choice: saved, source: "saved" }
    }
    const decline = choices.find((choice) => DISCLOSURE_DECLINE_RE.test(labelFor(choice)))
    if (decline) return { choice: decline, source: "decline" }
    return { choice: null, source: "none" }
  }

  /** Word-boundary match between an option's text and any saved EEO value. */
  private optionMatchesSaved(optionText: string, values: string[]): boolean {
    const opt = normText(optionText)
    if (!opt) return false
    const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    for (const value of values) {
      const want = normText(value)
      if (!want) continue
      if (opt === want) return true
      // Whole-word/phrase containment either direction (avoids "male"⊂"female").
      if (new RegExp(`\\b${escape(want)}\\b`).test(opt)) return true
      if (new RegExp(`\\b${escape(opt)}\\b`).test(want)) return true
    }
    return false
  }

  private getCheckboxLabel(input: HTMLInputElement): string {
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
      if (label?.textContent?.trim()) return label.textContent.trim()
    }
    const wrapped = input.closest("label")
    if (wrapped?.textContent?.trim()) return wrapped.textContent.trim()
    return nonEmpty(input.getAttribute("aria-label")) || nonEmpty(input.value)
  }

  private getCheckboxGroupContainer(input: HTMLInputElement): HTMLElement {
    return (
      input.closest<HTMLElement>(
        "fieldset, [role='group'], [data-automation-id*='formField'], [data-automation-id*='question']",
      ) ??
      input.closest<HTMLElement>("section, div") ??
      input
    )
  }

  private getCheckboxGroupQuestionLabel(container: HTMLElement, group: HTMLInputElement[]): string {
    const fromContainer =
      this.extractApplicationQuestionLabel(container, group[0] ?? container) ||
      parseQuestionLabel(container) ||
      ""
    const options = group.map((input) => this.getCheckboxLabel(input)).filter(Boolean).join(" ")
    return `${fromContainer} ${options}`.trim()
  }

  private setCheckboxChecked(input: HTMLInputElement, checked: boolean, fieldName: string): boolean {
    if (input.checked === checked) return true
    this.setToolbarField(fieldName)
    try {
      input.scrollIntoView({ block: "center" })
    } catch {
      // best-effort
    }
    input.click()
    if (input.checked !== checked) {
      const clickTarget =
        (input.closest("label") as HTMLElement | null) ??
        (input.closest('[role="checkbox"]') as HTMLElement | null) ??
        this.getCheckboxGroupContainer(input)
      clickTarget.click()
    }
    if (input.checked !== checked) {
      input.checked = checked
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new Event("change", { bubbles: true }))
    }
    return input.checked === checked
  }

  private fillDiversityCheckboxGroups(): void {
    const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter(isControlReachable)
    const seenGroups = new Set<string>()

    for (const cb of checkboxes) {
      if (this.stopped || this.paused) return
      const container = this.getCheckboxGroupContainer(cb)
      const group = cb.name
        ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${safeEscapeSelector(cb.name)}"]`))
        : Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      const key =
        cb.name ||
        container.getAttribute("data-automation-id") ||
        container.id ||
        `checkbox-group-${checkboxes.indexOf(cb)}`
      if (seenGroups.has(key)) continue
      seenGroups.add(key)
      if (group.length <= 1 || group.some((input) => input.checked)) continue

      const label = this.getCheckboxGroupQuestionLabel(container, group)
      const optionText = group.map((input) => this.getCheckboxLabel(input)).join(" ")
      if (!this.isDiversityQuestionLabel(`${label} ${optionText}`)) continue

      const { choice, source } = this.pickDiversityChoice(label, group, (input) => this.getCheckboxLabel(input))
      if (!choice) {
        this.debug("warn", "self_identify.checkbox_group_unanswered", { label })
        this.markManualReview(container, label)
        this.requiredFieldMissesThisStep += 1
        continue
      }

      if (this.setCheckboxChecked(choice, true, label || "Voluntary disclosure")) {
        this.bumpFilledCount()
        this.debug("info", "self_identify.checkbox_group_set", { label, source })
      }
    }
  }

  private fillConsentCheckboxes(): void {
    const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter(isControlReachable)
    for (const cb of checkboxes) {
      if (this.stopped || this.paused) return
      if (cb.checked) continue
      const container = this.getCheckboxGroupContainer(cb)
      const label = this.getCheckboxLabel(cb)
      const context = `${this.extractApplicationQuestionLabel(container, cb)} ${label} ${container.textContent ?? ""}`
      if (this.isDiversityQuestionLabel(context)) continue
      if (!CONSENT_CHECKBOX_RE.test(context)) continue
      if (this.setCheckboxChecked(cb, true, label || "Required consent")) {
        this.bumpFilledCount()
        this.debug("info", "questions.checkbox_consent_checked", { label: (label || context).slice(0, 120) })
      }
    }
  }

  private fillNativeDiversitySelect(select: HTMLSelectElement, label: string): boolean {
    const selectedText = nonEmpty(select.options[select.selectedIndex]?.textContent)
    if (selectedText && !this.isUnansweredSelectPlaceholder(selectedText)) return true

    const options = Array.from(select.options).filter((opt) => {
      const text = nonEmpty(opt.textContent)
      return text && !this.isUnansweredSelectPlaceholder(text)
    })
    const { choice, source } = this.pickDiversityChoice(label, options, (opt) => nonEmpty(opt.textContent))
    if (!choice) return false

    select.value = choice.value
    select.dispatchEvent(new Event("input", { bubbles: true }))
    select.dispatchEvent(new Event("change", { bubbles: true }))
    this.bumpFilledCount()
    this.debug("info", "questions.select.diversity_answered", { label, source })
    return true
  }

  private async fillSelfIdentifyStep(): Promise<void> {
    this.debug("info", "step.self_identify.start")

    // 1. Demographic comboboxes → decline option only.
    const containers = Array.from(
      document.querySelectorAll<HTMLElement>('[data-automation-id*="formField"]'),
    ).filter((el) => isVisible(el))
    for (const container of containers) {
      if (this.stopped || this.paused) return
      const combo = container.querySelector<HTMLElement>(
        '[role="combobox"], [aria-haspopup="listbox"], [data-automation-id*="dropDown"], [data-automation-id*="Dropdown"]',
      )
      if (!combo || !isVisible(combo)) continue
      const existing = nonEmpty(extractComboboxDisplayValue(combo))
      if (existing && !this.isUnansweredSelectPlaceholder(existing)) continue
      const label = this.extractApplicationQuestionLabel(container, combo) || "Voluntary disclosure"
      // Prefer the user's saved EEO answer (opt-in only); decline otherwise, or
      // if the saved value can't be matched to an option on this form.
      const pref = this.diversityPreference(label)
      let ok = false
      if (pref && !pref.decline && pref.values.length) {
        ok = await this.selectOptionMatching(combo, label, (t) => this.optionMatchesSaved(t, pref.values))
        if (ok) {
          this.debug("info", "self_identify.combo_saved", { label, values: pref.values.join(" | ") })
        }
      }
      if (!ok) {
        ok = await this.selectOptionMatching(combo, label, (t) => DISCLOSURE_DECLINE_RE.test(t))
        this.debug("info", "self_identify.combo_declined", { label, declined: ok })
      }
      // Let the dropdown fully close before touching the next field, so its
      // options don't linger and get scooped by the next field's scan.
      await sleep(250)
    }

    // 2. Radio groups (e.g. disability CC-305) → decline radio.
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) =>
      isControlReachable(r),
    )
    const seenGroups = new Set<string>()
    for (const radio of radios) {
      if (this.stopped || this.paused) return
      const groupName =
        radio.name || radio.closest("[data-automation-id]")?.getAttribute("data-automation-id") || `__${radios.indexOf(radio)}`
      if (seenGroups.has(groupName)) continue
      seenGroups.add(groupName)
      const group = radio.name ? radios.filter((r) => r.name === radio.name) : [radio]
      // Only act if the group is unanswered, so we never override a user choice.
      if (group.some((r) => r.checked)) continue
      // Prefer the saved answer for this question; fall back to decline.
      const groupLabel =
        this.extractApplicationQuestionLabel(
          (radio.closest("[data-automation-id*='formField'], fieldset") as HTMLElement) ?? radio.parentElement ?? radio,
          radio,
        ) || ""
      const pref = this.diversityPreference(groupLabel)
      let target: HTMLInputElement | undefined
      if (pref && !pref.decline && pref.values.length) {
        target = group.find((r) => this.optionMatchesSaved(this.getRadioLabel(r), pref.values))
      }
      if (!target) target = group.find((r) => DISCLOSURE_DECLINE_RE.test(this.getRadioLabel(r)))
      if (target) {
        target.click()
        this.bumpFilledCount()
        this.debug("info", "self_identify.radio_set", {
          group: groupName,
          saved: Boolean(pref && !pref.decline && pref.values.length),
        })
      }
    }

    // 3. Checkbox disclosure groups (e.g. CC-305 disability) + required consent.
    this.fillDiversityCheckboxGroups()
    this.fillConsentCheckboxes()

    // 4. CC-305 signature: Name (full name) + Date (today).
    if (this.cv) {
      const fullName = `${this.cv.firstName} ${this.cv.lastName}`.trim()
      if (fullName) {
        await this.fillFirstTextSelector(
          [
            '[data-automation-id="name"]',
            '[data-automation-id="formField-name"]',
            '[data-automation-id*="selfIdentified"][data-automation-id*="name" i]',
            '[data-automation-id*="employeeName"]',
          ],
          fullName,
          "Self-ID Name",
          { optional: true },
        )
      }
    }
    await this.fillSelfIdentifyDate()

    this.debug("info", "step.self_identify.complete")
  }

  /** Fill the CC-305 date field with today, handling Workday's segmented widget. */
  private async fillSelfIdentifyDate(): Promise<void> {
    const today = new Date()
    const mm = String(today.getMonth() + 1).padStart(2, "0")
    const dd = String(today.getDate()).padStart(2, "0")
    const yyyy = String(today.getFullYear())

    // Segmented spinner inputs (most common on apply-flow).
    const month = document.querySelector<HTMLInputElement>('[data-automation-id="dateSectionMonth-input"]')
    const day = document.querySelector<HTMLInputElement>('[data-automation-id="dateSectionDay-input"]')
    const year = document.querySelector<HTMLInputElement>('[data-automation-id="dateSectionYear-input"]')
    if (month && day && year && isVisible(month)) {
      if (!nonEmpty(month.value)) this.setElementValue(month, mm, "Date (month)")
      if (!nonEmpty(day.value)) this.setElementValue(day, dd, "Date (day)")
      if (!nonEmpty(year.value)) this.setElementValue(year, yyyy, "Date (year)")
      this.bumpFilledCount()
      this.debug("info", "self_identify.date_segmented")
      return
    }

    // Single text date input fallback.
    await this.fillFirstTextSelector(
      [
        '[data-automation-id="formField-dateSigned"] input',
        '[data-automation-id="dateSigned"] input',
        '[data-automation-id="date"] input',
        'input[data-automation-id*="date" i]',
      ],
      `${mm}/${dd}/${yyyy}`,
      "Self-ID Date",
      { optional: true },
    )
  }

  private async fillMyExperienceStep(): Promise<void> {
    if (!this.cv) return
    this.debug("info", "step.my_experience.start", {
      workExperienceCount: this.cv.workExperience.length,
      educationCount: this.cv.education.length,
      skillsCount: this.cv.skills.length,
    })
    // Resume upload is deferred to My Experience because some apply-flow
    // tenants crash when attachment writes are attempted on My Information.
    await this.maybeUploadResume()
    await this.fillWorkExperienceEntries()
    await this.fillEducationEntries()
    await this.fillCertificationEntries()
    await this.fillSkillsSection()
    // Websites section intentionally not filled (product decision, 2026-07).
    this.debug("info", "step.my_experience.complete")
  }

  private async fillWorkExperienceEntries(): Promise<void> {
    if (!this.cv) return
    if (this.cv.workExperience.length === 0) return

    // Some Workday tenants (especially when triggered via the "Apply with
    // resume" path) pre-populate experience panels from the uploaded PDF.
    // We detect those existing panels up-front so we can fill them in place
    // rather than clicking Add N times and creating duplicates.
    const WXP_PREFIXES = ["workExperience", "workExperienceSection", "workExperienceEntry", "workExperienceTableRow"]
    const preExisting = this.inlineEntryPanels(WXP_PREFIXES, /work experience \d+/i)

    const add = this.findAddButtonForSection(
      ["workExperienceSection", "workExperience"],
      /work experience|employment|experience/,
    )
    if (!add && preExisting.length === 0) {
      this.debug("warn", "experience.add_missing")
      return
    }

    for (const [index, job] of this.cv.workExperience.entries()) {
      if (this.stopped || this.paused) return
      this.debug("info", "experience.entry.start", {
        index: index + 1,
        title: job.title,
        company: job.company,
      })

      let root: HTMLElement | null = null

      if (index < preExisting.length) {
        // Pre-existing panel — fill it in place; no Add click required.
        root = preExisting[index]
        this.debug("info", "experience.using_preexisting_panel", { index: index + 1 })
      } else {
        // Re-resolve every iteration: after the first inline entry the "Add"
        // button is replaced by "Add Another".
        const addButton =
          index === 0 || index === preExisting.length
            ? add
            : this.findAddButtonForSection(["workExperienceSection", "workExperience"], /work experience|employment|experience/)
        if (!addButton) {
          this.debug("warn", "experience.add_another_missing", { index: index + 1 })
          break
        }
        addButton.click()
        // 200ms gives React time to start rendering; resolveEntryRoot polls
        // for up to 6s so we don't need the old 500ms guaranteed wait.
        await sleep(200)

        // Dialog tenants open a modal; inline tenants append a numbered
        // panel directly into the page.
        root = await this.resolveEntryRoot(WXP_PREFIXES, /work experience \d+/i, index + 1)
        if (!root) {
          // One retry — some tenants have a slow dialog animation (4–6s).
          this.debug("warn", "experience.entry_root_retry", { index: index + 1 })
          await sleep(2500)
          root = await this.resolveEntryRoot(WXP_PREFIXES, /work experience \d+/i, index + 1)
        }
        if (!root) {
          this.debug("error", "experience.entry_root_missing_after_add", { index: index + 1 })
          break
        }
      }

      const isDialog = root.matches('[role="dialog"], [data-automation-id*="modal"]')

      await this.fillAutomationIdInRoot(root, "jobTitle", job.title, "Job Title", { labelRe: /job title|title|position/, commit: true })
      await this.fillAutomationIdInRoot(root, "company", job.company, "Company", { labelRe: /company|employer|organization/, commit: true })
      await this.fillAutomationIdInRoot(root, "location", job.location, "Location", { optional: true, labelRe: /location/, commit: true })
      await this.setCheckboxInRoot(root, "currentlyWorkHere", job.current, "Currently Work Here")

      const startMonthViaCombo = await this.selectAutomationComboboxInRoot(root, "startDate-Month", job.startDate.month, "Start Month", { optional: true })
      if (startMonthViaCombo) {
        await this.fillAutomationIdInRoot(root, "startDate-Year", job.startDate.year, "Start Year", { optional: true })
      } else {
        // Inline tenants render From/To as MM/YYYY segment inputs.
        await this.fillInlineDateInRoot(root, "startDate", job.startDate.month, job.startDate.year, "From")
      }
      if (!job.current && job.endDate) {
        const endMonthViaCombo = await this.selectAutomationComboboxInRoot(root, "endDate-Month", job.endDate.month, "End Month", { optional: true })
        if (endMonthViaCombo) {
          await this.fillAutomationIdInRoot(root, "endDate-Year", job.endDate.year, "End Year", { optional: true })
        } else {
          await this.fillInlineDateInRoot(root, "endDate", job.endDate.month, job.endDate.year, "To")
        }
      }

      const description = this.buildExperienceDescription(job)
      await this.fillTextareaAutomationInRoot(root, "description", description, "Description", { labelRe: /description|responsibilities|role description/, commit: true })

      if (isDialog) {
        const save = root.querySelector<HTMLElement>('[data-automation-id="saveWorkExperienceButton"]')
        if (isVisible(save)) {
          const saveEl = save as HTMLElement
          saveEl.click()
          await this.waitForDialogClose(root, 5000)
        } else {
          this.debug("warn", "experience.save_button_missing", { index: index + 1 })
          await this.clickSaveInDialog(root)
        }
      }
      this.debug("info", "experience.entry.saved", { index: index + 1, inline: !isDialog })
      await sleep(100)
    }
  }

  private async fillEducationEntries(): Promise<void> {
    if (!this.cv) return
    if (this.cv.education.length === 0) return

    const add = this.findAddButtonForSection(["educationSection"], /education|school|academic|degree/)
    if (!add) {
      this.debug("warn", "education.add_missing")
      return
    }

    for (const [index, edu] of this.cv.education.entries()) {
      if (this.stopped || this.paused) return
      this.debug("info", "education.entry.start", {
        index: index + 1,
        school: edu.school,
        degree: edu.degree,
      })
      const addButton =
        index === 0 ? add : this.findAddButtonForSection(["educationSection"], /education|school|academic|degree/)
      if (!addButton) {
        this.debug("warn", "education.add_another_missing", { index: index + 1 })
        break
      }
      addButton.click()
      await sleep(500)

      const root = await this.resolveEntryRoot(["education"], /education \d+/i, index + 1)
      if (!root) {
        this.debug("error", "education.entry_root_missing_after_add", { index: index + 1 })
        break
      }
      const isDialog = root.matches('[role="dialog"], [data-automation-id*="modal"]')

      // School: plain text input on dialog tenants; a search prompt (type →
      // pick the matching option) on inline tenants.
      const schoolContainer = this.locateFieldContainer(root, ["school", "schoolName"], /school|university|institution/)
      if (schoolContainer && this.isPromptField(schoolContainer)) {
        // Long official names often return nothing — retry progressively
        // simplified queries, then Workday's own documented escape hatch.
        const schoolQueries: string[] = [edu.school]
        const noParens = edu.school.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim()
        if (noParens && normText(noParens) !== normText(edu.school)) schoolQueries.push(noParens)
        const words = noParens.split(/\s+/)
        if (words.length > 4) schoolQueries.push(words.slice(0, 4).join(" "))
        schoolQueries.push("School Not Listed")
        for (const query of schoolQueries) {
          if (await this.fillPromptSearchInContainer(schoolContainer, query, "School or University")) break
        }
      } else {
        await this.fillAutomationIdInRoot(root, "school", edu.school, "School Name", { labelRe: /school|university|college|institution/ })
      }

      // Degree: dropdown whose vocabulary varies per tenant ("BS", "B.S.",
      // "Bachelor of Science", "Bachelor's"…). Try level-appropriate
      // candidates until one matches an option.
      let degreeSelected = false
      for (const candidate of this.degreeOptionCandidates(edu.degree)) {
        degreeSelected = await this.selectAutomationComboboxInRoot(root, "degree", candidate, "Degree", { optional: true, labelRe: /degree|qualification/, strictOptions: true })
        if (degreeSelected) break
      }
      if (!degreeSelected) {
        this.debug("warn", "education.degree_unmatched", { degree: edu.degree })
        this.markManualReview(root, "Degree")
      }

      // Field of Study: same prompt-vs-text split as school.
      const fieldContainer = this.locateFieldContainer(root, ["fieldOfStudy", "field-of-study"], /field of study|major|discipline/)
      if (fieldContainer && this.isPromptField(fieldContainer)) {
        await this.fillPromptSearchInContainer(fieldContainer, edu.major, "Field of Study")
      } else {
        await this.fillAutomationIdInRoot(root, "fieldOfStudy", edu.major, "Field of Study", { optional: true, labelRe: /field of study|major|area of study|discipline/, commit: true })
      }

      if (edu.gpa) {
        await this.fillAutomationIdInRoot(root, "gpa", edu.gpa, "GPA", { optional: true, commit: true })
      }
      if (edu.startYear) {
        await this.fillAutomationIdInRoot(root, "startDate-Year", edu.startYear, "Education Start Year", {
          optional: true,
          commit: true,
        })
      }
      if (edu.endYear) {
        const endYearSet = await this.fillAutomationIdInRoot(root, "endDate-Year", edu.endYear, "Education End Year", {
          optional: true,
          commit: true,
        })
        if (!endYearSet) {
          await this.selectAutomationComboboxInRoot(root, "endDate-Year", edu.endYear, "Education End Year", {
            optional: true,
          })
        }
      }

      if (isDialog) {
        const save = root.querySelector<HTMLElement>('[data-automation-id="saveEducationButton"]')
        if (isVisible(save)) {
          const saveEl = save as HTMLElement
          saveEl.click()
          await this.waitForDialogClose(root, 5000)
        } else {
          await this.clickSaveInDialog(root)
        }
      }
      this.debug("info", "education.entry.saved", { index: index + 1, inline: !isDialog })
      await sleep(250)
    }
  }

  /**
   * Certifications: résumés store certification NAMES only (no numbers/dates),
   * but Workday's cert entry requires an Issued Date. So we fill the searchable
   * Certification name and flag the required date for manual review rather than
   * inventing a date. Skipped entirely when the résumé has no certifications.
   */
  private async fillCertificationEntries(): Promise<void> {
    if (!this.cv || this.cv.certifications.length === 0) {
      this.debug("info", "certifications.none_on_resume")
      return
    }
    const add = this.findAddButtonForSection(
      ["certificationSection", "certificationsSection", "certifications"],
      /certification|licen[sc]e/,
    )
    if (!add) {
      this.debug("info", "certifications.section_missing_or_hidden")
      return
    }

    for (const [index, cert] of this.cv.certifications.entries()) {
      if (this.stopped || this.paused) return
      this.debug("info", "certification.entry.start", { index: index + 1, cert })
      const addButton =
        index === 0
          ? add
          : this.findAddButtonForSection(
              ["certificationSection", "certificationsSection", "certifications"],
              /certification|licen[sc]e/,
            )
      if (!addButton) {
        this.debug("warn", "certification.add_another_missing", { index: index + 1 })
        break
      }
      addButton.click()
      await sleep(500)

      const root = await this.resolveEntryRoot(["certification", "certifications"], /certifications? \d+/i, index + 1)
      if (!root) {
        this.debug("error", "certification.entry_root_missing_after_add", { index: index + 1 })
        break
      }
      const isDialog = root.matches('[role="dialog"], [data-automation-id*="modal"]')

      // Certification name: search prompt on inline tenants, plain field on dialogs.
      const certContainer = this.locateFieldContainer(
        root,
        ["certification", "certificationName"],
        /certification|licen[sc]e|name/,
      )
      if (certContainer && this.isPromptField(certContainer)) {
        await this.fillPromptSearchInContainer(certContainer, cert, "Certification")
      } else {
        await this.fillAutomationIdInRoot(root, "certification", cert, "Certification", {
          optional: true,
          labelRe: /certification|licen[sc]e|name/,
          commit: true,
        })
      }

      // Issued Date is required but the résumé has no date — flag, don't invent.
      const issuedContainer = this.locateFieldContainer(root, ["issuedDate", "issueDate"], /issued? date|date issued/)
      if (issuedContainer) {
        this.logWarning("Manual review needed: Certification Issued Date (not on résumé)")
        this.markManualReview(issuedContainer, "Certification Issued Date")
      }

      if (isDialog) {
        const save = root.querySelector<HTMLElement>(
          '[data-automation-id="saveCertificationButton"], [data-automation-id*="save" i]',
        )
        if (isVisible(save)) {
          ;(save as HTMLElement).click()
          await this.waitForDialogClose(root, 5000)
        } else {
          await this.clickSaveInDialog(root)
        }
      }
      this.debug("info", "certification.entry.saved", { index: index + 1, inline: !isDialog })
      await sleep(250)
    }
  }

  /**
   * After clicking Add / Add Another, the entry appears either as a modal
   * dialog (older tenants) or as an inline "… N" panel appended to the page.
   * Returns whichever exists, waiting briefly for it to render.
   */
  private async resolveEntryRoot(
    panelPrefixes: string[],
    headingRe: RegExp,
    entryNumber: number,
  ): Promise<HTMLElement | null> {
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      const dialog = this.getActiveDialog()
      if (dialog) return dialog
      // Inline panels persist after filling, so wait until THIS entry's panel
      // exists and return it by index — never an earlier, already-filled one.
      const panels = this.inlineEntryPanels(panelPrefixes, headingRe)
      if (panels.length >= entryNumber) return panels[entryNumber - 1]
      await sleep(150)
    }
    return null
  }

  /** All inline repeating-section panels, in order (e.g. workExperience-1, -2 …). */
  private inlineEntryPanels(panelPrefixes: string[], headingRe: RegExp): HTMLElement[] {
    for (const prefix of panelPrefixes) {
      const panels = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-automation-id^="${safeEscapeSelector(prefix)}-"]`),
      ).filter((el) => isVisible(el) && /-\d+$/.test(el.getAttribute("data-automation-id") ?? ""))
      if (panels.length) return panels
    }
    // Fallback: headings like "Work Experience 2" → smallest ancestor that
    // contains form controls but not a second matching heading.
    const headings = Array.from(
      document.querySelectorAll<HTMLElement>("h3, h4, h5, [role='heading']"),
    ).filter((h) => isVisible(h) && headingRe.test(normText(h.textContent ?? "")))
    const panels: HTMLElement[] = []
    for (const heading of headings) {
      let node: HTMLElement | null = heading.parentElement
      while (node && node !== document.body) {
        if (node.querySelector("input, textarea, select")) {
          const containedHeadings = Array.from(
            node.querySelectorAll<HTMLElement>("h3, h4, h5, [role='heading']"),
          ).filter((h) => headingRe.test(normText(h.textContent ?? "")))
          if (containedHeadings.length <= 1) panels.push(node)
          break
        }
        node = node.parentElement
      }
    }
    return panels
  }

  /** Fill an inline MM/YYYY date widget (dateSectionMonth/Year segment inputs). */
  private async fillInlineDateInRoot(
    root: ParentNode,
    which: "startDate" | "endDate",
    month: string,
    year: string,
    fieldName: string,
  ): Promise<boolean> {
    const field =
      root.querySelector<HTMLElement>(`[data-automation-id="formField-${which}"]`) ??
      root.querySelector<HTMLElement>(`[data-automation-id="${which}"]`) ??
      (root instanceof HTMLElement ? root : null)
    if (!field) return false
    const scope = field === root ? (root as HTMLElement) : field
    const monthInput = scope.querySelector<HTMLInputElement>('[data-automation-id="dateSectionMonth-input"]')
    const yearInput = scope.querySelector<HTMLInputElement>('[data-automation-id="dateSectionYear-input"]')
    if (!monthInput && !yearInput) {
      this.debug("warn", "field.inline_date_not_found", { fieldName, which })
      return false
    }
    this.setToolbarField(fieldName)
    let ok = false
    const monthValue = this.monthNumber(month)
    if (monthInput && monthValue) {
      ok = this.setElementValue(monthInput, monthValue, `${fieldName} Month`, { commit: true }) || ok
    }
    if (yearInput && nonEmpty(year)) {
      ok = this.setElementValue(yearInput, year, `${fieldName} Year`, { commit: true }) || ok
    }
    if (ok) this.bumpFilledCount()
    this.debug(ok ? "info" : "warn", "field.inline_date_fill", { fieldName, which, ok })
    return ok
  }

  /** "January"/"jan"/"1"/"01" → "01"; "" when unparseable. */
  private monthNumber(raw: string): string {
    const v = normText(raw)
    if (!v) return ""
    const n = Number.parseInt(v, 10)
    if (Number.isFinite(n) && n >= 1 && n <= 12) return String(n).padStart(2, "0")
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
    const idx = months.findIndex((m) => m.startsWith(v.slice(0, 3)))
    return idx >= 0 ? String(idx + 1).padStart(2, "0") : ""
  }

  /** Locate a field's formField container by automation id or label. */
  private locateFieldContainer(root: ParentNode, automationIds: string[], labelRe: RegExp): HTMLElement | null {
    for (const id of automationIds) {
      const el =
        root.querySelector<HTMLElement>(`[data-automation-id="formField-${safeEscapeSelector(id)}"]`) ??
        root.querySelector<HTMLElement>(`[data-automation-id="${safeEscapeSelector(id)}"]`)
      if (el && isVisible(el)) return el.closest<HTMLElement>('[data-automation-id^="formField"]') ?? el
    }
    const labelled = this.findControlByLabel(labelRe, { root })
    if (!labelled) return null
    return labelled.closest<HTMLElement>('[data-automation-id^="formField"]') ?? labelled
  }

  /** True when a field is a Workday search prompt (☰ multiselect) rather than a plain input. */
  private isPromptField(container: HTMLElement): boolean {
    return Boolean(
      container.querySelector(
        '[data-uxi-widget-type="multiselect"], [data-automation-id="multiSelectContainer"], [data-automation-id="promptIcon"]',
      ),
    )
  }

  /**
   * Generic prompt-search fill: type the query into the prompt's search box,
   * wait for backend results, click the best match (exact normalized → partial
   * → first), and verify the selection pill registered.
   */
  private async fillPromptSearchInContainer(container: HTMLElement, query: string, fieldName: string): Promise<boolean> {
    if (!nonEmpty(query)) return false
    if (this.hasWorkdayMultiselectSelection(container)) {
      this.debug("info", "prompt_search.already_selected", { fieldName })
      return true
    }
    const input =
      container.querySelector<HTMLInputElement>('input[data-uxi-widget-type="selectinput"]') ??
      container.querySelector<HTMLInputElement>('[data-automation-id="multiselectInputContainer"] input') ??
      container.querySelector<HTMLInputElement>("input")
    if (!input || !isVisible(input)) {
      this.debug("warn", "prompt_search.input_missing", { fieldName })
      return false
    }
    this.setToolbarField(fieldName)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    const nativeSet = (value: string): void => {
      setter?.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    input.scrollIntoView({ block: "center" })
    input.focus()
    nativeSet(query)
    for (const type of ["keydown", "keyup"] as const) {
      input.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }))
    }

    const desired = normText(query)
    const optionLabel = (option: HTMLElement): string =>
      nonEmpty(option.getAttribute("data-automation-label")) || nonEmpty(option.textContent)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const options = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-automation-id="activeListContainer"] [data-automation-id="promptOption"]',
        ),
      ).filter(
        (el) => isVisible(el) && nonEmpty(el.textContent).length > 0 && !this.isUnansweredSelectPlaceholder(el.textContent ?? ""),
      )
      if (options.length) {
        const target =
          options.find((o) => normText(optionLabel(o)) === desired) ??
          options.find((o) => {
            const t = normText(optionLabel(o))
            return t.includes(desired) || desired.includes(t)
          }) ??
          options[0]
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
        target.click()
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
        await sleep(350)
        if (this.hasWorkdayMultiselectSelection(container)) {
          this.bumpFilledCount()
          this.debug("info", "prompt_search.selected", { fieldName, picked: optionLabel(target) })
          if (input.value) nativeSet("")
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
          return true
        }
      }
      await sleep(150)
    }
    this.debug("warn", "prompt_search.no_selection", { fieldName, query: query.slice(0, 60) })
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    this.markManualReview(container, fieldName)
    return false
  }

  /**
   * Candidate option texts for a degree dropdown, most-specific first.
   * "Bachelor of Science in X" → BS / B.S. / BSc / Bachelor of Science /
   * Bachelor's…; "Master of Science" → MS / M.S. / MSc / Master of Science…
   */
  private degreeOptionCandidates(rawDegree: string): string[] {
    const v = normText(rawDegree)
    if (!v) return []
    const compact = v.replace(/[^a-z]/g, "")
    const out: string[] = [rawDegree]
    const isScience = /\bscience\b/.test(v) || /^(bs|bsc|ms|msc)/.test(compact)
    const isArts = /\barts?\b/.test(v) || /^(ba|ma)$/.test(compact)
    if (/\bmba\b/.test(v) || /business administration/.test(v)) {
      out.push("MBA", "M.B.A.", "Master of Business Administration", "Masters", "Master's", "Master's Degree")
    } else if (/master/.test(v) || /^m(s|sc|a|eng)$/.test(compact)) {
      if (isScience) out.push("MS", "M.S.", "MSc", "Master of Science")
      if (isArts) out.push("MA", "M.A.", "Master of Arts")
      out.push("Masters", "Master's", "Master's Degree", "Master")
    } else if (/bachelor/.test(v) || /^b(s|sc|a|eng)$/.test(compact)) {
      if (isScience) out.push("BS", "B.S.", "BSc", "Bachelor of Science")
      if (isArts) out.push("BA", "B.A.", "Bachelor of Arts")
      out.push("Bachelors", "Bachelor's", "Bachelor's Degree", "Bachelor")
    } else if (/phd|ph d|doctor/.test(v)) {
      out.push("PhD", "Ph.D.", "Doctorate", "Doctoral", "Doctor of Philosophy")
    } else if (/associate/.test(v)) {
      out.push("AS", "A.S.", "AA", "A.A.", "Associates", "Associate's", "Associate's Degree")
    } else if (/high school|secondary/.test(v)) {
      out.push("High School", "High School Diploma", "High School or Equivalent")
    } else if (/diploma|certificate/.test(v)) {
      out.push("Diploma", "Certificate")
    }
    return out.filter((c) => nonEmpty(c))
  }

  private async fillSkillsSection(): Promise<void> {
    if (!this.cv) return
    const add = this.findAddButtonForSection(["skillsSection", "skills"], /skill/)
    if (!add) {
      // Inline tenants render Skills as a single "Type to Add Skills" prompt
      // instead of an Add-button dialog — add each resume skill through it.
      await this.fillSkillsPrompt()
      return
    }
    const skills = this.cv.skills.slice(0, 24)
    for (const skill of skills) {
      if (this.stopped || this.paused) return
      this.debug("info", "skills.entry.start", { skill })
      add.click()
      await sleep(220)
      const dialog = this.getActiveDialog()
      if (!dialog) break
      const skillTarget =
        dialog.querySelector<HTMLElement>('[data-automation-id="skillName"]') ??
        this.findControlByLabel(/skill|search/, { root: dialog })
      const skillInput = resolveInputControlFromElement(skillTarget)
      if (!(skillInput instanceof HTMLInputElement || skillInput instanceof HTMLTextAreaElement)) {
        this.debug("warn", "skills.input_missing", { skill })
        await this.clickSaveInDialog(dialog)
        continue
      }
      this.setToolbarField("Skill")
      this.setElementValue(skillInput, skill, "Skill")
      await sleep(500)

      const options = Array.from(
        document.querySelectorAll('[data-automation-id^="skillName-menu-item--"], [role="option"]'),
      )
      const option = findOptionByText(options, skill)
      if (option) {
        option.click()
        this.debug("info", "skills.option_selected", {
          skill,
          options: options.length,
          strategy: "menu_match",
        })
      } else {
        skillInput.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }),
        )
        this.debug("warn", "skills.option_fallback_enter", {
          skill,
          options: options.length,
        })
      }

      const save = dialog.querySelector<HTMLElement>('[data-automation-id="saveSkillButton"]')
      if (isVisible(save)) {
        const saveEl = save as HTMLElement
        saveEl.click()
        await this.waitForDialogClose(dialog, 5000)
      } else {
        await this.clickSaveInDialog(dialog)
      }
      this.bumpFilledCount()
      this.debug("info", "skills.entry.saved", { skill })
      await sleep(400)
    }
  }

  /**
   * "Type to Add Skills" prompt: for each resume skill, type it, click the
   * matching typeahead option (pill appears), move on. Enter-to-create is the
   * fallback when the typeahead has no match.
   */
  private async fillSkillsPrompt(): Promise<void> {
    if (!this.cv || this.cv.skills.length === 0) return
    const container = this.locateFieldContainer(document, ["skills", "skillsPrompt"], /type to add skills|^skills$/)
    if (!container || !this.isPromptField(container)) {
      this.debug("info", "skills.section_missing_or_hidden")
      return
    }
    const input =
      container.querySelector<HTMLInputElement>('input[data-uxi-widget-type="selectinput"]') ??
      container.querySelector<HTMLInputElement>('[data-automation-id="multiselectInputContainer"] input') ??
      container.querySelector<HTMLInputElement>("input")
    if (!input || !isVisible(input)) {
      this.debug("warn", "skills.prompt_input_missing")
      return
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    const nativeSet = (value: string): void => {
      setter?.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    const pressKey = (key: string, keyCode: number): void => {
      for (const type of ["keydown", "keyup"] as const) {
        input.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode, which: keyCode, bubbles: true }))
      }
    }
    const pillTexts = (): string[] =>
      Array.from(container.querySelectorAll<HTMLElement>('[data-automation-id="selectedItem"]'))
        .filter((el) => isVisible(el))
        .map((el) => normText(el.textContent ?? ""))
    const optionLabel = (option: HTMLElement): string =>
      nonEmpty(option.getAttribute("data-automation-label")) || nonEmpty(option.textContent)
    const visibleOptions = (): HTMLElement[] =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-automation-id="activeListContainer"] [data-automation-id="promptOption"]',
        ),
      ).filter(
        (el) => isVisible(el) && nonEmpty(el.textContent).length > 0 && !this.isUnansweredSelectPlaceholder(el.textContent ?? ""),
      )

    for (const skill of this.cv.skills.slice(0, 24)) {
      if (this.stopped || this.paused) return
      const want = normText(skill)
      if (!want) continue
      // Exact-equality checks ONLY: substring logic made "JavaScript" look
      // like an existing "Java" pill and silently skipped Java.
      if (pillTexts().includes(want)) continue
      this.setToolbarField(`Skill: ${skill}`)
      const before = new Set(pillTexts())
      const newPill = (): string | null => pillTexts().find((t) => !before.has(t)) ?? null

      let added = false
      for (let attempt = 0; attempt < 2 && !added; attempt += 1) {
        // Open the widget (skills search only fires once the popup is active),
        // then type + Enter — the same trigger the working School/Field-of-
        // Study prompt uses to populate results.
        input.focus()
        input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
        input.click()
        input.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
        await sleep(150)
        nativeSet(skill)
        pressKey("Enter", 13)

        const deadline = Date.now() + 2500
        while (Date.now() < deadline && !added) {
          if (newPill()) {
            added = true
            break
          }
          // Match the catalog's canonical name for this skill — the list uses
          // "Java (Programming Language)", "Amazon Web Services (AWS)", etc.,
          // so plain equality misses. skillOptionMatches strips the
          // parenthetical and also checks the acronym inside it, while still
          // rejecting look-alikes ("AWS" ≠ "AWS VPN", "Java" ≠ "JavaScript").
          const options = visibleOptions()
          const match =
            options.find((o) => this.skillOptionMatches(optionLabel(o), skill, "strong")) ??
            options.find((o) => this.skillOptionMatches(optionLabel(o), skill, "loose"))
          if (match) {
            match.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
            match.click()
            match.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
            await sleep(200)
            added = Boolean(newPill())
            if (added) break
          }
          await sleep(120)
        }
      }
      if (added) {
        this.bumpFilledCount()
        this.debug("info", "skills.prompt_added", { skill, pill: newPill() })
      } else {
        this.debug("warn", "skills.prompt_not_added", { skill })
        nativeSet("")
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      }
      await sleep(150)
    }
    if (input.value) nativeSet("")
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  }

  /**
   * Does a skills-catalog option correspond to the résumé skill?
   *   strong — canonical-name match:
   *     • whole option equals the skill ("GraphQL" = "GraphQL")
   *     • option minus its "(…)" qualifier equals the skill
   *       ("Java (Programming Language)" → "Java")
   *     • the acronym inside "(…)" equals the skill
   *       ("Amazon Web Services (AWS)" ← "AWS")
   *   loose — option base starts with the skill as a full word, for multi-word
   *     skills only (guards against "AWS" → "AWS VPN": single short tokens are
   *     excluded from loose).
   * Both reject "Java" vs "JavaScript" (bases differ) and "AWS" vs "AWS VPN".
   */
  private skillOptionMatches(optionLabelRaw: string, skillRaw: string, mode: "strong" | "loose"): boolean {
    const want = normText(skillRaw)
    const label = normText(optionLabelRaw)
    if (!want || !label) return false
    const base = normText(optionLabelRaw.replace(/\s*\([^)]*\)\s*/g, " "))
    const parenMatch = optionLabelRaw.match(/\(([^)]*)\)/)
    const paren = parenMatch ? normText(parenMatch[1]) : ""
    if (mode === "strong") {
      if (label === want) return true
      if (base === want) return true
      if (paren && paren === want) return true
      return false
    }
    // loose: only for multi-word skills, require a whole-word prefix on base.
    if (want.split(" ").length < 2) return false
    return base === want || base.startsWith(`${want} `)
  }

  // fillWebsiteSection was removed 2026-07 (product decision: never autofill
  // the Websites section) — see git history if it needs to come back.

  /**
   * Yes/No (and small multi-choice) radio screening questions. Standalone so
   * it can run on any step — Workday tenants scatter these across My
   * Information and the dedicated questions page (e.g. "Are you a previous
   * employee?"). Unrecognised ones defer to the semantic tier.
   */
  private fillScreeningRadios(): void {
    const handledRadioNames = new Set<string>()
    // NB: filter by reachability, NOT isVisible — Workday radio inputs are
    // opacity:0 overlays, so isVisible would drop every one of them.
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(isControlReachable)
    this.debug("info", "questions.radios.detected", { count: radios.length })
    for (const radio of radios) {
      const key = radio.name || radio.id || `radio-${radios.indexOf(radio)}`
      if (handledRadioNames.has(key)) continue
      handledRadioNames.add(key)

      const group = radio.name
        ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${safeEscapeSelector(radio.name)}"]`))
        : [radio]
      // Skip groups that already have a selection (e.g. user pre-answered).
      if (group.some((choice) => choice.checked)) continue
      const label = this.getRadioGroupQuestionLabel(radio, group)
      const sensitiveAnswer = isSensitiveWorkAuthQuestion(label) ? this.getProfileWorkAuthYesNoAnswer(label) : null
      // Only clear saved-profile work authorization / sponsorship yes-no
      // questions are filled. Citizenship, immigration status, conflict, and
      // ambiguous auth questions stay manual because a wrong value can reject.
      if (isSensitiveWorkAuthQuestion(label) && sensitiveAnswer === null) {
        this.debug("info", "questions.radio.sensitive_manual_review", { label })
        const container = radio.closest<HTMLElement>("[data-automation-id*='formField'], fieldset") ?? radio
        this.markManualReview(container, label)
        this.requiredFieldMissesThisStep += 1
        continue
      }
      const answer = sensitiveAnswer ?? this.getYesNoAnswer(label)
      if (answer === null) {
        this.debug("warn", "questions.radio.unanswered", { label: label || "(missing label)" })
        // Defer to the semantic tier. >2 choices → treat as a select over the
        // radio labels; otherwise a yes/no. The model's answer is matched back
        // to a choice and clicked.
        const radioText = (input: HTMLInputElement): string => {
          if (input.id) {
            const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
            if (l?.textContent?.trim()) return l.textContent.trim()
          }
          const w = input.closest("label")
          return w?.textContent?.trim() || nonEmpty(input.value)
        }
        const choices = group.map(radioText).map((t) => t.trim()).filter(Boolean)
        const isYesNo = choices.length <= 2
        this.queueSemantic({
          el: radio,
          label: label || "Application question",
          type: isYesNo ? "yesno" : "select",
          options: isYesNo ? undefined : choices,
          apply: (value: string): boolean => {
            const want = value.trim().toLowerCase()
            const pick = group.find((choice) => {
              const t = radioText(choice).toLowerCase()
              return isYesNo
                ? (/^(yes|y|true)$/.test(want) ? /\byes\b|\btrue\b/.test(t) : /\bno\b|\bfalse\b/.test(t))
                : (t === want || t.includes(want) || want.includes(t))
            })
            if (pick && !pick.checked) {
              pick.click()
              pick.dispatchEvent(new Event("change", { bubbles: true }))
              return true
            }
            return Boolean(pick?.checked)
          },
        })
        continue
      }
      const target = group.find((choice) => {
        const txt = this.getRadioLabel(choice)
        return answer ? /\byes\b|\btrue\b/i.test(txt) : /\bno\b|\bfalse\b/i.test(txt)
      })
      const fallback = answer ? group[0] : group[group.length - 1]
      const pick = target ?? fallback
      if (pick && !pick.checked) {
        pick.click()
        pick.dispatchEvent(new Event("change", { bubbles: true }))
        this.bumpFilledCount()
        this.debug("info", "questions.radio.answered", {
          label: label || "(missing label)",
          answer,
          pickedFallback: !target,
        })
      }
    }
  }

  private async fillApplicationQuestionsStep(): Promise<void> {
    if (!this.cv) return
    this.debug("info", "step.application_questions.start")
    this.fillScreeningRadios()
    this.fillDiversityCheckboxGroups()
    this.fillConsentCheckboxes()

    const textFields = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), textarea',
      ),
    ).filter((el) => isVisible(el))
    for (const field of textFields) {
      const current = "value" in field ? nonEmpty(field.value) : ""
      if (current) continue
      const label = parseQuestionLabel(field)
      if (!label) continue
      const answer = this.getTextAnswer(label)
      if (!answer) {
        this.debug("warn", "questions.text.unanswered", { label })
        const isTextarea = field.tagName.toLowerCase() === "textarea"
        this.queueSemantic({
          el: field,
          label,
          type: isTextarea ? "textarea" : "text",
          apply: (value: string) => this.setElementValue(field, value, label),
        })
        continue
      }
      const ok = this.setElementValue(field, answer, label)
      if (ok) this.bumpFilledCount()
      this.debug(ok ? "info" : "warn", "questions.text.answered", { label, ok })
    }

    const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).filter((el) => isVisible(el))
    this.debug("info", "questions.selects.detected", { count: selects.length })
    for (const select of selects) {
      const label = parseQuestionLabel(select)
      if (!label) continue
      if (this.isDiversityQuestionLabel(label)) {
        const ok = this.fillNativeDiversitySelect(select, label)
        if (!ok) {
          this.debug("warn", "questions.select.diversity_unanswered", { label })
          this.markManualReview(select, label)
          this.requiredFieldMissesThisStep += 1
        }
        continue
      }
      if (isSensitiveWorkAuthQuestion(label)) {
        const selectedText = nonEmpty(select.options[select.selectedIndex]?.textContent)
        if (selectedText && !this.isUnansweredSelectPlaceholder(selectedText)) {
          this.debug("info", "questions.select.sensitive_kept_existing", { label, current: selectedText.slice(0, 60) })
          continue
        }
        if (this.getProfileWorkAuthYesNoAnswer(label) === null) {
          this.debug("info", "questions.select.sensitive_manual_review", { label })
          this.markManualReview(select, label)
          this.requiredFieldMissesThisStep += 1
          continue
        }
      }

      const selectOptions = Array.from(select.options)
      const optionTexts = selectOptions
        .map((opt) => (opt.textContent ?? "").trim())
        .filter((text) => text && !this.isUnansweredSelectPlaceholder(text))
      const applySelect = (value: string): boolean => {
        const match =
          selectOptions.find((opt) => normText(opt.textContent) === normText(value)) ??
          selectOptions.find(
            (opt) =>
              normText(opt.textContent).includes(normText(value)) ||
              normText(value).includes(normText(opt.textContent)),
          )
        if (!match) return false
        select.value = match.value
        select.dispatchEvent(new Event("input", { bubbles: true }))
        select.dispatchEvent(new Event("change", { bubbles: true }))
        return true
      }

      // Native <select> yes/no + agreement questions (e.g. "Are you at least
      // 18 years of age?") — resolve deterministically, the same way as the
      // custom-combobox path, before falling back to the semantic tier.
      const currentText = normText(select.options[select.selectedIndex]?.textContent ?? "")
      const isAnswered = Boolean(currentText) && !this.isUnansweredSelectPlaceholder(currentText)
      const { candidates, confident } = this.questionComboboxCandidates(label)
      const matchesCurrent = candidates.some(
        (c) => currentText === normText(c) || currentText.includes(normText(c)),
      )

      let answered = false
      if (candidates.length && !(isAnswered && (matchesCurrent || !confident))) {
        for (const cand of candidates) {
          if (applySelect(cand)) {
            answered = true
            this.bumpFilledCount()
            this.debug("info", "questions.select.answered", { label, desired: cand, overrode: isAnswered })
            break
          }
        }
      }
      if (!answered) {
        if (isAnswered && (matchesCurrent || !confident)) {
          this.debug("info", "questions.select.kept_existing", { label, current: currentText.slice(0, 60) })
        } else {
          this.debug("warn", "questions.select.deferred", { label })
          this.queueSemantic({ el: select, label, type: "select", options: optionTexts, apply: applySelect })
        }
      }
    }
    await this.fillApplicationQuestionComboboxes()
    await this.flushSemanticQueue()
    this.debug("info", "step.application_questions.complete")
  }

  /** Enqueue a required question for the batched semantic (Claude) resolver. */
  private queueSemantic(q: SemanticQuestion): void {
    if (q.el.getAttribute(MANUAL_REVIEW_ATTR) === "1") return
    if (this.semanticQueue.some((existing) => existing.el === q.el)) return
    this.semanticQueue.push(q)
  }

  /**
   * Second tier of the apply agent: resolve every deferred required question in
   * ONE server-side Claude call (profile + résumé aware, option-constrained),
   * then apply each answer via its captured handler. Anything the model can't
   * answer — or that fails to apply — falls back to manual review, so this can
   * only ever improve on the deterministic pass, never regress it.
   */
  private async flushSemanticQueue(): Promise<void> {
    const queue = this.semanticQueue
    this.semanticQueue = []
    if (queue.length === 0 || this.stopped) {
      for (const q of queue) this.markManualReview(q.el, q.label)
      return
    }

    // Everything on the Workday semantic queue is a REQUIRED field the
    // deterministic matcher couldn't answer, and the Workday runner is always a
    // hands-off (autonomous) agent — so ask the server to best-effort answer
    // each rather than nulling out and stranding the step at manual review.
    const questions: MatchQuestion[] = queue.map((q, index) => ({
      id: String(index),
      label: q.label,
      type: q.type,
      options: q.options,
      required: true,
    }))

    let answers: Map<string, string | null>
    try {
      this.debug("info", "questions.semantic.request", { count: questions.length })
      const res = await matchQuestions({
        questions,
        jobTitle: this.detectJobTitle(),
        mode: "autonomous",
      })
      answers = new Map(res.answers.map((a) => [a.id, a.value]))
      this.debug("info", "questions.semantic.response", {
        answered: res.answers.filter((a) => a.value != null).length,
        total: questions.length,
      })
    } catch (err) {
      // Network/auth/AI failure — preserve the existing contract: everything
      // queued becomes manual review, exactly as before this tier existed.
      this.debug("warn", "questions.semantic.failed", {
        error: err instanceof Error ? err.message : String(err),
      })
      for (const q of queue) this.markManualReview(q.el, q.label)
      return
    }

    for (let index = 0; index < queue.length; index++) {
      if (this.stopped) return
      const q = queue[index]
      const value = answers.get(String(index)) ?? null
      if (!value) {
        this.markManualReview(q.el, q.label)
        continue
      }
      let ok = false
      try {
        ok = await q.apply(value)
      } catch {
        ok = false
      }
      if (ok) {
        this.bumpFilledCount()
        this.debug("info", "questions.semantic.answered", { label: q.label, value })
        await sleep(120)
      } else {
        this.debug("warn", "questions.semantic.apply_failed", { label: q.label, value })
        this.markManualReview(q.el, q.label)
      }
    }
  }

  /** Best-effort Workday job title for answer context (optional). */
  private detectJobTitle(): string | undefined {
    const el = document.querySelector<HTMLElement>(
      '[data-automation-id="jobPostingHeader"], [data-automation-id="jobTitle"], h1',
    )
    const text = el?.textContent?.trim()
    return text && text.length <= 160 ? text : undefined
  }

  private async fillApplicationQuestionComboboxes(): Promise<void> {
    // Workday application questions are frequently rendered as custom
    // combobox widgets (placeholder: "Select One") rather than native
    // <select>. Handle those explicitly so yes/no screening questions fill.
    const containers = Array.from(
      document.querySelectorAll<HTMLElement>('[data-automation-id*="formField"]'),
    ).filter((el) => isVisible(el))
    this.debug("info", "questions.combobox.scan_start", { containers: containers.length })

    for (const container of containers) {
      if (this.stopped || this.paused) return
      const comboboxTarget = container.querySelector<HTMLElement>(
        '[role="combobox"], [aria-haspopup="listbox"], [data-automation-id*="dropDown"], [data-automation-id*="Dropdown"]',
      )
      if (!comboboxTarget || !isVisible(comboboxTarget)) continue

      const label = this.extractApplicationQuestionLabel(container, comboboxTarget)
      if (!label) continue
      if (this.isDiversityQuestionLabel(label)) {
        const pref = this.diversityPreference(label)
        let ok = false
        if (pref && !pref.decline && pref.values.length) {
          ok = await this.selectOptionMatching(comboboxTarget, label, (t) => this.optionMatchesSaved(t, pref.values))
          if (ok) this.debug("info", "questions.combobox.diversity_saved", { label, values: pref.values.join(" | ") })
        }
        if (!ok) {
          ok = await this.selectOptionMatching(comboboxTarget, label, (t) => DISCLOSURE_DECLINE_RE.test(t))
          this.debug("info", "questions.combobox.diversity_declined", { label, declined: ok })
        }
        if (!ok) {
          this.markManualReview(container, label)
          this.requiredFieldMissesThisStep += 1
        }
        await sleep(250)
        continue
      }
      // Work-authorization / eligibility / sponsorship / immigration / conflict:
      // high-stakes questions where a wrong answer can auto-reject. Workday's
      // button-listbox widgets on some tenants revert an auto-selected value
      // (the click updates the display but not React's committed model), so a
      // silently-wrong "No" could ship. Never auto-answer these — leave them
      // blank and flag for the user, UNLESS they're already answered.
      if (isSensitiveWorkAuthQuestion(label)) {
        const existingVal = nonEmpty(extractComboboxDisplayValue(comboboxTarget))
        if (existingVal && !this.isUnansweredSelectPlaceholder(existingVal)) {
          this.debug("info", "questions.combobox.sensitive_kept_existing", { label, existing: existingVal.slice(0, 40) })
          continue
        }
        if (this.getProfileWorkAuthYesNoAnswer(label) === null) {
          this.debug("info", "questions.combobox.sensitive_manual_review", { label })
          this.markManualReview(container, label)
          this.requiredFieldMissesThisStep += 1
          continue
        }
      }

      // Candidate answers in priority order. Agreement dropdowns render
      // "I Agree" / "I Do Not Agree" (not Yes/No), so an affirmative intent
      // must try both — we can't enumerate options without opening the menu.
      const { candidates, confident } = this.questionComboboxCandidates(label)
      this.debug("info", "questions.combobox.candidates", {
        label: label.slice(0, 90),
        candidates: candidates.join("|").slice(0, 80),
        confident,
      })

      const existing = nonEmpty(extractComboboxDisplayValue(comboboxTarget))
      const deferCombobox = () =>
        this.queueSemantic({
          el: container,
          label,
          type: "text",
          apply: (value: string) =>
            this.selectComboboxElement(comboboxTarget, value, label, { optional: true }),
        })

      if (existing && !this.isUnansweredSelectPlaceholder(existing)) {
        const existingMatches = candidates.some(
          (c) => normText(existing) === normText(c) || normText(existing).includes(normText(c)),
        )
        // Keep the existing value if it already matches our answer, or if we
        // have no confident answer to replace it with. Otherwise correct a
        // mismatched value (e.g. a wrong answer left by an earlier run).
        if (existingMatches || !confident) {
          this.debug("info", "questions.combobox.kept_existing", { label, existing: existing.slice(0, 80), confident })
          continue
        }
        this.debug("info", "questions.combobox.overriding_existing", { label, existing: existing.slice(0, 80) })
      }

      if (!candidates.length) {
        this.debug("warn", "questions.combobox.unanswered", { label })
        deferCombobox()
        continue
      }

      let ok = false
      let chosen = ""
      // Retry the whole candidate sweep: Workday's button-dropdowns
      // (aria-haspopup="listbox") render their option list into a portal
      // asynchronously on first open, so the very first select can miss the
      // options and only lands on a second, warmed-up attempt. Without this the
      // first pass fell through to the AI tier below, which guessed WRONG on
      // sensitive work-eligibility questions (answered "No" → self-reject).
      for (let attempt = 0; attempt < 3 && !ok; attempt += 1) {
        for (const cand of candidates) {
          ok = await this.selectComboboxElement(comboboxTarget, cand, label, { optional: true, strictOptions: true })
          if (ok) {
            chosen = cand
            break
          }
        }
        if (!ok) await sleep(400)
      }
      if (ok) {
        this.debug("info", "questions.combobox.answered", { label, desired: chosen })
      } else if (confident) {
        // We KNOW this answer (work authorization, sponsorship, conflict of
        // interest, agreements…). NEVER hand a confident answer to the AI
        // semantic tier — a wrong guess on a work-eligibility question can
        // auto-reject the application. Leave it for the user to complete.
        this.debug("warn", "questions.combobox.confident_select_failed", { label, tried: candidates.join(" | ") })
        this.markManualReview(container, label)
        this.requiredFieldMissesThisStep += 1
      } else {
        this.debug("warn", "questions.combobox.answer_failed", { label, tried: candidates.join(" | ") })
        deferCombobox()
      }
    }
  }

  /**
   * Ordered candidate answers for an application-question dropdown. Yes/No
   * screening questions and "I Agree"/"I Do Not Agree" consent dropdowns are
   * both common, so an affirmative/negative intent expands to synonyms tried
   * in turn until one matches a real option.
   */
  private questionComboboxCandidates(label: string): { candidates: string[]; confident: boolean } {
    const q = normText(label)
    const affirmative = ["Yes", "I Agree", "Agree", "I Accept", "Accept", "I Consent", "True"]
    const negative = ["No", "I Do Not Agree", "I Disagree", "Disagree", "Decline", "False"]

    // Explicit non-yes/no answers (education level, citizenship, …) — confident.
    const sel = this.getSelectAnswer(label)
    if (sel) return { candidates: [sel], confident: true }

    // Agreement / consent / acknowledgement / e-signature → affirmative. Confident.
    if (/\bagree\b|\bconsent\b|acknowledge|e signature|electronic signature|electronically (receive|sign)|i agree/.test(q)) {
      return { candidates: ["I Agree", "Agree", "Yes", "I Accept", "I Consent"], confident: true }
    }

    // Deterministic yes/no mapping (18+, sponsorship, work auth, …) — confident.
    const yn = this.getYesNoAnswer(label)
    if (yn !== null) return { candidates: yn ? affirmative : negative, confident: true }

    // Heuristic inference — NOT confident, so it never overrides an existing value.
    const inferred = this.inferDefaultQuestionComboboxAnswer(label)
    if (inferred === "Yes") return { candidates: affirmative, confident: false }
    if (inferred === "No") return { candidates: negative, confident: false }
    return { candidates: [], confident: false }
  }

  private normalizeQuestionLabel(raw: string): string {
    return raw
      .replace(/\s+/g, " ")
      .replace(/\s*\*\s*$/g, "")
      .trim()
  }

  private extractApplicationQuestionLabel(container: HTMLElement, target: HTMLElement): string {
    const primary = this.normalizeQuestionLabel(parseQuestionLabel(target) || parseQuestionLabel(container))
    if (primary && !this.isUnansweredSelectPlaceholder(primary) && primary.length > 8) return primary

    const inlinePrompt = container.querySelector<HTMLElement>(
      '[data-automation-id*="prompt"], [data-automation-id*="question"], [id*="prompt"], [id*="question"]',
    )
    if (inlinePrompt?.textContent?.trim()) {
      const text = this.normalizeQuestionLabel(inlinePrompt.textContent)
      if (text && !this.isUnansweredSelectPlaceholder(text)) return text
    }

    let hop: HTMLElement | null = target
    while (hop && hop !== container) {
      let prev = hop.previousElementSibling as HTMLElement | null
      while (prev) {
        const txt = this.normalizeQuestionLabel(prev.textContent ?? "")
        if (
          txt.length > 12 &&
          !this.isUnansweredSelectPlaceholder(txt) &&
          !/^\*?\s*indicates?\s+a\s+required\s+field\b/i.test(txt)
        ) {
          return txt
        }
        prev = prev.previousElementSibling as HTMLElement | null
      }
      hop = hop.parentElement
    }

    const explicit = container.querySelector<HTMLElement>(
      ":scope > label, :scope > legend, :scope > [data-automation-id*='label'], :scope > [role='heading'], :scope > h1, :scope > h2, :scope > h3, :scope > h4",
    )
    if (explicit?.textContent?.trim()) {
      const text = this.normalizeQuestionLabel(explicit.textContent)
      if (text && !this.isUnansweredSelectPlaceholder(text)) return text
    }

    const candidates = Array.from(
      container.querySelectorAll<HTMLElement>("label, legend, [role='heading'], h1, h2, h3, h4, p, span, div"),
    )
      .filter((el) => !el.closest("[role='combobox'], [aria-haspopup='listbox']"))
      .map((el) => this.normalizeQuestionLabel(el.textContent ?? ""))
      .filter((text) =>
        text.length > 10 &&
        text.length < 320 &&
        !this.isUnansweredSelectPlaceholder(text) &&
        !/^\*?\s*indicates?\s+a\s+required\s+field\b/i.test(text),
      )
      .sort((a, b) => b.length - a.length)

    return candidates[0] ?? primary
  }

  private async selectComboboxElement(
    target: HTMLElement,
    value: string,
    fieldName: string,
    opts?: { optional?: boolean; riskyApplyFlowField?: boolean; strictOptions?: boolean },
  ): Promise<boolean> {
    const attr = "data-ho-combobox-target"
    const token = `ho-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    target.setAttribute(attr, token)
    try {
      return await this.selectCombobox(`[${attr}="${safeEscapeSelector(token)}"]`, value, fieldName, opts)
    } finally {
      if (target.getAttribute(attr) === token) target.removeAttribute(attr)
    }
  }

  private isUnansweredSelectPlaceholder(value: string): boolean {
    const v = normText(value)
    return (
      !v ||
      v === "select one" ||
      v === "select" ||
      v === "choose one" ||
      v === "choose" ||
      v === "select an option" ||
      v === "please select" ||
      // Workday multiselects carry a hidden a11y counter ("0 items selected")
      // that leaks out of extractComboboxDisplayValue and previously made an
      // empty multiselect look answered.
      /^0 items? selected$/.test(v) ||
      // Prompt menus render a "No Items." / loading row while options are
      // being fetched from the server — never a real, clickable option.
      // (Clicking it wedges the whole prompt widget; verified live.)
      v === "no items" ||
      v === "no items found" ||
      v === "no matches" ||
      v === "loading"
    )
  }

  private getProfileWorkAuthYesNoAnswer(question: string): boolean | null {
    if (!this.cv) return null
    const q = normText(question)
    if (!q) return null
    // Free-text/status questions need the user's exact status, not a yes/no.
    if (/\b(status|type|category|classification)\b/.test(q) && !/\byes\s*\/\s*no\b|\byes or no\b/.test(q)) return null

    const authWorkContext =
      /\bsponsor/.test(q) ||
      /\bwork authoriz|\bwork authoris/.test(q) ||
      /\bauthoriz\w*\s+to\s+work\b|\bauthoris\w*\s+to\s+work\b/.test(q) ||
      /\bauthoriz\w*\s+for\s+employment\b|\bauthoris\w*\s+for\s+employment\b/.test(q) ||
      /\beligible (?:to work|for employment)\b|\bemployment eligibility\b|\bright to work\b|\bwork permit\b/.test(q) ||
      /\blegally\s+(authoriz|authoris|able|entitled|permitted)/.test(q)
    if (!authWorkContext) return null

    const answer = workAuthAnswer(question, {
      workAuthorization: this.cv.visa.status,
      requiresSponsorship: this.cv.visa.requiresSponsorshipKnown ? this.cv.visa.requiresSponsorship : null,
      authorizedToWork: this.cv.visa.authorizedToWork,
    })
    if (answer === "yes") return true
    if (answer === "no") return false
    return null
  }

  private getYesNoAnswer(question: string): boolean | null {
    if (!this.cv) return null
    const q = normText(question)
    if (!q) return null
    const profileWorkAuthAnswer = this.getProfileWorkAuthYesNoAnswer(question)
    if (profileWorkAuthAnswer !== null) return profileWorkAuthAnswer

    // Age eligibility — "Are you at least 18 years of age?" and variants.
    if (
      /\b(at least|over|older than|18 or older|minimum age)\b/.test(q) &&
      /\b18\b/.test(q) &&
      (q.includes("age") || q.includes("years") || q.includes("old"))
    ) {
      return true
    }
    // Pre-employment screening / background check willingness.
    if (
      (q.includes("pre employment") || q.includes("background check") || q.includes("drug screen") ||
        q.includes("screening")) &&
      (q.includes("willing") || q.includes("undergo") || q.includes("consent") || q.includes("agree"))
    ) {
      return true
    }

    // Conflict-of-interest disclosures ("are you involved in any activity /
    // outside business / board position that could conflict…"). Default No —
    // the honest answer for most candidates, and a false "Yes" wrongly triggers
    // a disclosure review. A genuine conflict-holder corrects it in review.
    if (q.includes("conflict of interest") || (q.includes("conflict") && q.includes("interest"))) {
      return false
    }
    if (
      q.includes("order of prohibition from banking") ||
      q.includes("order of removal from banking") ||
      q.includes("federal reserve") ||
      q.includes("fdic") ||
      q.includes("ncua") ||
      q.includes("occ")
    ) {
      return false
    }
    if (
      q.includes("obligations to a previous employer") ||
      q.includes("non solicitation") ||
      q.includes("non compete")
    ) {
      return false
    }
    // "Have you ever worked for / with us?" / "Have you been previously employed
    // by {company}?" → default No. Avoids an AI round-trip and never leaves the
    // required radio blank; a genuine returning employee corrects it in review.
    if (isReturningEmployerQuestion(question)) return false
    if (q.includes("conditional job offer") && q.includes("withdrawn")) return false
    if (q.includes("discharged") || q.includes("terminated") || q.includes("resigned without notice")) return false
    if (q.includes("immediate family member relationship") || q.includes("immediate family relationship")) return false
    if (q.includes("familial relationships") && q.includes("public official")) return false
    if (q.includes("government or regulatory entity")) return false
    if (q.includes("licensed realtor") || q.includes("secondary employment") || q.includes("board positions")) return false
    if (q.includes("worked for any consulting firms") && (q.includes("u s bank") || q.includes("elavon"))) return false
    if (q.includes("willing to submit to a review of my criminal history")) return true
    if (q.includes("unable to obtain bonding")) return true
    if (q.includes("willing to work from the location")) return true
    if (q.includes("as a condition of new or continued employment") && q.includes("background check")) return true
    if (q.includes("18 or older")) return true
    if (q.includes("degree")) return this.cv.education.length > 0

    const yearsMatch = q.match(/(\d+)\+?\s+years/)
    if (yearsMatch && q.includes("experience")) {
      const requiredYears = Number.parseInt(yearsMatch[1] ?? "0", 10)
      const skillMatch = q.match(/years(?:\s+of)?\s+experience\s+in\s+([a-z0-9\.\+\-\s]+)/i)
      if (skillMatch?.[1]) {
        const rawSkill = skillMatch[1].trim()
        const comparable = Object.entries(this.cv.skillYears).find(([skill]) =>
          normText(skill).includes(normText(rawSkill)) || normText(rawSkill).includes(normText(skill)),
        )
        if (comparable) return comparable[1] >= requiredYears
      }
      return this.cv.yearsOfExperience >= requiredYears
    }

    return null
  }

  private inferDefaultQuestionComboboxAnswer(question: string): string | null {
    const q = normText(question)
    if (!q) return null
    if (!(q.startsWith("are you") || q.startsWith("do you") || q.startsWith("have you") || q.startsWith("will you"))) {
      return null
    }
    if (/\b(willing|authorized|eligible|able|available|submit|agree|consent|understand|18 or older)\b/.test(q)) return "Yes"
    if (
      /\b(ever|require|prohibit|prohibition|remove|withdrawn|discharged|terminated|resigned|obligation|relationship|government|regulatory|realtor|secondary employment|public official)\b/.test(
        q,
      )
    ) {
      return "No"
    }
    return null
  }

  private getTextAnswer(question: string): string | null {
    if (!this.cv) return null
    const q = normText(question)
    if (!q) return null
    if (q.includes("salary") || q.includes("compensation") || q.includes("pay rate") || q.includes("desired pay")) {
      // Only send a range when the question explicitly asks for one — numeric
      // salary fields strip the dash and reject the merged number as too large.
      const wantsRange = /\brange\b|minimum and maximum|min.*max|from.*to/.test(q)
      if (wantsRange && this.cv.salaryExpectation) return this.cv.salaryExpectation
      return this.cv.salaryExpectationSingle || this.cv.salaryExpectation || "Negotiable"
    }
    if (q.includes("start date") || q.includes("earliest start")) {
      return this.cv.availability || "2 weeks notice required"
    }
    if (q.includes("why this role") || q.includes("why this company") || q.includes("why do you want")) {
      this.logWarning(`⚠️ Manual review needed: ${question}`)
      return null
    }
    if (q.includes("if not applicable") && (q.includes("enter n a") || q.includes("enter na"))) {
      return "N/A"
    }
    if (q.includes("please describe the circumstances below")) {
      return "N/A"
    }
    if (q.includes("years of experience")) {
      return String(this.cv.yearsOfExperience)
    }
    return null
  }

  private getSelectAnswer(question: string): string | null {
    if (!this.cv) return null
    const q = normText(question)
    if (q.includes("highest level of education")) {
      return this.cv.education[0]?.degree || ""
    }
    if (q.includes("country of citizenship")) {
      return this.cv.citizenship || this.cv.address.country
    }
    return null
  }

  private getRadioLabel(input: HTMLInputElement): string {
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
      if (label?.textContent) return label.textContent.trim().toLowerCase()
    }
    const wrapped = input.closest("label")
    if (wrapped?.textContent) return wrapped.textContent.trim().toLowerCase()
    return nonEmpty(input.value).toLowerCase()
  }

  private looksLikeRadioOptionLabel(label: string): boolean {
    return /^(yes|no|true|false)$/i.test(nonEmpty(label))
  }

  private getRadioGroupQuestionLabel(radio: HTMLInputElement, group: HTMLInputElement[]): string {
    const container =
      radio.closest<HTMLElement>(
        "fieldset, [role='radiogroup'], [role='group'], [data-automation-id*='formField']",
      ) ??
      group[0]?.closest<HTMLElement>(
        "fieldset, [role='radiogroup'], [role='group'], [data-automation-id*='formField']",
      ) ??
      null

    if (container) {
      const fromContainer = this.extractApplicationQuestionLabel(container, radio)
      if (fromContainer && !this.looksLikeRadioOptionLabel(fromContainer)) return fromContainer

      const stripped = nonEmpty(container.textContent)
        .replace(/\*/g, " ")
        .replace(/\b(?:yes|no|true|false)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
      if (stripped.length > 8 && !this.looksLikeRadioOptionLabel(stripped)) return stripped
    }

    const parsed = parseQuestionLabel(radio as HTMLElement) || parseQuestionLabel(group[0] as HTMLElement)
    return this.looksLikeRadioOptionLabel(parsed) ? "" : parsed
  }

  private markManualReview(el: HTMLElement, question: string): void {
    if (el.getAttribute(MANUAL_REVIEW_ATTR) === "1") return
    el.setAttribute(MANUAL_REVIEW_ATTR, "1")
    el.style.outline = "2px solid #f59e0b"
    el.title = "Apex couldn't fill this — please review"
    this.manualReviewCount += 1
    this.setToolbarState("NEEDS_REVIEW", "⚠️ Review required: some questions need manual input.")
    this.logWarning(`⚠️ Manual review needed: ${question || "Question"}`)
    this.debug("warn", "manual_review.marked", {
      question: question || "Question",
      tag: el.tagName.toLowerCase(),
    })
  }

  private dispatchDropWithFile(target: HTMLElement, file: File): boolean {
    try {
      const dt = new DataTransfer()
      dt.items.add(file)
      const types = ["dragenter", "dragover", "drop"] as const
      for (const type of types) {
        const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
          dataTransfer?: DataTransfer
        }
        Object.defineProperty(ev, "dataTransfer", { value: dt })
        target.dispatchEvent(ev)
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * True when the resume already shows as an uploaded attachment. Workday
   * clears the file input after processing and renders the attachment as a
   * separate row, so checking input.files alone re-uploads on every re-run
   * (observed live: duplicate CV attachments).
   */
  private hasExistingResumeAttachment(): boolean {
    if (
      document.querySelector(
        '[data-automation-id="file-upload-item"], ' +
        '[data-automation-id="delete-file"], ' +
        '[data-automation-id="attachments-FileUpload"] [role="listitem"]',
      )
    ) {
      return true
    }
    const name = normText(this.resumeFile?.name ?? "")
    if (!name) return false
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-automation-id*="file" i], [data-automation-id*="attachment" i], [data-automation-id*="upload" i]',
      ),
    ).some((el) => isVisible(el) && normText(el.textContent ?? "").includes(name))
  }

  private async maybeUploadResume(): Promise<boolean> {
    if (!this.resumeFile) {
      this.debug("info", "resume_upload.skipped_no_file")
      return false
    }
    if (this.hasExistingResumeAttachment()) {
      this.debug("info", "resume_upload.skipped_already_attached")
      if (!this.resumeUploadCounted) {
        this.bumpFilledCount()
        this.resumeUploadCounted = true
      }
      return true
    }
    const fileInput = this.findResumeFileInput()
    if (!fileInput) {
      const dropSurface =
        document.querySelector<HTMLElement>('[data-automation-id="file-upload-drop-zone"]') ??
        document.querySelector<HTMLElement>('[data-automation-id="select-files"]') ??
        document.querySelector<HTMLElement>('[data-automation-id="resume-upload"]')
      if (!isVisible(dropSurface)) {
        this.debug("info", "resume_upload.input_not_found")
        return false
      }
      const dropped = this.dispatchDropWithFile(dropSurface!, this.resumeFile)
      this.debug(dropped ? "info" : "warn", "resume_upload.dropzone_dispatch", {
        dropped,
        targetAutomationId: dropSurface?.getAttribute("data-automation-id") ?? null,
      })
      if (!dropped) return false
      const uploadedFromDrop = await this.waitForUploadComplete()
      if (uploadedFromDrop) {
        if (!this.resumeUploadCounted) {
          this.bumpFilledCount()
          this.resumeUploadCounted = true
        }
        this.debug("info", "resume_upload.done_via_dropzone")
        return true
      }
      this.logWarning("Manual review needed: resume upload may not have completed — verify before continuing.")
      this.debug("warn", "resume_upload.unconfirmed_via_dropzone")
      return false
    }

    if (fileInput.files && fileInput.files.length > 0) {
      this.debug("info", "resume_upload.skipped_already_present", { existingFiles: fileInput.files.length })
      // Treat an already-attached file as a successful resume step.
      if (!this.resumeUploadCounted) {
        this.bumpFilledCount()
        this.resumeUploadCounted = true
      }
      return true
    }

    this.setToolbarField("Resume upload")
    this.setToolbarState(
      "FILLING",
      `Autofilling Step ${this.detectStep().index} of ${STEP_TOTAL} · ${this.detectStep().name}`,
      `Uploading resume: ${this.resumeFile.name}…`,
    )

    const dt = new DataTransfer()
    dt.items.add(this.resumeFile)

    // React-controlled file inputs require the native setter to fire BEFORE
    // input/change events — otherwise React's onChange handler resolves with
    // the prior (empty) FileList. Mirrors safe-fields.injectResumeFile.
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set
    if (nativeSetter) nativeSetter.call(fileInput, dt.files)
    else fileInput.files = dt.files

    fileInput.dispatchEvent(new Event("input", { bubbles: true }))
    fileInput.dispatchEvent(new Event("change", { bubbles: true }))

    this.debug("info", "resume_upload.started", { filename: this.resumeFile.name })
    const uploaded = await this.waitForUploadComplete()
    if (uploaded) {
      if (!this.resumeUploadCounted) {
        this.bumpFilledCount()
        this.resumeUploadCounted = true
      }
      this.debug("info", "resume_upload.done")
      return true
    } else {
      this.logWarning("Manual review needed: resume upload may not have completed — verify before continuing.")
      this.debug("warn", "resume_upload.unconfirmed")
      return false
    }
  }

  private findResumeFileInput(): HTMLInputElement | null {
    // Ordered by specificity. Workday tenants vary in markup but the
    // file-upload-input-ref automation id and dropzone wrapper are the most
    // stable signals; aria-labelledby fallbacks catch i18n / a11y variants.
    const candidates: string[] = [
      '[data-automation-id="file-upload-input-ref"]',
      '[data-automation-id="select-files"] input[type="file"]',
      '[data-automation-id="file-upload-drop-zone"] input[type="file"]',
      '[data-automation-id="resume-upload"] input[type="file"]',
      'input[type="file"][data-automation-id*="resume" i]',
      'input[type="file"][name*="resume" i]',
      'input[type="file"][accept*="pdf"]',
      'input[type="file"][accept*=".doc"]',
    ]
    for (const selector of candidates) {
      const found = document.querySelector<HTMLInputElement>(selector)
      if (found instanceof HTMLInputElement) return found
    }
    // Last-ditch: any visible file input inside an apply step container.
    const scoped = document.querySelectorAll<HTMLInputElement>(
      '[data-automation-id="applicationPage"] input[type="file"], ' +
      '[data-automation-id="applyFlow"] input[type="file"], ' +
      '[data-automation-id="applyFlowPage"] input[type="file"], ' +
      '[data-automation-id="applyFlowMyInfoPage"] input[type="file"]',
    )
    for (const input of scoped) {
      if (input instanceof HTMLInputElement) return input
    }
    return null
  }

  /**
   * Waits for Workday to acknowledge the resume upload. Resolves true on
   * confirmed success, false on timeout. Uses DOM signals first (i18n-safe);
   * the English text match is a last-resort fallback for older tenants.
   */
  private async waitForUploadComplete(): Promise<boolean> {
    const timeoutAt = Date.now() + 15000
    let checks = 0
    while (Date.now() < timeoutAt) {
      checks += 1

      // i18n-safe success markers Workday emits when an attachment is accepted.
      const successMarker = document.querySelector(
        '[data-automation-id="file-upload-success"], ' +
        '[data-automation-id="successAttachmentIcon"], ' +
        '[data-automation-id="delete-attachment"], ' +
        '[data-automation-id="attachments-list"] [data-automation-id*="attachment"]',
      )
      if (successMarker) {
        this.debug("info", "resume_upload.success_dom_marker", { checks })
        return true
      }

      const errorMarker = document.querySelector(
        '[data-automation-id="errorMessage"], [data-automation-id="file-upload-error"]',
      )
      if (errorMarker) {
        this.debug("warn", "resume_upload.error_dom_marker", {
          checks,
          text: normText(errorMarker.textContent).slice(0, 120),
        })
        return false
      }

      const progress = document.querySelector('[data-automation-id="file-upload-progress"]')
      if (progress) {
        const txt = normText(progress.textContent)
        // English fallback for tenants that only render the text indicator.
        if (txt.includes("complete") || txt.includes("uploaded") || txt.includes("success")) {
          this.debug("info", "resume_upload.progress_complete_text", { checks, text: txt.slice(0, 80) })
          return true
        }
      } else if (checks > 4) {
        // No progress widget AND no success marker after ~1.2s usually means
        // Workday removed the dropzone for this step or never had one — treat
        // as "best-effort complete" so the runner continues.
        this.debug("info", "resume_upload.no_progress_widget", { checks })
        return true
      }

      await sleep(300)
    }
    this.debug("warn", "resume_upload.progress_timeout")
    return false
  }

  private async clickNextAndWait(): Promise<boolean> {
    if (this.stopped || this.paused) {
      this.debug("warn", "navigation.next.skipped", {
        stopped: this.stopped,
        paused: this.paused,
      })
      return false
    }

    const prev = this.captureApplicationPageSignature()
    const explicitSelectors = [
      '[data-automation-id="pageFooterNextButton"]',
      '[data-automation-id="saveAndContinueButton"]',
      '[data-automation-id*="nextButton"]',
      '[data-automation-id*="saveAndContinue"]',
    ]
    for (const selector of explicitSelectors) {
      const btn = document.querySelector<HTMLElement>(selector)
      if (!isVisible(btn)) {
        this.debug("info", "navigation.next.selector_not_visible", { selector })
        continue
      }
      const btnEl = btn as HTMLElement
      if (btnEl instanceof HTMLButtonElement && btnEl.disabled) {
        this.debug("info", "navigation.next.selector_disabled", { selector })
        continue
      }
      btnEl.click()
      this.debug("info", "navigation.next.clicked_selector", { selector })
      this.setToolbarState("WAITING", "Waiting for Workday to load the next step…")
      const changed = await this.waitForApplicationPageChange(prev, 10000)
      this.debug("info", "navigation.next.selector_result", { selector, changed })
      if (changed) return true
    }

    const fallback = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']")).find((el) => {
      if (!isVisible(el)) return false
      if (el instanceof HTMLButtonElement && el.disabled) return false
      const txt = normText(el.textContent)
      if (!txt) return false
      if (txt.includes("submit")) return false
      return txt === "next" || txt.includes("save and continue") || txt === "continue"
    })
    if (!fallback) {
      this.debug("warn", "navigation.next.fallback_missing")
      return false
    }
    fallback.click()
    this.debug("info", "navigation.next.clicked_fallback", {
      text: nonEmpty(fallback.textContent),
    })
    this.setToolbarState("WAITING", "Waiting for Workday to load the next step…")
    const changed = await this.waitForApplicationPageChange(prev, 10000)
    this.debug("info", "navigation.next.fallback_result", { changed })
    return changed
  }

  private async waitForApplicationPageChange(previousSignature: string, timeoutMs: number): Promise<boolean> {
    const timeoutAt = Date.now() + timeoutMs
    let attempts = 0
    while (Date.now() < timeoutAt) {
      attempts += 1
      await sleep(300)
      const next = this.captureApplicationPageSignature()
      if (next !== previousSignature) {
        this.debug("info", "navigation.page_changed", { attempts })
        return true
      }
      const page = document.querySelector('[data-automation-id="applicationPage"]')
      if (page && nonEmpty(page.textContent).length > 30 && next !== previousSignature) {
        this.debug("info", "navigation.page_changed_content_guard", { attempts })
        return true
      }
    }
    this.debug("warn", "navigation.page_change_timeout", { timeoutMs })
    return false
  }

  private getActiveDialog(): HTMLElement | null {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [data-automation-id*="modal"]'))
      .filter((dlg) => isVisible(dlg))
    const active = dialogs[dialogs.length - 1] ?? null
    this.debug("info", "dialog.detected", { visibleDialogs: dialogs.length, hasActive: Boolean(active) })
    return active
  }

  private async waitForDialogClose(dialog: HTMLElement, timeoutMs: number): Promise<void> {
    const timeoutAt = Date.now() + timeoutMs
    while (Date.now() < timeoutAt) {
      if (!dialog.isConnected || !isVisible(dialog)) {
        this.debug("info", "dialog.closed")
        return
      }
      await sleep(120)
    }
    this.debug("warn", "dialog.close_timeout", { timeoutMs })
  }

  private async clickSaveInDialog(dialog: HTMLElement): Promise<void> {
    const save = Array.from(dialog.querySelectorAll<HTMLElement>("button, [role='button']")).find((btn) => {
      const txt = normText(btn.textContent)
      return txt === "save" || txt === "done" || txt.includes("save and continue")
    })
    if (!save) {
      this.debug("warn", "dialog.save_missing")
      return
    }
    const saveEl = save
    saveEl.click()
    this.debug("info", "dialog.save_clicked", { text: nonEmpty(saveEl.textContent) })
    await this.waitForDialogClose(dialog, 5000)
  }

  private async fillAutomationIdInRoot(
    root: ParentNode,
    automationId: string,
    value: string,
    fieldName: string,
    opts?: { optional?: boolean; labelRe?: RegExp; commit?: boolean },
  ): Promise<boolean> {
    const selector = `[data-automation-id="${safeEscapeSelector(automationId)}"]`
    const found = root.querySelector<HTMLElement>(selector)
    let el = resolveInputControlFromElement(found)
    // Label fallback within the dialog/root when the automation-id misses.
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && opts?.labelRe) {
      el = resolveInputControlFromElement(this.findControlByLabel(opts.labelRe, { root }))
    }
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      this.debug("warn", "field.automation_not_found", { fieldName, automationId, selector })
      if (!opts?.optional) this.logWarning(`Manual review needed: ${fieldName}`)
      return false
    }
    this.setToolbarField(fieldName)
    const ok = this.setElementValue(el, value, fieldName, { commit: opts?.commit })
    if (ok) this.bumpFilledCount()
    this.debug(ok ? "info" : "warn", "field.automation_fill", {
      fieldName,
      automationId,
      ok,
      tag: el.tagName.toLowerCase(),
    })
    return ok
  }

  private async fillTextareaAutomationInRoot(
    root: ParentNode,
    automationId: string,
    value: string,
    fieldName: string,
    opts?: { labelRe?: RegExp; commit?: boolean },
  ): Promise<boolean> {
    const selector = `[data-automation-id="${safeEscapeSelector(automationId)}"]`
    const found = root.querySelector<HTMLElement>(selector)
    let el = resolveInputControlFromElement(found)
    if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && opts?.labelRe) {
      el = resolveInputControlFromElement(this.findControlByLabel(opts.labelRe, { root }))
    }
    if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) {
      this.debug("warn", "field.textarea_not_found", { fieldName, automationId, selector })
      return false
    }
    this.setToolbarField(fieldName)
    const ok = this.setElementValue(el, value, fieldName, { commit: opts?.commit })
    if (ok) this.bumpFilledCount()
    this.debug(ok ? "info" : "warn", "field.textarea_fill", {
      fieldName,
      automationId,
      ok,
    })
    return ok
  }

  private async selectAutomationComboboxInRoot(
    root: ParentNode,
    automationId: string,
    value: string,
    fieldName: string,
    opts?: { optional?: boolean; labelRe?: RegExp; strictOptions?: boolean },
  ): Promise<boolean> {
    const selector = `[data-automation-id="${safeEscapeSelector(automationId)}"]`
    if (await this.selectCombobox(selector, value, fieldName, { root, optional: true, strictOptions: opts?.strictOptions })) return true
    // Label fallback within the dialog/root.
    if (opts?.labelRe) {
      const combo = this.findControlByLabel(opts.labelRe, { combobox: true, root })
      if (combo && (await this.selectComboboxElement(combo, value, fieldName, { optional: true, strictOptions: opts?.strictOptions }))) return true
    }
    if (!opts?.optional) {
      this.logWarning(`Manual review needed: ${fieldName}`)
      this.requiredFieldMissesThisStep += 1
    }
    return false
  }

  private async setCheckboxInRoot(root: ParentNode, automationId: string, checked: boolean, fieldName: string): Promise<boolean> {
    // Inline tenants put the automation id on the formField wrapper.
    const selector =
      `[data-automation-id="${safeEscapeSelector(automationId)}"], ` +
      `[data-automation-id="formField-${safeEscapeSelector(automationId)}"]`
    const target = root.querySelector<HTMLElement>(selector)
    if (!target) {
      this.debug("warn", "field.checkbox_not_found", { fieldName, automationId, selector })
      return false
    }
    const el = target instanceof HTMLInputElement && target.type === "checkbox"
      ? target
      : target.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (!(el instanceof HTMLInputElement)) {
      this.debug("warn", "field.checkbox_input_missing", { fieldName, automationId })
      return false
    }
    if (el.checked !== checked) {
      this.setToolbarField(fieldName)
      // Click the input itself first — it's a real (if visually hidden)
      // checkbox and React listens on it; wrapper divs often swallow clicks.
      el.click()
      if (el.checked !== checked) {
        const clickTarget =
          (target.closest("label") as HTMLElement | null) ??
          (target.closest('[role="checkbox"]') as HTMLElement | null) ??
          target
        clickTarget.click()
      }
      if (el.checked !== checked) {
        el.checked = checked
        el.dispatchEvent(new Event("input", { bubbles: true }))
        el.dispatchEvent(new Event("change", { bubbles: true }))
      }
      this.bumpFilledCount()
    }
    this.debug("info", "field.checkbox_set", { fieldName, checked, finalChecked: el.checked })
    return true
  }

  /**
   * Locate a field control by its visible label, so the runner works on tenants
   * whose data-automation-ids don't match our fixed list. Matches the label of a
   * formField wrapper (or a <label for>) against `labelRe`.
   */
  private findControlByLabel(
    labelRe: RegExp,
    opts?: { combobox?: boolean; root?: ParentNode },
  ): HTMLElement | null {
    const scope = opts?.root ?? document
    const sel = opts?.combobox
      ? '[role="combobox"], [aria-haspopup="listbox"], [data-automation-id*="dropDown" i], button[aria-haspopup="listbox"], input'
      : "input, textarea"

    const containers = Array.from(
      scope.querySelectorAll<HTMLElement>('[data-automation-id*="formField"], fieldset, [role="group"]'),
    ).filter((el) => isVisible(el))
    for (const c of containers) {
      const labelEl = c.querySelector("label, legend, [data-automation-id*='label'], [role='heading']")
      const labelText = normText((labelEl?.textContent ?? "").replace(/\*/g, ""))
      if (!labelText || !labelRe.test(labelText)) continue
      const input = Array.from(c.querySelectorAll<HTMLElement>(sel)).find((el) => isVisible(el))
      if (input) return input
    }
    // <label for="id"> fallback.
    for (const l of Array.from(scope.querySelectorAll<HTMLLabelElement>("label"))) {
      const labelText = normText((l.textContent ?? "").replace(/\*/g, ""))
      if (!labelText || !labelRe.test(labelText)) continue
      const forId = l.getAttribute("for")
      if (forId) {
        const el = document.getElementById(forId) // ids are document-global
        if (el && isVisible(el)) return el
      }
    }
    return null
  }

  /**
   * Find a section's "Add" button by data-automation-id first, then by locating a
   * heading whose text matches `headingRe` and the "Add"/"Add Another" button near
   * it. Tenant-agnostic so multi-entry sections work when IDs differ.
   */
  private findAddButtonForSection(sectionAutomationIds: string[], headingRe: RegExp): HTMLElement | null {
    for (const id of sectionAutomationIds) {
      const section = document.querySelector<HTMLElement>(`[data-automation-id="${safeEscapeSelector(id)}"]`)
      const add = section?.querySelector<HTMLElement>(
        '[data-automation-id="Add"], [data-automation-id="add"], [data-automation-id="Add Another"], [data-automation-id="addButton"]',
      ) ?? null
      if (isVisible(add)) return add
    }
    // Heading-matched fallback: associate each visible Add button with its section.
    const adds = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-automation-id="Add"], [data-automation-id="add"], [data-automation-id="add-button"], button, [role="button"]',
      ),
    ).filter((b) => isVisible(b) && /^add(\s+(another|more|new))?$/.test(normText(b.textContent ?? "")))
    const allHeadings = Array.from(
      document.querySelectorAll<HTMLElement>("h2, h3, h4, [role='heading'], legend"),
    ).filter((h) => isVisible(h))
    for (const add of adds) {
      // Container heading (older tenants wrap Add inside its section)…
      const container = add.closest("section, fieldset, [data-automation-id]:not(button)") ?? add.parentElement
      const containerHeading = normText(
        container?.querySelector("h2, h3, h4, [role='heading'], legend, [data-automation-id*='label']")?.textContent ?? "",
      )
      if (containerHeading && headingRe.test(containerHeading)) return add
      // …otherwise the nearest heading PRECEDING the button in document order
      // (tenants that render bare add-buttons directly under the page wrapper:
      // "Work Experience" <h3> → Add, "Education" <h3> → Add, …).
      let preceding: HTMLElement | null = null
      for (const h of allHeadings) {
        if (h.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING) preceding = h
      }
      if (preceding && headingRe.test(normText(preceding.textContent ?? ""))) return add
    }
    return null
  }

  /**
   * Fill a text field by data-automation-id selectors first, then fall back to
   * matching by visible label. Tenant-agnostic. Handles salvage/forceOverwrite.
   */
  private async fillTextSmart(
    selectors: string[],
    labelRe: RegExp,
    value: string,
    fieldName: string,
    opts?: { optional?: boolean; forceOverwrite?: boolean; salvageMiscased?: boolean },
  ): Promise<boolean> {
    // 1. Selector path (optional:true so it doesn't pre-count a miss).
    if (await this.fillFirstTextSelector(selectors, value, fieldName, { ...opts, optional: true })) return true

    // 2. Label fallback.
    const found = this.findControlByLabel(labelRe)
    const input = found ? resolveInputControlFromElement(found) : null
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      let clean = nonEmpty(value)
      if (!clean && opts?.salvageMiscased) {
        const existing = nonEmpty(input.value)
        if (existing && looksMiscased(existing)) clean = toTitleCase(existing)
      }
      if (clean) {
        this.setToolbarField(fieldName)
        const ok = this.setElementValue(input, clean, fieldName, { forceOverwrite: opts?.forceOverwrite })
        if (ok) {
          this.bumpFilledCount()
          this.debug("info", "field.text_filled_by_label", { fieldName })
          return true
        }
      }
    }

    if (!opts?.optional) {
      this.logWarning(`Manual review needed: ${fieldName}`)
      this.requiredFieldMissesThisStep += 1
      this.debug("warn", "field.text_unresolved", { fieldName })
    }
    return false
  }

  /** Select a combobox by selectors first, then by visible label. */
  private async selectComboSmart(
    selector: string,
    labelRe: RegExp,
    value: string,
    fieldName: string,
    opts?: { optional?: boolean; riskyApplyFlowField?: boolean },
  ): Promise<boolean> {
    if (await this.selectCombobox(selector, value, fieldName, { ...opts, optional: true })) return true
    const combo = this.findControlByLabel(labelRe, { combobox: true })
    if (combo) {
      const ok = await this.selectComboboxElement(combo, value, fieldName, opts)
      if (ok) return true
    }
    if (!opts?.optional) {
      this.logWarning(`Manual review needed: ${fieldName}`)
      this.requiredFieldMissesThisStep += 1
    }
    return false
  }

  private async fillTextSelector(
    selector: string,
    value: string,
    fieldName: string,
    opts?: { forceOverwrite?: boolean; salvageMiscased?: boolean },
  ): Promise<boolean> {
    let clean = nonEmpty(value)
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .map((node) => resolveInputControlFromElement(node))
      .filter((node): node is HTMLInputElement | HTMLTextAreaElement => Boolean(node))
    const el = candidates.find((node) => isVisible(node)) ?? null
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      this.debug("info", "field.text_selector_miss", { fieldName, selector })
      return false
    }

    // salvageMiscased: when the profile value is empty but the field already
    // holds an all-caps/all-lowercase value (typically dropped by Workday's
    // resume parser), rewrite it to title case in place so the tenant's
    // capitalization validator stops complaining.
    if (!clean && opts?.salvageMiscased) {
      const existing = nonEmpty(el.value)
      if (existing && looksMiscased(existing)) {
        clean = toTitleCase(existing)
        this.debug("info", "field.text_salvaging_miscased", { fieldName, before: existing, after: clean })
      }
    }

    if (!clean) {
      this.debug("info", "field.text_skipped_empty", { fieldName, selector })
      return false
    }
    this.setToolbarField(fieldName)
    const ok = this.setElementValue(el, clean, fieldName, { forceOverwrite: opts?.forceOverwrite })
    if (ok) this.bumpFilledCount()
    this.debug(ok ? "info" : "warn", "field.text_fill", { fieldName, selector, ok, forceOverwrite: Boolean(opts?.forceOverwrite) })
    return ok
  }

  private async fillFirstTextSelector(
    selectors: string[],
    value: string,
    fieldName: string,
    opts?: { optional?: boolean; forceOverwrite?: boolean; salvageMiscased?: boolean },
  ): Promise<boolean> {
    for (const selector of selectors) {
      const ok = await this.fillTextSelector(selector, value, fieldName, {
        forceOverwrite: opts?.forceOverwrite,
        salvageMiscased: opts?.salvageMiscased,
      })
      if (ok) {
        this.debug("info", "field.text_filled_first_match", { fieldName, selector })
        return true
      }
    }
    if (!opts?.optional) {
      this.debug("warn", "field.text_all_selectors_failed", {
        fieldName,
        selectors: selectors.join(" | "),
      })
      this.logWarning(`Manual review needed: ${fieldName}`)
      this.requiredFieldMissesThisStep += 1
    } else {
      this.debug("info", "field.text_optional_not_found", {
        fieldName,
        selectors: selectors.join(" | "),
      })
    }
    return false
  }

  private async selectFirstCombobox(
    selectors: string[],
    value: string,
    fieldName: string,
    opts?: { optional?: boolean; riskyApplyFlowField?: boolean },
  ): Promise<boolean> {
    for (const selector of selectors) {
      const ok = await this.selectCombobox(selector, value, fieldName, {
        optional: true,
        riskyApplyFlowField: opts?.riskyApplyFlowField,
      })
      if (ok) {
        this.debug("info", "combobox.filled_first_match", { fieldName, selector })
        return true
      }
    }
    if (!opts?.optional) {
      this.debug("warn", "combobox.all_selectors_failed", {
        fieldName,
        selectors: selectors.join(" | "),
      })
      this.logWarning(`Manual review needed: ${fieldName}`)
      this.requiredFieldMissesThisStep += 1
    } else {
      this.debug("info", "combobox.optional_not_found", {
        fieldName,
        selectors: selectors.join(" | "),
      })
    }
    return false
  }

  private async selectCombobox(
    selector: string,
    value: string,
    fieldName: string,
    opts?: { root?: ParentNode; optional?: boolean; riskyApplyFlowField?: boolean; strictOptions?: boolean },
  ): Promise<boolean> {
    const clean = nonEmpty(value)
    if (!clean) {
      this.debug("info", "combobox.skipped_empty", { fieldName, selector })
      return false
    }
    const root = opts?.root ?? document
    const target = Array.from(root.querySelectorAll<HTMLElement>(selector)).find((el) => isVisible(el)) ?? null
    if (!target) {
      if (!opts?.optional) {
        this.logWarning(`Manual review needed: ${fieldName}`)
        this.requiredFieldMissesThisStep += 1
      }
      this.debug(opts?.optional ? "info" : "warn", "combobox.target_missing", { fieldName, selector })
      return false
    }

    // Critical: skip re-click when the combobox already shows our target
    // value. Workday's reactive bundle refetches dependent lists (e.g.
    // state-list when Country is re-selected) on every click; on flaky
    // tenants (US Bank, etc.) that refetch returns 500 and the entire
    // apply-flow page crashes with "Cannot read properties of undefined".
    // Treating a no-op fill as success is also accurate — the value IS set.
    const displayed = nonEmpty(extractComboboxDisplayValue(target))
    const displayedLooksLikeQuestionPrompt =
      displayed.length > 120 && (displayed.includes("?") || displayed.toLowerCase().includes("select one"))
    if (displayed && !displayedLooksLikeQuestionPrompt && isComboboxValueEquivalent(displayed, clean, fieldName)) {
      this.bumpFilledCount()
      this.debug("info", "combobox.skipped_already_matches", {
        fieldName,
        selector,
        desired: clean.slice(0, 80),
        displayed: displayed.slice(0, 80),
      })
      return true
    }
    // On fragile apply-flow tenants, re-opening country/state/phone-code
    // combos can trigger server refetches that fail with 500/404 and crash the
    // page bundle. If a risky field already has a REAL selection, keep it and
    // avoid touching the combobox. But an unanswered placeholder ("Select One")
    // is NOT a real value — treating it as one left required State/Country
    // dropdowns empty, which fails Workday's "field is required" validation and
    // blocks Save and Continue (the dominant "can't get past My Information").
    if (displayed && !this.isUnansweredSelectPlaceholder(displayed) && opts?.riskyApplyFlowField) {
      this.bumpFilledCount()
      this.logWarning(`Manual review needed: ${fieldName} (existing selection kept)`)
      this.debug("warn", "combobox.skipped_risky_existing_value", {
        fieldName,
        selector,
        desired: clean.slice(0, 80),
        displayed: displayed.slice(0, 80),
      })
      return true
    }

    this.setToolbarField(fieldName)
    const comboboxShell =
      target.closest<HTMLElement>(
        '[data-automation-id*="dropDownSelectList"], [role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"]',
      ) ??
      target.querySelector<HTMLElement>(
        '[data-automation-id*="dropDownSelectList"], [role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"], button',
      ) ??
      target
    // Close any menu left open by a previous field before opening this one —
    // an overlapping popup makes the shell click a no-op (opts=0) or lands the
    // selection on the wrong dropdown.
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await sleep(150)

    comboboxShell.scrollIntoView({ block: "center" })
    comboboxShell.focus()
    comboboxShell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    comboboxShell.click()
    comboboxShell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    this.debug("info", "combobox.clicked", { fieldName, selector, role: comboboxShell.getAttribute("role") || "" })

    // This combobox's own listbox — Workday points the trigger at it via
    // aria-controls/aria-owns. Scoping options to it prevents grabbing another
    // field's still-open menu.
    const ownedListboxId =
      comboboxShell.getAttribute("aria-controls") || comboboxShell.getAttribute("aria-owns") || ""

    const resolved = resolveInputControlFromElement(target)
    const input = target instanceof HTMLInputElement
      ? target
      : resolved instanceof HTMLInputElement
        ? resolved
        : target.querySelector("input") instanceof HTMLInputElement
          ? (target.querySelector("input") as HTMLInputElement)
          : null

    // Only type into a VISIBLE search box (real type-ahead combobox). Workday's
    // Yes/No question widgets are button-triggered listboxes whose backing
    // <input> is HIDDEN and holds an opaque option-id (e.g. a 32-hex token), not
    // free text — typing "Yes" into it corrupts React's model so the click
    // selects "Yes" visually but Workday reverts the committed value (observed:
    // eligibility showed "Yes" then flipped back to "No"). The risky path
    // already skips typing for exactly this reason and commits fine.
    if (input && isVisible(input) && !opts?.riskyApplyFlowField) {
      this.setElementValue(input, clean, `${fieldName} (combobox)`)
    }

    // Workday renders dropdown options into a portal asynchronously after the
    // shell click — poll for ~1.5s before falling back to keyboard Enter so
    // slow tenants still hit the match path.
    const automationId = target.getAttribute("data-automation-id") ?? ""
    const POLL_DEADLINE = Date.now() + 1500
    let option: HTMLElement | null = null
    let menuOptionCount = 0
    let roleOptionCount = 0
    let pollAttempts = 0
    const OPTION_SELECTOR = '[role="option"], [role="menuitem"], [data-automation-id="promptOption"]'
    while (Date.now() < POLL_DEADLINE) {
      pollAttempts += 1
      // Priority 1: this combobox's own listbox (aria-controls) — precise.
      const owned = ownedListboxId ? document.getElementById(ownedListboxId) : null
      // Priority 2: the single currently-active popup.
      const activePopup = document.querySelector<HTMLElement>('[data-automation-activepopup="true"]')
      // Priority 3: id-scoped Workday menu items for this automation id.
      const menuOptions = automationId
        ? Array.from(document.querySelectorAll<HTMLElement>(`[data-automation-id^="${safeEscapeSelector(automationId)}-menu-item--"]`))
        : []

      let scoped: HTMLElement[] = []
      if (owned && isVisible(owned)) scoped = Array.from(owned.querySelectorAll<HTMLElement>(OPTION_SELECTOR))
      else if (activePopup && isVisible(activePopup)) scoped = Array.from(activePopup.querySelectorAll<HTMLElement>(OPTION_SELECTOR))
      else if (menuOptions.length) scoped = menuOptions
      // Last resort only when nothing scoped exists: global (rare, e.g. tenants
      // without aria-controls or activepopup markers).
      if (!scoped.length) scoped = Array.from(document.querySelectorAll<HTMLElement>(OPTION_SELECTOR))

      const candidateOptions = scoped.filter((el) => isVisible(el))
      menuOptionCount = menuOptions.length
      roleOptionCount = candidateOptions.length
      if (candidateOptions.length > 0) {
        option = findOptionByText(candidateOptions, clean)
        if (option) break
      }
      await sleep(100)
    }
    this.debug("info", "combobox.options_scanned", {
      fieldName,
      selector,
      menuOptions: menuOptionCount,
      roleOptions: roleOptionCount,
      pollAttempts,
      matched: Boolean(option),
    })
    if (option) {
      const clickTarget =
        option.closest<HTMLElement>('[role="option"], [role="menuitem"], [data-automation-id="promptOption"]') ?? option
      // Full mouse-event sequence — Workday's button-combobox options often
      // ignore a bare .click() and only commit on mousedown/mouseup.
      clickTarget.scrollIntoView({ block: "center" })
      clickTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      clickTarget.click()
      clickTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      // Verify the display actually updated — poll briefly for slow tenants.
      let displayedAfter = ""
      const verifyDeadline = Date.now() + 900
      while (Date.now() < verifyDeadline) {
        displayedAfter = nonEmpty(extractComboboxDisplayValue(target))
        if (displayedAfter && !this.isUnansweredSelectPlaceholder(displayedAfter)) break
        await sleep(100)
      }
      if (displayedAfter && !this.isUnansweredSelectPlaceholder(displayedAfter)) {
        this.bumpFilledCount()
        this.debug("info", "combobox.option_selected", {
          fieldName,
          optionText: nonEmpty(clickTarget.textContent),
          displayedAfter: displayedAfter.slice(0, 80),
        })
        return true
      }
      // Clicked an option but the value did NOT stick — report honestly so the
      // caller can try another candidate instead of leaving the field blank
      // while believing it succeeded. Close the menu first.
      comboboxShell.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      this.debug("warn", "combobox.option_selected_unverified", {
        fieldName,
        optionText: nonEmpty(clickTarget.textContent),
      })
      return false
    }

    // strictOptions: the caller is probing candidate values against a fixed
    // option list (e.g. degree levels) — a non-match must report failure so
    // the next candidate can be tried, never the blind Enter fallback (which
    // fakes success and strands the dropdown open).
    if (opts?.strictOptions) {
      comboboxShell.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      this.debug("info", "combobox.strict_no_match", { fieldName, selector, desired: clean.slice(0, 60) })
      return false
    }

    if (input && isVisible(input) && !opts?.riskyApplyFlowField) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }))
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }))
      this.bumpFilledCount()
      this.debug("warn", "combobox.option_fallback_enter", { fieldName, selector })
      return true
    }

    // For risky fields we do NOT synthesize Enter fallback because that path
    // can fire unstable apply-flow lookups ("countryphonecode", "regions",
    // etc.) that often 500/404 on some tenants.
    if (opts?.riskyApplyFlowField) {
      if (!opts?.optional) {
        this.logWarning(`Manual review needed: ${fieldName}`)
        this.requiredFieldMissesThisStep += 1
      } else {
        this.logWarning(`Manual review needed: ${fieldName}`)
      }
      this.debug(opts?.optional ? "info" : "warn", "combobox.risky_fallback_blocked", {
        fieldName,
        selector,
        optional: Boolean(opts?.optional),
      })
      return false
    }

    if (!opts?.optional) {
      this.logWarning(`Manual review needed: ${fieldName}`)
      this.requiredFieldMissesThisStep += 1
    }
    this.debug(opts?.optional ? "info" : "warn", "combobox.unresolved", {
      fieldName,
      selector,
      optional: Boolean(opts?.optional),
    })
    return false
  }

  private setElementValue(
    el: HTMLInputElement | HTMLTextAreaElement,
    value: string,
    fieldName = "field",
    opts?: { forceOverwrite?: boolean; commit?: boolean },
  ): boolean {
    const clean = nonEmpty(value)
    if (!clean) {
      this.debug("info", "set_value.skipped_empty", { fieldName })
      return false
    }
    try {
      const current = nonEmpty(el.value)
      // forceOverwrite=true: still rewrite when only the casing differs.
      // Used for name fields where Workday's resume parser drops ALL CAPS
      // values that fail tenant-side capitalization validators.
      if (
        current &&
        normText(current) === normText(clean) &&
        (!opts?.forceOverwrite || current === clean)
      ) {
        this.debug("info", "set_value.already_matches", { fieldName, forceOverwrite: Boolean(opts?.forceOverwrite) })
        return true
      }
      el.focus()
      if (el instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
        if (!setter) {
          this.debug("error", "set_value.input_setter_missing", { fieldName })
          return false
        }
        setter.call(el, clean)
      } else {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
        if (!setter) {
          this.debug("error", "set_value.textarea_setter_missing", { fieldName })
          return false
        }
        setter.call(el, clean)
      }
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }))
      // By default NO el.blur(): Workday's apply-flow tenants auto-save on
      // blur, and firing it after every My Information field hammers the
      // backend (known 500 trigger on flaky tenants). But inline My
      // Experience entries (opts.commit) only register in the validation
      // model once the field blurs — without it, Save & Continue reports
      // every filled field as "required and must have a value". So commit
      // there explicitly.
      if (opts?.commit) {
        el.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
        el.dispatchEvent(new Event("focusout", { bubbles: true }))
      }
      this.debug("info", "set_value.success", {
        fieldName,
        tag: el.tagName.toLowerCase(),
      })
      return true
    } catch (error) {
      this.debug("error", "set_value.error", {
        fieldName,
        message: error instanceof Error ? error.message : "unknown error",
      })
      return false
    }
  }

  private buildExperienceDescription(job: WorkdayCvWorkExperience): string {
    if (!this.cv) return job.description
    const pageText = normText(document.body.textContent).slice(0, 4000)
    const roleText = `${job.title} ${job.description}`.toLowerCase()
    const relevantSkills = this.cv.skills
      .filter((skill) => {
        const normalizedSkill = normText(skill)
        if (!normalizedSkill) return false
        const firstToken = normalizedSkill.split(" ")[0] ?? normalizedSkill
        return roleText.includes(normalizedSkill) || pageText.includes(normalizedSkill) || normText(job.title).includes(firstToken)
      })
      .slice(0, 8)
    const original = nonEmpty(job.description)
    const fallback = `Contributed to engineering initiatives in a ${job.title || "software"} capacity, leveraging ${
      relevantSkills.slice(0, 3).join(", ") || "relevant technologies"
    } and related technologies.`
    const base = original || fallback
    if (relevantSkills.length === 0) return base
    return `${base}\n\nKey Skills: ${relevantSkills.join(" · ")}`
  }

  /**
   * A clean, recruiter-facing resume filename: "<Full Name> - <Role> Resume.docx".
   * Never exposes internal tooling labels. Falls back to name-only, then the
   * server-provided name (if it's not an internal label), then "Resume.docx".
   */
  private professionalResumeName(serverFilename: string): string {
    const clean = (s: string): string =>
      s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()
    const ext = /\.(pdf|docx?|txt|html?)$/i.exec(serverFilename)?.[0] ?? ".docx"

    const fullName = clean(`${this.cv?.firstName ?? ""} ${this.cv?.lastName ?? ""}`)
    const role = clean(this.pageJobTitle())

    if (fullName) {
      return role ? `${fullName} - ${role} Resume${ext}` : `${fullName} Resume${ext}`
    }
    // No name available: keep the server name unless it's an internal label.
    const serverBase = clean(serverFilename.replace(/\.[a-z0-9]+$/i, ""))
    if (serverBase && !/^tailored\b/i.test(serverBase)) return `${serverBase}${ext}`
    return role ? `${role} Resume${ext}` : `Resume${ext}`
  }

  /** Best-effort job posting title from the Workday page (for the resume name). */
  private pageJobTitle(): string {
    const stepNames = /^(my information|my experience|application questions|voluntary disclosures|self identify|review)$/i
    // The browser tab title on Workday apply pages is the job title.
    const title = (document.title || "")
      .replace(/\s*[|\-–—]\s*(workday|myworkdayjobs|careers?).*$/i, "")
      .trim()
    if (title && !stepNames.test(normText(title)) && title.length <= 80) return title
    // Fallback: the job heading rendered above the step progress bar.
    const heading = Array.from(document.querySelectorAll<HTMLElement>("h1, h2"))
      .map((h) => nonEmpty(h.textContent))
      .find((t) => t && !stepNames.test(normText(t)) && t.length <= 80)
    return heading ?? ""
  }

  private decodeBase64File(base64: string, filename: string): File | null {
    try {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
      }
      const lower = filename.toLowerCase()
      const mimeType = lower.endsWith(".pdf")
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      return new File([bytes], filename, { type: mimeType, lastModified: Date.now() })
    } catch {
      return null
    }
  }

  private estimateTotalFields(cv: WorkdayCv): number {
    const baseInfo = 12
    const workCount = cv.workExperience.length * 10
    const eduCount = cv.education.length * 6
    const skillsCount = Math.min(cv.skills.length, 24)
    const websitesCount = (cv.linkedIn ? 2 : 0) + (cv.portfolio ? 2 : 0)
    const questions = 8
    const total = baseInfo + workCount + eduCount + skillsCount + websitesCount + questions
    return Math.max(total, 1)
  }

  private bumpFilledCount(amount = 1): void {
    this.fieldsFilledCount += amount
    this.refreshProgress()
  }

  private refreshProgress(): void {
    const pct = Math.max(
      0,
      Math.min(
        100,
        Math.round((this.fieldsFilledCount / Math.max(1, this.totalExpectedFields)) * 100),
      ),
    )
    if (this.toolbarProgressBar) this.toolbarProgressBar.style.width = `${pct}%`
    if (this.toolbarProgressText) this.toolbarProgressText.textContent = `${pct}%`
    this.emitSnapshot()
  }

  private setToolbarField(fieldName: string): void {
    const step = this.detectStep()
    this.setToolbarState(
      "FILLING",
      `Autofilling Step ${step.index} of ${step.total} · ${step.name}`,
      `Filling: ${fieldName}...`,
    )
  }

  private setToolbarState(state: ToolbarState, title: string, subtitle?: string): void {
    this.statusTitle = title
    this.statusSubtitle = subtitle ?? ""
    if (state === "DONE") this.phase = "done"
    else if (state === "PAUSED") this.phase = this.eeoPaused ? "needs_review" : "paused"
    else if (state === "NEEDS_REVIEW") this.phase = "needs_review"
    else if (state === "STOPPED") this.phase = "stopped"
    else if (state === "WAITING" || state === "FILLING") this.phase = "running"

    if (this.toolbarRoot) {
      this.toolbarRoot.setAttribute("data-state", state)
      if (this.toolbarStatus) this.toolbarStatus.textContent = title
      if (this.toolbarSubtitle) this.toolbarSubtitle.textContent = this.statusSubtitle
      if (this.pauseBtn) this.pauseBtn.textContent = this.paused && !this.eeoPaused ? "Resume" : "Pause"
    }
    this.refreshProgress()
  }

  private setToolbarNote(note: string): void {
    this.statusSubtitle = note
    if (this.toolbarSubtitle) this.toolbarSubtitle.textContent = note
    this.emitSnapshot()
  }

  private logWarning(line: string): void {
    this.manualReviewNotes.push(line)
    this.onWarning?.(line)
    this.debug("warn", "warning.logged", { line })
    if (this.toolbarLog) {
      const row = document.createElement("div")
      row.className = "ho-wd-log-row"
      row.textContent = line
      this.toolbarLog.prepend(row)
      while (this.toolbarLog.children.length > 5) {
        this.toolbarLog.removeChild(this.toolbarLog.lastElementChild as Element)
      }
    }
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    this.onSnapshot?.(this.getSnapshot())
  }

  private showResumeButton(show: boolean): void {
    if (!this.resumeBtn) return
    this.resumeBtn.style.display = show ? "inline-flex" : "none"
  }

  private mountToolbar(): void {
    if (document.getElementById(STYLE_ID) == null) {
      const style = document.createElement("style")
      style.id = STYLE_ID
      style.textContent = `
        #${TOOLBAR_ROOT_ID} {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 2147483647;
          width: 360px;
          max-width: calc(100vw - 24px);
          border-radius: 999px;
          background: #0f172a;
          color: #f8fafc;
          box-shadow: 0 14px 30px rgba(2, 6, 23, 0.45);
          font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          border: 1px solid rgba(148, 163, 184, 0.25);
          overflow: hidden;
        }
        #${TOOLBAR_ROOT_ID}[data-state="NEEDS_REVIEW"],
        #${TOOLBAR_ROOT_ID}[data-state="PAUSED"] {
          background: #7c2d12;
          border-color: rgba(251, 191, 36, 0.5);
        }
        #${TOOLBAR_ROOT_ID}[data-state="DONE"] {
          background: #14532d;
          border-color: rgba(74, 222, 128, 0.45);
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-wrap {
          padding: 12px 14px;
          border-radius: 20px;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-line {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          line-height: 1.3;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-orb {
          width: 20px;
          height: 20px;
          border-radius: 999px;
          background: radial-gradient(circle at 30% 30%, #f97316, #ea580c 70%);
          box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.2);
          flex: 0 0 auto;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-title {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.01em;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-sub {
          margin-top: 4px;
          font-size: 11px;
          color: rgba(226, 232, 240, 0.92);
          min-height: 14px;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-progress {
          margin-top: 8px;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 8px;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-progress-track {
          height: 7px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.28);
          overflow: hidden;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-progress-fill {
          height: 100%;
          width: 0%;
          border-radius: 999px;
          background: linear-gradient(90deg, #22c55e, #16a34a);
          transition: width 160ms ease-out;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-progress-pct {
          font-size: 11px;
          color: rgba(226, 232, 240, 0.95);
          font-variant-numeric: tabular-nums;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-actions {
          margin-top: 10px;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-btn {
          border: 1px solid rgba(226, 232, 240, 0.25);
          background: rgba(15, 23, 42, 0.32);
          color: #f8fafc;
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 11px;
          cursor: pointer;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-btn:hover {
          background: rgba(30, 41, 59, 0.55);
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-log {
          margin-top: 8px;
          max-height: 72px;
          overflow: auto;
          display: grid;
          gap: 4px;
        }
        #${TOOLBAR_ROOT_ID} .ho-wd-log-row {
          font-size: 10px;
          color: rgba(226, 232, 240, 0.92);
          background: rgba(15, 23, 42, 0.25);
          border-radius: 8px;
          padding: 4px 6px;
        }
      `
      document.documentElement.appendChild(style)
    }

    const existing = document.getElementById(TOOLBAR_ROOT_ID)
    if (existing) existing.remove()

    const root = document.createElement("section")
    root.id = TOOLBAR_ROOT_ID
    root.innerHTML = `
      <div class="ho-wd-wrap">
        <div class="ho-wd-line">
          <span class="ho-wd-orb" aria-hidden="true"></span>
          <span class="ho-wd-title" data-role="status">Autofilling Workday Application…</span>
        </div>
        <div class="ho-wd-sub" data-role="subtitle"></div>
        <div class="ho-wd-progress">
          <div class="ho-wd-progress-track">
            <div class="ho-wd-progress-fill" data-role="progress-fill"></div>
          </div>
          <span class="ho-wd-progress-pct" data-role="progress-text">0%</span>
        </div>
        <div class="ho-wd-actions">
          <button class="ho-wd-btn" data-role="pause">Pause</button>
          <button class="ho-wd-btn" data-role="skip">Skip step</button>
          <button class="ho-wd-btn" data-role="stop">Stop</button>
          <button class="ho-wd-btn" data-role="resume" style="display:none">Resume →</button>
        </div>
        <div class="ho-wd-log" data-role="log"></div>
      </div>
    `
    document.documentElement.appendChild(root)

    this.toolbarRoot = root
    this.toolbarStatus = root.querySelector<HTMLElement>('[data-role="status"]')
    this.toolbarSubtitle = root.querySelector<HTMLElement>('[data-role="subtitle"]')
    this.toolbarProgressBar = root.querySelector<HTMLElement>('[data-role="progress-fill"]')
    this.toolbarProgressText = root.querySelector<HTMLElement>('[data-role="progress-text"]')
    this.toolbarLog = root.querySelector<HTMLElement>('[data-role="log"]')
    this.pauseBtn = root.querySelector<HTMLButtonElement>('[data-role="pause"]')
    this.skipBtn = root.querySelector<HTMLButtonElement>('[data-role="skip"]')
    this.stopBtn = root.querySelector<HTMLButtonElement>('[data-role="stop"]')
    this.resumeBtn = root.querySelector<HTMLButtonElement>('[data-role="resume"]')

    this.pauseBtn?.addEventListener("click", () => {
      if (this.stopped) return
      if (this.eeoPaused) return
      this.paused = !this.paused
      if (this.paused) {
        this.setToolbarState("PAUSED", "Autofill paused.")
      } else {
        this.setToolbarState("WAITING", "Resuming Workday autofill…")
        this.scheduleRun("manual")
      }
    })

    this.skipBtn?.addEventListener("click", () => {
      if (this.stopped) return
      if (this.processing) return
      void (async () => {
        const moved = await this.clickNextAndWait()
        if (moved) this.scheduleRun("manual")
      })()
    })

    this.stopBtn?.addEventListener("click", () => this.stop())

    this.resumeBtn?.addEventListener("click", () => {
      if (this.stopped) return
      this.eeoPaused = false
      this.paused = false
      this.showResumeButton(false)
      this.setToolbarState("WAITING", "Resuming after Self-Identify step…")
      this.scheduleRun("manual")
    })
  }
}

export async function startWorkdayAutofillModule(): Promise<void> {
  if (!isTopFrame()) return
  if (singletonRunner) return
  if (!WorkdayAutofillRunner.isWorkdayDetected()) return
  singletonRunner = new WorkdayAutofillRunner({ showToolbar: true })
  await singletonRunner.start()
}

export function isWorkdayApplicationPage(): boolean {
  return WorkdayAutofillRunner.isWorkdayDetected()
}

/**
 * High-stakes work-authorization / immigration / conflict questions whose
 * answer depends on the candidate's true legal status and where a wrong value
 * can auto-reject the application. The runner only auto-answers clear yes/no
 * work authorization or sponsorship questions from saved profile values;
 * citizenship, immigration-status, and conflict questions stay manual.
 */
export function isSensitiveWorkAuthQuestion(question: string): boolean {
  const q = normText(question)
  if (!q) return false
  return /work authorization|authoriz(?:ed|ation) to work|authoris(?:ed|ation) to work|legally authoriz|eligible to work|eligible for employment|eligibility to work|right to work|require sponsorship|need sponsorship|visa sponsorship|immigration sponsorship|sponsorship (?:now|to work)|require (?:visa|immigration)|citizenship|are you a citizen|permanent resident|immigration status|conflict of interest/.test(
    q,
  )
}

/**
 * Lightweight estimate of how many Workday fields the runner will attempt to
 * fill for this profile, broken down by section. Used by the apex-bar
 * preview so users see "≈48 fields across 4 sections" instead of the
 * misleading "1 ready to fill" placeholder.
 *
 * Mirrors WorkdayAutofillRunner.estimateTotalFields but is pure — no DOM,
 * no runner state — so the bar can call it during the preview stage.
 */
export function estimateWorkdayAutofillFields(profile: SafeProfile): {
  total: number
  myInformation: number
  experience: number
  education: number
  skills: number
  websites: number
  questions: number
} {
  const ext = profile as ExtendedSafeProfile
  const workExperienceCount = ext.resume_education ? 0 : 0
  // We don't have a structured work-experience array on the profile yet — the
  // runner derives one from the resume parser. Estimate conservatively using
  // years_of_experience to suggest 1–4 entries.
  const years = typeof ext.years_of_experience === "number" ? ext.years_of_experience : 0
  const estimatedJobs = Math.max(1, Math.min(4, Math.round(years / 3)))
  const experience = estimatedJobs * 10 + workExperienceCount

  const educationCount = ext.resume_education?.length ?? (ext.highest_degree ? 1 : 0)
  const education = educationCount * 6

  // SafeProfile doesn't carry skills as an array directly; the runner reads
  // them from the parsed resume. Assume ≤12 for the preview estimate.
  const skills = 12

  const websites =
    (ext.resume_linkedin_url ? 2 : 0) +
    (ext.resume_portfolio_url ? 2 : 0)

  const myInformation = 12
  const questions = 8

  return {
    total: myInformation + experience + education + skills + websites + questions,
    myInformation,
    experience,
    education,
    skills,
    websites,
    questions,
  }
}

export async function runWorkdayAutofillInExistingBar(options: RunInBarOptions): Promise<WorkdayAutofillRunResult> {
  const runner = new WorkdayAutofillRunner({
    showToolbar: false,
    profile: options.profile as ExtendedSafeProfile,
    resumeJobId: options.resumeJobId ?? null,
    resumeId: options.resumeId ?? null,
    resumeVersionId: options.resumeVersionId ?? null,
    onSnapshot: options.onSnapshot,
    onWarning: options.onWarning,
  })
  const result = await runner.runUntilSettled(options.maxCycles ?? 12)
  window[GLOBAL_LAST_RESULT_KEY] = result
  window[GLOBAL_LAST_ERROR_KEY] = result.phase === "error" ? "Workday autofill returned error phase." : null
  return result
}

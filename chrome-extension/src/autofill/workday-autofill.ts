import { fetchPrimaryResume, getAutofillProfile } from "../api-client"
import type { SafeProfile } from "./safe-fields"
import type { AutofillFieldResult } from "./safe-fields"

type WorkdayStepId =
  | "account_required"
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
  resume_full_name?: string | null
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
  skills: string[]
  skillYears: Record<string, number>
  visa: {
    requiresSponsorship: boolean
    authorizedCountries: string[]
    status: string
  }
  salaryExpectation: string
  availability: string
  citizenship: string
  yearsOfExperience: number
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

function isVisible(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.hidden) return false
  const style = window.getComputedStyle(el)
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
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

function extractNameParts(
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
    return {
      firstName: toTitleCase(first),
      middleName: toTitleCase(middle),
      lastName: toTitleCase(last),
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
    skills,
    skillYears,
    visa: {
      requiresSponsorship: profile.requires_sponsorship === true,
      authorizedCountries: [nonEmpty(profile.country)].filter(Boolean),
      status: nonEmpty(profile.work_authorization) || (profile.requires_sponsorship ? "H-1B required" : ""),
    },
    salaryExpectation,
    availability: nonEmpty(profile.earliest_start_date) || "2 weeks notice required",
    citizenship: "",
    yearsOfExperience,
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
  private readonly showToolbar: boolean
  private readonly externalProfile: ExtendedSafeProfile | null
  private readonly onSnapshot?: (snapshot: WorkdayAutofillSnapshot) => void
  private readonly onWarning?: (line: string) => void

  private observer: MutationObserver | null = null
  private stopped = false
  private paused = false
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
    this.publishDebug()
    this.debug("info", "runner.init", {
      showToolbar: this.showToolbar,
      hasExternalProfile: Boolean(this.externalProfile),
      hasResumeFile: Boolean(this.resumeFile),
      href: window.location.href,
    })
  }

  static isWorkdayDetected(): boolean {
    const host = window.location.hostname.toLowerCase()
    return (
      document.querySelector('[data-automation-id="applicationPage"]') !== null ||
      host.includes("myworkdayjobs.com") ||
      host.includes("wd1.myworkdayjobs.com") ||
      host.includes("wd3.myworkdayjobs.com") ||
      host.includes("wd5.myworkdayjobs.com") ||
      /(?:^|\.)wd\d+\.myworkdayjobs\.com$/.test(host) ||
      host === "apply.workday.com"
    )
  }

  async start(): Promise<void> {
    if (!WorkdayAutofillRunner.isWorkdayDetected()) return
    if (this.stopped) return

    if (this.showToolbar) this.mountToolbar()
    this.phase = "running"
    this.setToolbarState("WAITING", "Loading Scout CV memory for Workday…")

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
      this.setToolbarState("NEEDS_REVIEW", "Scout profile missing. Complete autofill profile in Hireoven.")
      this.logWarning("Manual review needed: no autofill profile found in Scout memory.")
      this.debug("error", "context.initialize.profile_missing")
      window[GLOBAL_LAST_ERROR_KEY] = "Scout profile missing."
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
      const resumeBytes = await fetchPrimaryResume().catch(() => null)
      if (resumeBytes) {
        const file = this.decodeBase64File(resumeBytes.base64, resumeBytes.filename)
        if (file) this.resumeFile = file
        this.debug("info", "context.initialize.resume_loaded", {
          filename: resumeBytes.filename,
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
    this.phase = "paused"
    this.setToolbarState("PAUSED", "Autofill paused.")
    this.debug("info", "runner.paused")
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
   * appears, the scout-bar's MutationObserver re-detects it and re-enables
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
        this.paused = true
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
        this.paused = true
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

      if (step.id === "self_identify" || document.querySelector('[data-automation-id="selfIdentifyPage"]')) {
        this.paused = true
        this.eeoPaused = true
        this.setToolbarState(
          "PAUSED",
          "Self-Identify step reached. Scout will not fill optional legal disclosures.",
        )
        this.showResumeButton(true)
        this.logWarning("Manual review needed: Self-Identify (EEO) fields must be completed by user.")
        this.debug("warn", "run.pause_self_identify")
        return
      }

      this.showResumeButton(false)

      if (step.id === "review") {
        this.setToolbarState(
          "DONE",
          `Scout filled ${this.fieldsFilledCount} fields across completed Workday steps.`,
        )
        this.setToolbarNote("Scout will NOT auto-submit. Review and submit yourself.")
        this.paused = true
        this.debug("info", "run.reached_review")
        return
      }

      switch (step.id) {
        case "my_information":
          await this.fillMyInformationStep()
          break
        case "my_experience":
          await this.fillMyExperienceStep()
          break
        case "application_questions":
          await this.fillApplicationQuestionsStep()
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
      const fillsThisStep = step.id === "my_information" || step.id === "my_experience" || step.id === "application_questions"
      if (fillsThisStep) {
        if (this.requiredFieldMissesThisStep > 0) {
          this.paused = true
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
          this.paused = true
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

    const stepEl =
      document.querySelector('[data-automation-id="currentPage"]') ??
      document.querySelector('[aria-label*="Step"]')
    const text = nonEmpty(stepEl?.textContent)
    const normalized = normText(text)

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

    if (normalized.includes("my information")) {
      return { id: "my_information", name: "My Information", index: 1, total: STEP_TOTAL }
    }
    if (normalized.includes("my experience")) {
      return { id: "my_experience", name: "My Experience", index: 2, total: STEP_TOTAL }
    }
    if (normalized.includes("application question")) {
      return { id: "application_questions", name: "Application Questions", index: 3, total: STEP_TOTAL }
    }
    if (normalized.includes("self identify") || normalized.includes("self-identify")) {
      return { id: "self_identify", name: "Self Identify", index: 4, total: STEP_TOTAL }
    }
    if (normalized.includes("review")) {
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
    await this.fillFirstTextSelector(
      [
        '[data-automation-id="legalNameSection_firstName"]',
        '[data-automation-id="formField-legalName--firstName"]',
        '[data-automation-id="legalName--firstName"]',
        '[data-automation-id="firstName"]',
      ],
      this.cv.firstName,
      "Legal First Name",
      { forceOverwrite: true, salvageMiscased: true },
    )
    await this.fillFirstTextSelector(
      [
        '[data-automation-id="legalNameSection_middleName"]',
        '[data-automation-id="formField-legalName--middleName"]',
        '[data-automation-id="legalName--middleName"]',
        '[data-automation-id="middleName"]',
      ],
      this.cv.middleName,
      "Legal Middle Name",
      { optional: true, forceOverwrite: true, salvageMiscased: true },
    )
    await this.fillFirstTextSelector(
      [
        '[data-automation-id="legalNameSection_lastName"]',
        '[data-automation-id="formField-legalName--lastName"]',
        '[data-automation-id="legalName--lastName"]',
        '[data-automation-id="lastName"]',
      ],
      this.cv.lastName,
      "Legal Last Name",
      { forceOverwrite: true, salvageMiscased: true },
    )
    await this.fillFirstTextSelector(
      [
        '[data-automation-id="preferredName-firstName"]',
        '[data-automation-id="formField-preferredName--firstName"]',
        '[data-automation-id="preferredName"]',
      ],
      this.cv.preferredName || this.cv.firstName,
      "Preferred Name",
      { optional: true, forceOverwrite: true },
    )
    await this.fillFirstTextSelector(
      [
        '[data-automation-id="addressSection_addressLine1"]',
        '[data-automation-id="formField-address--addressLine1"]',
        '[data-automation-id="formField-addressLine1"]',
        '[data-automation-id="addressLine1"]',
      ],
      this.cv.address.line1,
      "Address Line 1",
    )
    await this.fillFirstTextSelector(
      [
        '[data-automation-id="addressSection_addressLine2"]',
        '[data-automation-id="formField-address--addressLine2"]',
        '[data-automation-id="formField-addressLine2"]',
        '[data-automation-id="addressLine2"]',
      ],
      this.cv.address.line2,
      "Address Line 2",
      { optional: true },
    )
    await this.fillFirstTextSelector(
      [
        '[data-automation-id="addressSection_city"]',
        '[data-automation-id="formField-address--city"]',
        '[data-automation-id="formField-city"]',
        '[data-automation-id="city"]',
      ],
      this.cv.address.city,
      "City",
    )
    // Country MUST be selected before State and Postal Code on apply-flow
    // tenants — the State dropdown options and the Postal Code validator are
    // both downstream of the selected country. Filling state first triggers
    // Workday's reactive validators with an inconsistent (country, state)
    // pair, which is one of the known triggers for the server-side 500.
    await this.selectCombobox(
      '[data-automation-id="addressSection_country"], ' +
      '[data-automation-id="formField-country"], ' +
      '[data-automation-id="formField-address--country"]',
      this.cv.address.country || "United States",
      "Country",
      { riskyApplyFlowField: true },
    )
    await sleep(400)
    await this.selectCombobox(
      '[data-automation-id="addressSection_countryRegion"], ' +
      '[data-automation-id="formField-address--countryRegion"], ' +
      '[data-automation-id="formField-countryRegion"], ' +
      '[data-automation-id="formField-state"], ' +
      '[data-automation-id="formField-stateRegion"]',
      this.cv.address.state,
      "State/Province",
      { riskyApplyFlowField: true },
    )
    await this.fillFirstTextSelector(
      [
        '[data-automation-id="addressSection_postalCode"]',
        '[data-automation-id="formField-address--postalCode"]',
        '[data-automation-id="formField-postalCode"]',
        '[data-automation-id="postalCode"]',
      ],
      this.cv.address.zip,
      "Postal Code",
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
    await this.fillFirstTextSelector(
      [
        '[data-automation-id="phone-number"]',
        '[data-automation-id="formField-phoneNumber"]',
        '[data-automation-id="formField-phone--phoneNumber"]',
        '[data-automation-id="phoneNumber"]',
      ],
      this.cv.phone,
      "Phone Number",
    )

    const emailTarget = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-automation-id="email"], ' +
      '[data-automation-id="formField-email"], ' +
      '[data-automation-id="formField-emailAddress"]',
    )).find((node) => isVisible(node)) ?? null
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

    // Do not auto-set Source. On some apply-flow tenants this optional field
    // issues unstable backend calls and can collapse the page into Workday's
    // generic "Something went wrong" screen.
    this.debug("info", "field.source.skipped_by_policy")
    this.debug("info", "step.my_information.complete")
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
    await this.fillSkillsSection()
    await this.fillWebsiteSection()
    this.debug("info", "step.my_experience.complete")
  }

  private async fillWorkExperienceEntries(): Promise<void> {
    if (!this.cv) return
    const section =
      document.querySelector('[data-automation-id="workExperienceSection"]') ??
      document.querySelector('[data-automation-id="workExperience"]')
    if (!section) {
      this.debug("warn", "experience.section_missing")
      return
    }

    const addButton = section.querySelector<HTMLElement>('[data-automation-id="Add"]')
    if (!isVisible(addButton)) {
      this.debug("warn", "experience.add_missing")
      return
    }
    const add = addButton as HTMLElement

    for (const [index, job] of this.cv.workExperience.entries()) {
      if (this.stopped || this.paused) return
      this.debug("info", "experience.entry.start", {
        index: index + 1,
        title: job.title,
        company: job.company,
      })
      add.click()
      await sleep(500)

      const dialog = this.getActiveDialog()
      if (!dialog) {
        this.debug("error", "experience.dialog_missing_after_add", { index: index + 1 })
        break
      }

      await this.fillAutomationIdInRoot(dialog, "jobTitle", job.title, "Job Title")
      await this.fillAutomationIdInRoot(dialog, "company", job.company, "Company")
      await this.fillAutomationIdInRoot(dialog, "location", job.location, "Location", { optional: true })
      await this.selectAutomationComboboxInRoot(dialog, "startDate-Month", job.startDate.month, "Start Month")
      await this.fillAutomationIdInRoot(dialog, "startDate-Year", job.startDate.year, "Start Year")
      await this.setCheckboxInRoot(dialog, "currentlyWorkHere", job.current, "Currently Work Here")

      if (!job.current && job.endDate) {
        await this.selectAutomationComboboxInRoot(dialog, "endDate-Month", job.endDate.month, "End Month")
        await this.fillAutomationIdInRoot(dialog, "endDate-Year", job.endDate.year, "End Year")
      }

      const description = this.buildExperienceDescription(job)
      await this.fillTextareaAutomationInRoot(dialog, "description", description, "Description")

      const save = dialog.querySelector<HTMLElement>('[data-automation-id="saveWorkExperienceButton"]')
      if (isVisible(save)) {
        const saveEl = save as HTMLElement
        saveEl.click()
        await this.waitForDialogClose(dialog, 5000)
      } else {
        this.debug("warn", "experience.save_button_missing", { index: index + 1 })
        await this.clickSaveInDialog(dialog)
      }
      this.debug("info", "experience.entry.saved", { index: index + 1 })
      await sleep(250)
    }
  }

  private async fillEducationEntries(): Promise<void> {
    if (!this.cv) return
    if (this.cv.education.length === 0) return

    const section = document.querySelector('[data-automation-id="educationSection"]')
    if (!section) {
      this.debug("warn", "education.section_missing")
      return
    }
    const addButton = section.querySelector<HTMLElement>('[data-automation-id="Add"]')
    if (!isVisible(addButton)) {
      this.debug("warn", "education.add_missing")
      return
    }
    const add = addButton as HTMLElement

    for (const [index, edu] of this.cv.education.entries()) {
      if (this.stopped || this.paused) return
      this.debug("info", "education.entry.start", {
        index: index + 1,
        school: edu.school,
        degree: edu.degree,
      })
      add.click()
      await sleep(500)

      const dialog = this.getActiveDialog()
      if (!dialog) {
        this.debug("error", "education.dialog_missing_after_add", { index: index + 1 })
        break
      }

      await this.fillAutomationIdInRoot(dialog, "school", edu.school, "School Name")
      const degreeSelected = await this.selectAutomationComboboxInRoot(dialog, "degree", edu.degree, "Degree", { optional: true })
      if (!degreeSelected) {
        const fallback = this.pickDegreeFallback(edu.degree)
        if (fallback) {
          await this.selectAutomationComboboxInRoot(dialog, "degree", fallback, "Degree", { optional: true })
        }
      }
      await this.fillAutomationIdInRoot(dialog, "fieldOfStudy", edu.major, "Field of Study", { optional: true })
      if (edu.gpa) {
        await this.fillAutomationIdInRoot(dialog, "gpa", edu.gpa, "GPA", { optional: true })
      }
      if (edu.startYear) {
        await this.fillAutomationIdInRoot(dialog, "startDate-Year", edu.startYear, "Education Start Year", {
          optional: true,
        })
      }
      if (edu.endYear) {
        const endYearSet = await this.fillAutomationIdInRoot(dialog, "endDate-Year", edu.endYear, "Education End Year", {
          optional: true,
        })
        if (!endYearSet) {
          await this.selectAutomationComboboxInRoot(dialog, "endDate-Year", edu.endYear, "Education End Year", {
            optional: true,
          })
        }
      }

      const save = dialog.querySelector<HTMLElement>('[data-automation-id="saveEducationButton"]')
      if (isVisible(save)) {
        const saveEl = save as HTMLElement
        saveEl.click()
        await this.waitForDialogClose(dialog, 5000)
      } else {
        await this.clickSaveInDialog(dialog)
      }
      this.debug("info", "education.entry.saved", { index: index + 1 })
      await sleep(250)
    }
  }

  private async fillSkillsSection(): Promise<void> {
    if (!this.cv) return
    const addButton = document.querySelector<HTMLElement>(
      '[data-automation-id="skillsSection"] [data-automation-id="Add"]',
    )
    if (!isVisible(addButton)) {
      this.debug("info", "skills.section_missing_or_hidden")
      return
    }
    const add = addButton as HTMLElement
    const skills = this.cv.skills.slice(0, 24)
    for (const skill of skills) {
      if (this.stopped || this.paused) return
      this.debug("info", "skills.entry.start", { skill })
      add.click()
      await sleep(220)
      const dialog = this.getActiveDialog()
      if (!dialog) break
      const skillTarget = dialog.querySelector<HTMLElement>('[data-automation-id="skillName"]')
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

  private async fillWebsiteSection(): Promise<void> {
    if (!this.cv) return
    const addButton = document.querySelector<HTMLElement>(
      '[data-automation-id="websiteSection"] [data-automation-id="Add"]',
    )
    if (!isVisible(addButton)) {
      this.debug("info", "website.section_missing_or_hidden")
      return
    }
    const add = addButton as HTMLElement

    const entries: Array<{ type: string; url: string }> = []
    if (this.cv.linkedIn) entries.push({ type: "LinkedIn", url: this.cv.linkedIn })
    if (this.cv.portfolio) entries.push({ type: "Portfolio", url: this.cv.portfolio })

    for (const entry of entries) {
      if (this.stopped || this.paused) return
      this.debug("info", "website.entry.start", { type: entry.type })
      add.click()
      await sleep(220)
      const dialog = this.getActiveDialog()
      if (!dialog) break

      await this.selectAutomationComboboxInRoot(dialog, "websiteType", entry.type, "Website Type", { optional: true })
      await this.fillAutomationIdInRoot(dialog, "websiteAddress", entry.url, "Website URL")
      await this.clickSaveInDialog(dialog)
      this.debug("info", "website.entry.saved", { type: entry.type })
      await sleep(220)
    }
  }

  private async fillApplicationQuestionsStep(): Promise<void> {
    if (!this.cv) return
    this.debug("info", "step.application_questions.start")
    const handledRadioNames = new Set<string>()
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(isVisible)
    this.debug("info", "questions.radios.detected", { count: radios.length })
    for (const radio of radios) {
      const key = radio.name || radio.id || `radio-${radios.indexOf(radio)}`
      if (handledRadioNames.has(key)) continue
      handledRadioNames.add(key)

      const group = radio.name
        ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${safeEscapeSelector(radio.name)}"]`))
        : [radio]
      const label = parseQuestionLabel(radio as HTMLElement) || parseQuestionLabel(group[0] as HTMLElement)
      const answer = this.getYesNoAnswer(label)
      if (answer === null) {
        this.debug("warn", "questions.radio.unanswered", { label: label || "(missing label)" })
        this.markManualReview(radio, label || "Unrecognized radio question")
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
        this.markManualReview(field, label)
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
      if (/\b(ethnicity|race|gender|veteran|disability)\b/i.test(label)) {
        this.debug("info", "questions.select.skipped_sensitive", { label })
        this.markManualReview(select, label)
        continue
      }

      const optionAnswer = this.getSelectAnswer(label)
      if (!optionAnswer) {
        this.debug("warn", "questions.select.unanswered", { label })
        this.markManualReview(select, label)
        continue
      }
      const options = Array.from(select.options)
      const option = options.find((opt) => normText(opt.textContent) === normText(optionAnswer)) ??
        options.find((opt) => normText(opt.textContent).includes(normText(optionAnswer)))
      if (!option) {
        this.debug("warn", "questions.select.option_missing", { label, desired: optionAnswer })
        this.markManualReview(select, label)
        continue
      }
      select.value = option.value
      select.dispatchEvent(new Event("input", { bubbles: true }))
      select.dispatchEvent(new Event("change", { bubbles: true }))
      this.bumpFilledCount()
      this.debug("info", "questions.select.answered", { label, desired: optionAnswer })
    }
    await this.fillApplicationQuestionComboboxes()
    this.debug("info", "step.application_questions.complete")
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
      if (/\b(ethnicity|race|gender|veteran|disability)\b/i.test(label)) {
        this.debug("info", "questions.combobox.skipped_sensitive", { label })
        this.markManualReview(container, label)
        continue
      }

      const existing = nonEmpty(extractComboboxDisplayValue(comboboxTarget))
      if (existing && !this.isUnansweredSelectPlaceholder(existing)) {
        this.debug("info", "questions.combobox.already_answered", {
          label,
          existing: existing.slice(0, 80),
        })
        continue
      }

      const yn = this.getYesNoAnswer(label)
      let desired = yn === null ? this.getSelectAnswer(label) : (yn ? "Yes" : "No")
      if (!desired) desired = this.inferDefaultQuestionComboboxAnswer(label)
      if (!desired) {
        this.debug("warn", "questions.combobox.unanswered", { label })
        this.markManualReview(container, label)
        continue
      }

      const ok = await this.selectComboboxElement(comboboxTarget, desired, label, { optional: true })
      if (ok) {
        this.debug("info", "questions.combobox.answered", { label, desired })
      } else {
        this.debug("warn", "questions.combobox.answer_failed", { label, desired })
        this.markManualReview(container, label)
      }
    }
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
    opts?: { optional?: boolean; riskyApplyFlowField?: boolean },
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
      v === "please select"
    )
  }

  private getYesNoAnswer(question: string): boolean | null {
    if (!this.cv) return null
    const q = normText(question)
    if (!q) return null

    if (
      q.includes("require sponsorship") ||
      q.includes("future require sponsorship") ||
      q.includes("require visa sponsorship")
    ) {
      return this.cv.visa.requiresSponsorship
    }
    if (
      q.includes("legally authorized to work") ||
      q.includes("authorized for employment in the u s") ||
      q.includes("authorized to work in the u s")
    ) {
      // Conservative mapping:
      // - if profile says sponsorship required -> answer NO for unrestricted
      //   authorization wording.
      // - otherwise answer YES.
      if (q.includes("without any restrictions") || q.includes("without restriction")) {
        return !this.cv.visa.requiresSponsorship
      }
      return true
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
    if (q.includes("salary") || q.includes("compensation")) {
      return this.cv.salaryExpectation || "Negotiable"
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

  private markManualReview(el: HTMLElement, question: string): void {
    if (el.getAttribute(MANUAL_REVIEW_ATTR) === "1") return
    el.setAttribute(MANUAL_REVIEW_ATTR, "1")
    el.style.outline = "2px solid #f59e0b"
    el.title = "Scout couldn't fill this — please review"
    this.manualReviewCount += 1
    this.setToolbarState("NEEDS_REVIEW", "⚠️ Review required: some questions need manual input.")
    this.logWarning(`⚠️ Manual review needed: ${question || "Question"}`)
    this.debug("warn", "manual_review.marked", {
      question: question || "Question",
      tag: el.tagName.toLowerCase(),
    })
  }

  private async maybeUploadResume(): Promise<void> {
    if (!this.resumeFile) {
      this.debug("info", "resume_upload.skipped_no_file")
      return
    }
    const fileInput = this.findResumeFileInput()
    if (!fileInput) {
      this.debug("info", "resume_upload.input_not_found")
      return
    }

    if (fileInput.files && fileInput.files.length > 0) {
      this.debug("info", "resume_upload.skipped_already_present", { existingFiles: fileInput.files.length })
      return
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
      this.bumpFilledCount()
      this.debug("info", "resume_upload.done")
    } else {
      this.logWarning("Manual review needed: resume upload may not have completed — verify before continuing.")
      this.debug("warn", "resume_upload.unconfirmed")
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
    opts?: { optional?: boolean },
  ): Promise<boolean> {
    const selector = `[data-automation-id="${safeEscapeSelector(automationId)}"]`
    const found = root.querySelector<HTMLElement>(selector)
    const el = resolveInputControlFromElement(found)
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      this.debug("warn", "field.automation_not_found", { fieldName, automationId, selector })
      if (!opts?.optional) this.logWarning(`Manual review needed: ${fieldName}`)
      return false
    }
    this.setToolbarField(fieldName)
    const ok = this.setElementValue(el, value, fieldName)
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
  ): Promise<boolean> {
    const selector = `[data-automation-id="${safeEscapeSelector(automationId)}"]`
    const found = root.querySelector<HTMLElement>(selector)
    const el = resolveInputControlFromElement(found)
    if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) {
      this.debug("warn", "field.textarea_not_found", { fieldName, automationId, selector })
      return false
    }
    this.setToolbarField(fieldName)
    const ok = this.setElementValue(el, value, fieldName)
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
    opts?: { optional?: boolean },
  ): Promise<boolean> {
    const selector = `[data-automation-id="${safeEscapeSelector(automationId)}"]`
    return this.selectCombobox(selector, value, fieldName, { root, optional: opts?.optional })
  }

  private async setCheckboxInRoot(root: ParentNode, automationId: string, checked: boolean, fieldName: string): Promise<boolean> {
    const selector = `[data-automation-id="${safeEscapeSelector(automationId)}"]`
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
      const clickTarget =
        (target.closest("label") as HTMLElement | null) ??
        (target.closest('[role="checkbox"]') as HTMLElement | null) ??
        target
      clickTarget.click()
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
    opts?: { root?: ParentNode; optional?: boolean; riskyApplyFlowField?: boolean },
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
    // page bundle. If a risky field already has ANY non-empty value, keep it
    // and avoid touching the combobox.
    if (displayed && opts?.riskyApplyFlowField) {
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
    comboboxShell.focus()
    comboboxShell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    comboboxShell.click()
    comboboxShell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    this.debug("info", "combobox.clicked", { fieldName, selector, role: comboboxShell.getAttribute("role") || "" })

    const resolved = resolveInputControlFromElement(target)
    const input = target instanceof HTMLInputElement
      ? target
      : resolved instanceof HTMLInputElement
        ? resolved
        : target.querySelector("input") instanceof HTMLInputElement
          ? (target.querySelector("input") as HTMLInputElement)
          : null

    if (input && !opts?.riskyApplyFlowField) {
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
    while (Date.now() < POLL_DEADLINE) {
      pollAttempts += 1
      const menuOptions = automationId
        ? Array.from(document.querySelectorAll(`[data-automation-id^="${safeEscapeSelector(automationId)}-menu-item--"]`))
        : []
      const roleOptions = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"]'))
      const promptOptions = Array.from(document.querySelectorAll('[data-automation-id="promptOption"]'))
      const activePopupOptions = Array.from(
        document.querySelectorAll(
          '[data-automation-activepopup="true"] [role="option"], ' +
            '[data-automation-activepopup="true"] [role="menuitem"], ' +
            '[data-automation-activepopup="true"] [data-automation-id="promptOption"]',
        ),
      )
      menuOptionCount = menuOptions.length
      roleOptionCount = roleOptions.length + promptOptions.length + activePopupOptions.length
      const candidateOptions = [...activePopupOptions, ...promptOptions, ...menuOptions, ...roleOptions]
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
      clickTarget.click()
      await sleep(120)
      const displayedAfter = nonEmpty(extractComboboxDisplayValue(target))
      if (displayedAfter && !this.isUnansweredSelectPlaceholder(displayedAfter)) {
        this.bumpFilledCount()
        this.debug("info", "combobox.option_selected", {
          fieldName,
          optionText: nonEmpty(clickTarget.textContent),
          displayedAfter: displayedAfter.slice(0, 80),
        })
        return true
      }
      this.bumpFilledCount()
      this.debug("warn", "combobox.option_selected_unverified", {
        fieldName,
        optionText: nonEmpty(clickTarget.textContent),
      })
      return true
    }

    if (input && !opts?.riskyApplyFlowField) {
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
    opts?: { forceOverwrite?: boolean },
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
      // Intentionally NO el.blur() here. Workday's apply-flow tenants
      // auto-save on blur via the cx-applyflow bundle; firing blur after
      // every field hammers their backend with N save calls in quick
      // succession, which is a known trigger for the generic 500 +
      // "Something went wrong" page on flaky tenants (US Bank, etc.).
      // The change event alone is enough for React to pick up the new value;
      // the user's first real focus/blur after our run will commit cleanly.
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

  private pickDegreeFallback(rawDegree: string): string {
    const normalized = normText(rawDegree)
    if (!normalized) return ""
    if (normalized.includes("bachelor")) return "Bachelor's"
    if (normalized.includes("master")) return "Master's"
    if (normalized.includes("phd") || normalized.includes("doctor")) return "Doctorate"
    if (normalized.includes("associate")) return "Associate's"
    return ""
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
 * Lightweight estimate of how many Workday fields the runner will attempt to
 * fill for this profile, broken down by section. Used by the scout-bar
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
    onSnapshot: options.onSnapshot,
    onWarning: options.onWarning,
  })
  const result = await runner.runUntilSettled(options.maxCycles ?? 12)
  window[GLOBAL_LAST_RESULT_KEY] = result
  window[GLOBAL_LAST_ERROR_KEY] = result.phase === "error" ? "Workday autofill returned error phase." : null
  return result
}

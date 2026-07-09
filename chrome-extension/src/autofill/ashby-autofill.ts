import {
  injectDocxFile,
  setReactValue,
  type ResumeBytes,
  type SafeProfile,
} from "./safe-fields"
import { deepParentElement, queryAllDeep } from "./shadow-dom"
import { workAuthAnswer, isCurrentlyAuthorizedVisa } from "./work-auth"

type AshbyQuestionType = "text" | "textarea" | "yesno" | "select"

export type AshbyQuestionRequest = {
  id: string
  label: string
  type: AshbyQuestionType
  options?: string[]
  /** ATS marks this field required — set so the server never nulls it in
   *  autonomous mode (the agent can't submit while a required field is empty). */
  required?: boolean
}

export type AshbyMatchedAnswer = {
  id: string
  value: string | null
  confidence: "high" | "medium" | "low"
}

export type AshbyFillNote = {
  label: string
  valuePreview?: string
  filled: boolean
  skippedReason?: string
}

export type AshbyQuestionFillSummary = {
  attemptedCount: number
  filledCount: number
  manualReviewCount: number
  notes: AshbyFillNote[]
}

export type RequiredQuestionRequest = AshbyQuestionRequest
export type RequiredMatchedAnswer = AshbyMatchedAnswer
export type RequiredFieldFillNote = AshbyFillNote
export type RequiredFieldFillSummary = AshbyQuestionFillSummary

export type AshbyResumeParserResult = {
  attempted: boolean
  uploaded: boolean
  parsed: boolean
  reason?: string
}

type FormControlElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

type AshbyQuestionTarget = {
  id: string
  label: string
  type: AshbyQuestionType
  options?: string[]
  row: HTMLElement
  controls: HTMLElement[]
  kind: "text" | "textarea" | "select" | "radio" | "checkbox" | "button" | "combobox"
}

const FORM_CONTROL_SELECTOR =
  "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea"
const DOC_ACCEPT_RE =
  /\.pdf|\.docx?|\.rtf|\.txt|pdf|msword|wordprocessing|officedocument|document|text\/plain|rich\s*text/i
const IMAGE_ACCEPT_RE = /image|\.png|\.jpe?g|\.gif|\.heic|\.webp|\.svg/i
const TEXT_INPUT_TYPES = new Set(["", "text", "email", "tel", "url", "search", "number"])

/**
 * react-select / downshift comboboxes (Greenhouse Country, "How did you hear",
 * work-auth / sponsorship dropdowns) render a text `<input>` that ignores a
 * plain value-set — they need click → type → click-option to register a choice.
 * Detect them so they get the combobox driver instead of the text path.
 */
function isComboboxInput(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement)) return false
  if (el.getAttribute("role") === "combobox") return true
  if (el.getAttribute("aria-autocomplete") === "list") return true
  if (el.getAttribute("aria-haspopup") === "listbox") return true
  const cls = el.getAttribute("class") ?? ""
  return /\bselect__input\b|\bselect__control\b/.test(cls)
}

// Always skipped (we never auto-fill these). NOTE: salary/compensation are NOT
// here — those are normal fields the user wants filled from their profile.
// Sentinel: pick the first real option (used for "preferred location" pickers).
const PICK_FIRST_OPTION = "__ho_pick_first__"
// Sentinel: last-resort for an ungrounded REQUIRED option widget — within ONE
// open menu, prefer a safe "No / None / Prefer not" option, else fall back to
// the first real option. Doing it in a SINGLE combobox pass matters: two
// separate passes ("no", then pick-first) re-open a react-select whose menu the
// first pass already opened, and the second mousedown TOGGLES it shut → the
// field is left blank. This is the "it still left 1 required field" bug.
const PICK_NO_ELSE_FIRST = "__ho_no_else_first__"
// Sentinel: tick EVERY checkbox in the group ("Select all — by selecting all,
// you acknowledge…" consent blocks).
const PICK_ALL_OPTIONS = "__ho_pick_all__"
// Neutral answers for REQUIRED sensitive/EEO questions the user hasn't opted
// into auto-filling: declining is always a legitimate choice.
const DECLINE_ANSWER_CANDIDATES = [
  "Decline to self-identify",
  "I don't wish to answer",
  "I do not wish to answer",
  "Prefer not to say",
  "Prefer not to answer",
  "Decline",
]
// Sentinel: "how did you hear" — followed by "|"-joined candidate values.
const SOURCE_CANDIDATES_PREFIX = "__ho_source__"

const ALWAYS_SKIP_QUESTION_RE = /\b(date of birth|birth\s?date|dob)\b/i
// Phone-field country-code pickers ("Search by country/region or code",
// "Country code") ship preselected (+1) and only accept trusted interaction.
// Typing into them BREAKS the selection and invalidates the entire phone
// field (the SmartRecruiters "country code left empty" bug) — never touch.
const PHONE_COUNTRY_WIDGET_RE =
  /\bsearch by country\b|\bcountry\/?\s?region or code\b|\bcountry (code|calling code)\b|\bdial(ing)? code\b/i
// Demographic / EEO — skipped UNLESS the user opted in via auto_fill_diversity.
const DEMOGRAPHIC_QUESTION_RE =
  /\b(gender|sex|ethnic\w*|race|racial|hispanic|latino|veteran|disabil\w*|disabled|sexual orientation|orientation|transgender|pronoun)\b/i

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeKey(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function cleanLabel(value: string | null | undefined): string {
  return normalizeText(value)
    .replace(/\s*\*\s*$/g, "")
    .replace(/\s+required\s*$/i, "")
    .trim()
}

function titleCaseName(value: string | null | undefined): string | null {
  const raw = normalizeText(value)
  if (!raw) return null
  return raw
    .split(/\s+/)
    .map((part) =>
      part
        .split("-")
        .map((piece) => {
          if (!piece) return piece
          if (piece.length <= 2 && piece === piece.toUpperCase()) return piece
          return `${piece.charAt(0).toUpperCase()}${piece.slice(1).toLowerCase()}`
        })
        .join("-"),
    )
    .join(" ")
}

function fullName(profile: SafeProfile): string | null {
  const parts = [titleCaseName(profile.first_name), titleCaseName(profile.last_name)].filter(
    (part): part is string => Boolean(part),
  )
  return parts.length > 0 ? parts.join(" ") : null
}

function locationValue(profile: SafeProfile): string | null {
  const parts = [profile.city, profile.state, profile.country]
    .map((part) => normalizeText(part))
    .filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : null
}

function companiesFromProfile(profile: SafeProfile): string[] {
  const rows = Array.isArray(profile.work_experience) ? profile.work_experience : []
  const companies = [
    profile.current_company,
    ...rows.map((row) => row?.company ?? null),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const company of companies) {
    const clean = normalizeText(company)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function currentCompany(profile: SafeProfile): string | null {
  const current = normalizeText(profile.current_company)
  if (current) return current
  const rows = Array.isArray(profile.work_experience) ? profile.work_experience : []
  const explicitCurrent = rows.find((row) => row?.is_current && normalizeText(row.company))
  if (explicitCurrent?.company) return normalizeText(explicitCurrent.company)
  const first = rows.find((row) => normalizeText(row?.company))
  return first?.company ? normalizeText(first.company) : null
}

function hasCompany(profile: SafeProfile, re: RegExp): boolean {
  return companiesFromProfile(profile).some((company) => re.test(company))
}

function profileHasWorkHistory(profile: SafeProfile): boolean {
  return companiesFromProfile(profile).length > 0
}

function isElementUsable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.hidden) return false
  if (el.getAttribute("aria-hidden") === "true") return false
  if (el.hasAttribute("disabled")) return false
  const control = el as Partial<FormControlElement>
  if (control.disabled) return false
  return true
}

function isElementRendered(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) return true
  // No layout info (jsdom, or a page that hasn't laid out yet) reports 0 size for
  // everything. Fall back to attribute/style visibility so option matching still
  // works instead of discarding every option — but still drop genuinely hidden
  // nodes (display:none / visibility:hidden) so we don't pick an offscreen option.
  const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el)
  if (style && (style.display === "none" || style.visibility === "hidden")) return false
  return el.isConnected
}

function queryAllDeepWithin<T extends Element>(root: ParentNode, selector: string): T[] {
  const out = queryAllDeep<T>(root, selector)
  if (root instanceof HTMLElement && root.shadowRoot) {
    out.push(...queryAllDeep<T>(root.shadowRoot, selector))
  }
  return out
}

function fileInputAcceptsDocs(input: HTMLInputElement): boolean {
  const accept = input.getAttribute("accept") ?? ""
  if (!accept) return true
  if (IMAGE_ACCEPT_RE.test(accept) && !DOC_ACCEPT_RE.test(accept)) return false
  return DOC_ACCEPT_RE.test(accept)
}

function cssEscape(value: string): string {
  const fn = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape
  return typeof fn === "function" ? fn(value) : value.replace(/["\\]/g, "\\$&")
}

function contextText(el: HTMLElement, maxDepth = 5): string {
  const parts: string[] = [
    el.getAttribute("name") ?? "",
    el.id ?? "",
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("accept") ?? "",
  ]
  if (el.id) {
    const lbl = el.ownerDocument.querySelector(`label[for="${cssEscape(el.id)}"]`)
    if (lbl?.textContent) parts.push(lbl.textContent)
  }
  let node: HTMLElement | null = el.parentElement
  for (let depth = 0; node && depth < maxDepth; depth += 1, node = node.parentElement) {
    const text = normalizeText(node.textContent)
    if (text.length <= 700) parts.push(text)
  }
  return normalizeKey(parts.join(" "))
}

export function findAshbyResumeParserInput(doc: Document = document): HTMLInputElement | null {
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .filter((input) => isElementUsable(input) && fileInputAcceptsDocs(input))
  if (inputs.length === 0) return null

  const scored = inputs
    .map((input) => {
      const ctx = contextText(input)
      let score = 0
      const hasParserSignal =
        /\bautofill from resume\b/.test(ctx) ||
        /\bupload your resume here to autofill\b/.test(ctx) ||
        /\bkey application fields\b/.test(ctx) ||
        /\b(auto fill|autofill|pre fill|prefill|parse|populate)\b/.test(ctx)
      if (/\bautofill from resume\b/.test(ctx)) score += 14
      if (/\bupload your resume here to autofill\b/.test(ctx)) score += 12
      if (/\bkey application fields\b/.test(ctx)) score += 8
      if (/\b(auto fill|autofill|pre fill|prefill|parse|populate)\b/.test(ctx)) score += 6
      if (/\bresume\b|\bcv\b/.test(ctx)) score += 2
      if (/\bcover letter\b/.test(ctx)) score -= 20
      if (/\bresume\b/.test(ctx) && /\brequired\b|\*/.test(ctx) && !/\bautofill\b|\bpre fill\b|\bparse\b/.test(ctx)) {
        score -= 10
      }
      return { input, score, hasParserSignal }
    })
    .filter((item) => item.hasParserSignal && item.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored[0]?.input ?? null
}

export function hasAshbyResumeParserInput(doc: Document = document): boolean {
  return Boolean(findAshbyResumeParserInput(doc))
}

export async function runAshbyResumeParserPrefill(args: {
  profile: SafeProfile
  resumeBytes: ResumeBytes | null
  doc?: Document
  timeoutMs?: number
}): Promise<AshbyResumeParserResult> {
  const doc = args.doc ?? document
  const input = findAshbyResumeParserInput(doc)
  if (!input) return { attempted: false, uploaded: false, parsed: false, reason: "Ashby parser upload not found." }
  if (!args.resumeBytes) return { attempted: true, uploaded: false, parsed: false, reason: "No resume bytes available." }

  const uploaded = injectDocxFile(input, args.resumeBytes)
  if (!uploaded) return { attempted: true, uploaded: false, parsed: false, reason: "Parser upload rejected the resume file." }

  const parsed = await waitForAshbyParserFill(args.profile, doc, args.timeoutMs ?? 9000)
  return { attempted: true, uploaded: true, parsed }
}

/**
 * Fill Ashby typeahead comboboxes (e.g. the required Location field) directly:
 * type the value, wait for the option list, then click the matching option.
 * applySafeFills skips comboboxes, and a plain value-set doesn't register a
 * selection, so without this the Location field stays "missing" and blocks the
 * form. Returns the number of comboboxes filled.
 */
export async function fillAshbyComboboxes(profile: SafeProfile, doc: Document = document): Promise<number> {
  let filled = 0
  const combos = Array.from(
    doc.querySelectorAll<HTMLInputElement>('input[role="combobox"], input[aria-autocomplete="list"]'),
  ).filter((el) => isElementUsable(el) && !normalizeText(el.value))

  for (const input of combos) {
    const row = input.closest<HTMLElement>('[class*="fieldEntry" i], .ashby-application-form-field-entry')
    const label = row ? getQuestionLabel(row) : normalizeText(input.getAttribute("aria-label"))
    if (isSensitiveAshbyQuestion(label, profile.auto_fill_diversity === true)) continue
    const value = /\blocation\b|\bcity\b|\baddress\b|\bresidence\b/i.test(label) ? locationValue(profile) : null
    if (!value) continue
    if (await fillAshbyTypeahead(input, value, doc)) filled += 1
  }
  return filled
}

// ── Education section (School / Degree / Discipline / dates) ──────────────────
// Greenhouse (and Lever/BambooHR/generic) render the Education block as a set of
// react-select DROPDOWNS — School (typeahead), Degree (fixed list), Discipline
// (fixed list), plus Start/End "month" dropdowns and "year" text inputs — with
// an "Add another" to repeat. safe-fields deliberately skips comboboxes, so
// these never filled even though the résumé carries every value. This drives
// them from `profile.resume_education`, mapping one résumé row per on-page block.

type EduRole = "school" | "degree" | "discipline" | "start_month" | "start_year" | "end_month" | "end_year"

const EDU_ROLE_MATCHERS: Array<{ role: EduRole; re: RegExp }> = [
  { role: "start_month", re: /\bstart\b[\s\S]*\bmonth\b/i },
  { role: "start_year", re: /\bstart\b[\s\S]*\byear\b/i },
  { role: "end_month", re: /\bend\b[\s\S]*\bmonth\b|\b(graduat|completion)\b[\s\S]*\bmonth\b/i },
  { role: "end_year", re: /\bend\b[\s\S]*\byear\b|\b(graduat|completion)\b[\s\S]*\byear\b/i },
  { role: "discipline", re: /\bdiscipline\b|\bfield[\s_-]?of[\s_-]?study\b|\bmajor\b|\bconcentration\b|\bspecial(?:ization|isation)\b|\barea[\s_-]?of[\s_-]?study\b/i },
  { role: "degree", re: /\bdegree\b|\bqualification\b/i },
  { role: "school", re: /\bschool\b|\buniversit|\bcollege\b|\binstitution\b|\balma[\s_-]?mater\b/i },
]

/** A single control's OWN label — aria-label / aria-labelledby / <label for> /
 *  wrapping <label> / placeholder — used to disambiguate month vs year controls
 *  that share one field row. */
function ownControlLabel(control: HTMLElement): string {
  const aria = normalizeText(control.getAttribute("aria-label"))
  if (aria) return aria
  const doc = control.ownerDocument ?? document
  const labelledby = control.getAttribute("aria-labelledby")
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => normalizeText(doc.getElementById(id)?.textContent))
      .filter(Boolean)
      .join(" ")
    if (text) return text
  }
  const id = control.getAttribute("id")
  if (id) {
    try {
      const forLabel = doc.querySelector<HTMLElement>(`label[for="${cssEscape(id)}"]`)
      const text = normalizeText(forLabel?.textContent)
      if (text) return text
    } catch {
      // invalid id for a selector — ignore
    }
  }
  const wrapping = control.closest("label")
  if (wrapping) {
    const text = normalizeText(wrapping.textContent)
    if (text) return text
  }
  return normalizeText(control.getAttribute("placeholder"))
}

function eduRoleFor(label: string): EduRole | null {
  const key = normalizeKey(label)
  if (!key) return null
  for (const { role, re } of EDU_ROLE_MATCHERS) {
    if (re.test(key)) return role
  }
  return null
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** Split a résumé education date ("2020", "2020-05", "05/2020", "May 2020") into
 *  a full month name and a 4-digit year — either may be null. */
function parseEducationDate(raw: string | null | undefined): { month: string | null; year: string | null } {
  const value = normalizeText(raw)
  if (!value) return { month: null, year: null }
  const yearMatch = value.match(/\b(19|20)\d{2}\b/)
  const year = yearMatch ? yearMatch[0] : null
  let month: string | null = null
  const iso = value.match(/\b(?:19|20)\d{2}[-/](\d{1,2})\b/)
  const slash = value.match(/\b(\d{1,2})[-/](?:19|20)\d{2}\b/)
  const num = iso?.[1] ?? slash?.[1]
  if (num) {
    const idx = Number.parseInt(num, 10) - 1
    if (idx >= 0 && idx < 12) month = MONTH_NAMES[idx]
  }
  if (!month) {
    const named = MONTH_NAMES.find((name) => new RegExp(`\\b${name.slice(0, 3)}`, "i").test(value))
    if (named) month = named
  }
  return { month, year }
}

/** Ordered option candidates for a Degree dropdown, mapped from a free-text
 *  résumé degree ("BSc Computer Science" → Bachelor's Degree, …). Returns null
 *  when no level is recognised so the raw text is typed instead. */
function degreeOptionCandidates(degree: string): string[] | null {
  const d = degree.toLowerCase()
  if (/\bmba\b|master of business/.test(d)) return ["Master of Business Administration", "MBA", "Master's Degree"]
  if (/\bph\.?d\b|doctor|d\.?phil/.test(d)) return ["Doctorate (PhD)", "Doctorate", "Doctor of Philosophy", "PhD"]
  if (/\bm\.?(s|sc|a|eng|ed|phil)\b|master/.test(d)) return ["Master's Degree", "Master of Science", "Master of Arts", "Master"]
  if (/\bb\.?(s|sc|a|eng|ba)\b|bachelor|undergrad/.test(d)) return ["Bachelor's Degree", "Bachelor of Science", "Bachelor of Arts", "Bachelor"]
  if (/\bassociate|a\.?a\b|a\.?s\b/.test(d)) return ["Associate's Degree", "Associate Degree", "Associate"]
  if (/high school|diploma|ged|secondary/.test(d)) return ["High School Diploma", "High School", "Secondary School"]
  return null
}

/**
 * Fill the Education section's dropdowns/inputs from `profile.resume_education`.
 * One résumé row per on-page block (blocks delimited by a repeated field role,
 * e.g. the next "School"). Never clobbers a field the user already answered and
 * never auto-clicks "Add another" — it fills the blocks already on the page.
 * Returns the number of fields it committed. Safe to run on any ATS.
 */
export async function fillEducationDropdowns(profile: SafeProfile, doc: Document = document): Promise<number> {
  const rows = Array.isArray(profile.resume_education) ? profile.resume_education : []
  if (rows.length === 0) return 0

  // Collect at the CONTROL level (not the deduped question collector): repeated
  // blocks share the label "School"/"Degree"/… so id-keyed dedup would collapse
  // the 2nd block, AND "Start date month" (dropdown) + "Start date year" (text)
  // often live in ONE row — a row-level single-role would capture only the month
  // and drop the year. Roling each control by its OWN label fixes both.
  const roled: Array<{ target: AshbyQuestionTarget; role: EduRole }> = []
  for (const row of collectAshbyRows(doc)) {
    if (!isElementUsable(row)) continue
    const controls = getControlsForRow(row)
    if (controls.length === 0) continue
    const rowLabel = getQuestionLabel(row)
    for (const control of controls) {
      // Prefer the control's own label; only fall back to the row label when the
      // row has a single control (else a shared label mis-assigns siblings).
      const own = ownControlLabel(control)
      const role =
        (own ? eduRoleFor(own) : null) ??
        (controls.length === 1 && rowLabel ? eduRoleFor(rowLabel) : null)
      if (!role) continue
      const label = own || rowLabel
      const target = buildQuestionTarget(row, label, [control])
      if (target) roled.push({ target, role })
    }
  }
  if (roled.length === 0) return 0

  // Group targets into per-entry blocks: a role that repeats (typically the
  // next "School") starts a new block.
  const blocks: Array<Partial<Record<EduRole, AshbyQuestionTarget>>> = []
  let current: Partial<Record<EduRole, AshbyQuestionTarget>> = {}
  for (const { target, role } of roled) {
    if (current[role]) {
      blocks.push(current)
      current = {}
    }
    current[role] = target
  }
  if (Object.keys(current).length > 0) blocks.push(current)

  let filled = 0
  for (let i = 0; i < blocks.length && i < rows.length; i += 1) {
    filled += await fillEducationBlock(blocks[i], rows[i])
  }
  return filled
}

async function fillEducationBlock(
  block: Partial<Record<EduRole, AshbyQuestionTarget>>,
  row: {
    institution?: string | null
    degree?: string | null
    field?: string | null
    start_date?: string | null
    end_date?: string | null
  },
): Promise<number> {
  let filled = 0
  const set = async (role: EduRole, value: string | null): Promise<void> => {
    const target = block[role]
    if (!target || !value) return
    if (isQuestionAnswered(target)) return // never overwrite a user's own pick
    if (await applyAnswerToTarget(target, value)) {
      filled += 1
      await sleep(70 + Math.round(Math.random() * 120))
    }
  }

  const degree = normalizeText(row.degree)
  const degreeCandidates = degree ? degreeOptionCandidates(degree) : null
  const start = parseEducationDate(row.start_date)
  const end = parseEducationDate(row.end_date)
  // A résumé often packs the whole span into one field ("2016 – 2020", or just a
  // single graduation year in end_date). Pull every year seen across both fields
  // so start/end year still fill when they aren't split cleanly.
  const allYears = `${normalizeText(row.start_date ?? null)} ${normalizeText(row.end_date ?? null)}`.match(/\b(?:19|20)\d{2}\b/g) ?? []
  const startYear = start.year ?? allYears[0] ?? null
  const endYear = end.year ?? (allYears.length > 1 ? allYears[allYears.length - 1] : null) ?? null

  await set("school", normalizeText(row.institution) || null)
  await set(
    "degree",
    degreeCandidates ? SOURCE_CANDIDATES_PREFIX + degreeCandidates.join("|") : degree || null,
  )
  await set("discipline", normalizeText(row.field) || null)
  await set("start_month", start.month)
  await set("start_year", startYear)
  await set("end_month", end.month)
  await set("end_year", endYear)
  return filled
}

async function fillAshbyTypeahead(input: HTMLInputElement, value: string, doc: Document): Promise<boolean> {
  try {
    input.focus()
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    input.click()
    const city = (value.split(",")[0] || value).trim()

    const collect = (): HTMLElement[] =>
      Array.from(
        doc.querySelectorAll<HTMLElement>(
          '[role="option"], [data-automation-id*="option" i], [class*="option" i], [class*="menuItem" i], li[role]',
        ),
      ).filter((el) => isElementUsable(el) && normalizeText(el.textContent).length > 0)

    for (const query of [value, city]) {
      setReactValue(input, query, { blur: false })
      let options: HTMLElement[] = []
      const deadline = Date.now() + 1800
      while (Date.now() < deadline) {
        options = collect()
        if (options.length) break
        await sleep(150)
      }
      if (options.length === 0) continue
      const match =
        options.find((o) => normalizeText(o.textContent).toLowerCase().includes(city.toLowerCase())) ?? options[0]
      match.scrollIntoView({ block: "center" })
      match.click()
      await sleep(250)
      if (normalizeText(input.value).length > 0) return true
    }

    // Fallback: accept the top suggestion with Enter.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }))
    await sleep(200)
    return normalizeText(input.value).length > 0
  } catch {
    return false
  }
}

async function waitForAshbyParserFill(
  profile: SafeProfile,
  doc: Document,
  timeoutMs: number,
): Promise<boolean> {
  const expectedCount = [
    fullName(profile),
    normalizeText(profile.email),
    normalizeText(profile.phone),
    locationValue(profile),
  ].filter(Boolean).length

  await sleep(900)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const filled = countFilledContactFields(profile, doc)
    if (filled >= Math.min(2, Math.max(expectedCount, 1))) return true
    if (filled > 0 && expectedCount <= 1) return true
    await sleep(350)
  }
  return countFilledContactFields(profile, doc) > 0
}

function countFilledContactFields(profile: SafeProfile, doc: Document): number {
  const targets: Array<[RegExp, string | null]> = [
    [/\b(full )?name\b|^name$/i, fullName(profile)],
    [/\bemail\b/i, normalizeText(profile.email)],
    [/\bphone\b|\bmobile\b|\btelephone\b/i, normalizeText(profile.phone)],
    [/\blocation\b|\bcity\b/i, locationValue(profile)],
  ]

  let count = 0
  for (const [labelRe, expected] of targets) {
    if (!expected) continue
    const control = findTextControlByLabel(doc, labelRe)
    if (!control) continue
    const value = normalizeText(control.value)
    if (value && value.toLowerCase() === expected.toLowerCase()) count += 1
    else if (value.length > 2) count += 1
  }
  return count
}

function findTextControlByLabel(doc: Document, re: RegExp): HTMLInputElement | HTMLTextAreaElement | null {
  const rows = collectAshbyRows(doc)
  for (const row of rows) {
    const label = getQuestionLabel(row)
    if (!re.test(label)) continue
    const control = row.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not([type=file]), textarea")
    if (control && isElementUsable(control)) return control
  }
  return null
}

export async function fillAshbyRequiredFields(args: {
  profile: SafeProfile
  doc?: Document
  autonomous?: boolean
  matchQuestions?: (questions: AshbyQuestionRequest[]) => Promise<AshbyMatchedAnswer[]>
}): Promise<AshbyQuestionFillSummary> {
  return fillRequiredAtsFields(args)
}

export async function fillRequiredAtsFields(args: {
  profile: SafeProfile
  doc?: Document
  /**
   * Hands-off apply run. In autonomous mode the AI must answer every REQUIRED
   * field so the agent can submit, so we (a) also send optional questions the
   * profile/résumé might answer, and (b) accept the model's best-effort answer
   * for required fields even at low confidence rather than dropping to manual.
   */
  autonomous?: boolean
  matchQuestions?: (questions: RequiredQuestionRequest[]) => Promise<RequiredMatchedAnswer[]>
}): Promise<RequiredFieldFillSummary> {
  const doc = args.doc ?? document
  const autonomous = args.autonomous === true
  const notes: AshbyFillNote[] = []
  let attemptedCount = 0
  let filledCount = 0

  // Deterministic answers that failed to APPLY (e.g. profile city "Lubbock, TX"
  // offered to a select whose options are other cities) must fall through to
  // the AI tier — otherwise the field is stranded empty with no retry.
  const deterministicFailed = new Set<string>()

  // The deterministic tier runs over EVERY question, required or not: its rules
  // fire only on specific high-confidence patterns (age-eligibility, consent
  // acknowledgements, salary, EEO-when-opted-in, …), so answering an unmarked
  // question is safe and often necessary — SmartRecruiters' screening step
  // leaves "Select all to acknowledge" consent blocks and spl-radio/spl-
  // autocomplete questions WITHOUT a required marker, yet they still gate
  // submission. Only the AI tier below stays required-only, to avoid
  // hallucinating answers to optional free-text.
  for (const target of collectAshbyQuestionTargets(doc, { requiredOnly: false, allowDiversity: args.profile.auto_fill_diversity === true })) {
    if (isQuestionAnswered(target)) continue
    const value = deterministicAnswerFor(target, args.profile)
    if (value === null) continue
    attemptedCount += 1
    const filled = await applyAnswerToTarget(target, value)
    if (filled) filledCount += 1
    else deterministicFailed.add(target.id)
    notes.push({
      label: target.label,
      valuePreview: previewAnswer(value),
      filled,
      skippedReason: filled ? undefined : "Could not set Ashby field value.",
    })
    if (filled) await sleep(70 + Math.round(Math.random() * 120))
  }

  // Which of the collected questions the ATS actually marks required — used
  // both to gate the AI tier and to flag required questions in the request.
  const requiredIds = new Set(
    collectAshbyQuestionTargets(doc, { requiredOnly: true, allowDiversity: args.profile.auto_fill_diversity === true }).map((t) => t.id),
  )

  // Fields the deterministic layer couldn't resolve, that MUST reach the AI:
  //  • every still-empty REQUIRED question (the agent can't submit without it),
  //  • PLUS any optional question whose deterministic answer FAILED to apply
  //    (e.g. profile city "Lubbock, TX" offered to a location select of other
  //    cities) — retrying via the AI beats stranding a field we already touched.
  // Optional questions we never attempted stay untouched: the AI tier must not
  // over-answer free-text (SmartRecruiters EEO, optional previous-employer
  // notes, …). Safe profile fields are still handled by applySafeFills().
  const aiRemaining = collectAshbyQuestionTargets(doc, { requiredOnly: false, allowDiversity: args.profile.auto_fill_diversity === true })
    .filter((target) => !isQuestionAnswered(target))
    .filter((target) => requiredIds.has(target.id) || deterministicFailed.has(target.id))
    .filter((target) => deterministicFailed.has(target.id) || !deterministicAnswerFor(target, args.profile))
    // Branch-dependent follow-ups ("If you selected international, …") must
    // never be AI-answered either — even when the ATS marks them required.
    .filter((target) => !isConditionalFollowUp(normalizeKey(target.label)))

  const remaining = aiRemaining.slice(0, 25)

  if (remaining.length > 0 && args.matchQuestions) {
    attemptedCount += remaining.length
    let answers: AshbyMatchedAnswer[] = []
    try {
      answers = await args.matchQuestions(remaining.map((t) => toQuestionRequest(t, requiredIds.has(t.id))))
    } catch {
      answers = []
    }
    const byId = new Map(answers.map((answer) => [answer.id, answer]))
    for (const target of remaining) {
      const answer = byId.get(target.id)
      const value = answer?.value ? normalizeText(answer.value) : ""
      // Required + autonomous: take the best-effort answer even at low
      // confidence (a wrong-but-editable answer beats blocking the whole
      // submit). Optional / assist: keep the conservative drop-on-uncertain.
      const acceptLowConfidence = autonomous && requiredIds.has(target.id)
      if (!value || (answer?.confidence === "low" && !acceptLowConfidence)) {
        notes.push({
          label: target.label,
          filled: false,
          skippedReason: "Needs manual review.",
        })
        continue
      }
      const filled = await applyAnswerToTarget(target, value)
      if (filled) filledCount += 1
      notes.push({
        label: target.label,
        valuePreview: previewAnswer(value),
        filled,
        skippedReason: filled ? undefined : "Could not set Ashby field value.",
      })
      if (filled) await sleep(70 + Math.round(Math.random() * 120))
    }
  } else {
    for (const target of remaining) {
      notes.push({
        label: target.label,
        filled: false,
        skippedReason: "Needs manual review.",
      })
    }
  }

  // ── LAST RESORT: required fields are never left as "needs review" ─────────
  // Product rule (ALL ATSs): a blank required field blocks the application.
  // Whatever the deterministic + AI tiers left unanswered gets a neutral,
  // user-editable fallback — sensitive/EEO → the decline option; yes/no → No;
  // option widgets → first real option; free text → "N/A". Nothing is ever
  // auto-submitted, so every fallback stays reviewable.
  const allowDiversity = args.profile.auto_fill_diversity === true
  const lastResort = collectAshbyQuestionTargets(doc, { requiredOnly: true, allowDiversity })
    .filter((target) => !isQuestionAnswered(target))
    .filter((target) => !isConditionalFollowUp(normalizeKey(target.label)))
  for (const target of lastResort) {
    attemptedCount += 1
    let value: string
    let filled: boolean
    if (isSensitiveAshbyQuestion(target.label, allowDiversity)) {
      value = SOURCE_CANDIDATES_PREFIX + DECLINE_ANSWER_CANDIDATES.join("|")
      filled = await applyAnswerToTarget(target, value)
    } else if (target.kind === "text" || target.kind === "textarea") {
      value = "N/A"
      filled = await applyAnswerToTarget(target, value)
    } else if (target.kind === "combobox") {
      // react-select whose options aren't in the DOM until opened. Do the
      // "No, else first option" choice in ONE open menu — two passes (try "no",
      // then pick-first) re-open the menu the first pass already opened, and the
      // second mousedown toggles it SHUT, leaving the field blank ("it still
      // left 1 required field"). Prefers a safe No/None/Prefer-not option (the
      // right answer for screening questions) and otherwise takes the first real
      // option so an arbitrary required select ("describe your AI-tool use") is
      // never left empty.
      value = PICK_NO_ELSE_FIRST
      filled = await applyAnswerToTarget(target, PICK_NO_ELSE_FIRST)
    } else {
      // Native/aria option widget — radio / select / button. Per the product +
      // user rule, an unsure REQUIRED question defaults to "No" (the safe answer
      // for "relatives here?", "reside in…?", "worked here before?"). Picking the
      // FIRST option instead wrongly chose "Yes". Only when "No" isn't an option
      // (a genuine multi-choice select) do we fall back to the first real option.
      // These widgets have no popup menu, so the two-pass toggle bug can't occur.
      value = "no"
      filled = await applyAnswerToTarget(target, "no")
      if (!filled) {
        value = PICK_FIRST_OPTION
        filled = await applyAnswerToTarget(target, PICK_FIRST_OPTION)
      }
    }
    if (filled) filledCount += 1
    notes.push({
      label: target.label,
      valuePreview: previewAnswer(value),
      filled,
      skippedReason: filled ? undefined : "Could not set a fallback value — fill manually.",
    })
    if (filled) await sleep(70 + Math.round(Math.random() * 120))
  }

  // ── TRIGGERED CONDITIONAL FOLLOW-UPS ─────────────────────────────────────
  // A follow-up ("If you answered extensively or moderately, list the AI tools
  // you use…") is normally skipped — its branch usually wasn't taken. But once
  // the tiers above auto-answer the PARENT with an option that satisfies the
  // condition (we pick "extensively" for an ungrounded required select), the
  // follow-up is now OUR obligation: leaving it blank blocks submit and makes
  // the application self-contradictory. Re-scan for follow-ups whose trigger the
  // form now meets and answer them (free text → AI-generated from the résumé;
  // option widgets → the normal safe fallback). Runs LAST so every parent answer
  // is already committed. Nothing is auto-submitted — the user reviews first.
  const followUps = collectAshbyQuestionTargets(doc, { requiredOnly: false, allowDiversity })
    .filter((target) => !isQuestionAnswered(target))
    .filter((target) => conditionalFollowUpTriggered(target.label, doc))
  if (followUps.length > 0) {
    const textFollowUps = followUps.filter((t) => t.kind === "text" || t.kind === "textarea")
    const optionFollowUps = followUps.filter((t) => t.kind !== "text" && t.kind !== "textarea")

    // Free-text follow-ups → AI. We created the obligation by picking the
    // triggering parent option, so accept the model's answer even at low
    // confidence rather than stranding a now-required field.
    if (textFollowUps.length > 0 && args.matchQuestions) {
      let answers: AshbyMatchedAnswer[] = []
      try {
        answers = await args.matchQuestions(textFollowUps.map((t) => toQuestionRequest(t, true)))
      } catch {
        answers = []
      }
      const byId = new Map(answers.map((a) => [a.id, a]))
      for (const target of textFollowUps) {
        attemptedCount += 1
        const value = normalizeText(byId.get(target.id)?.value)
        if (!value) {
          notes.push({ label: target.label, filled: false, skippedReason: "Needs manual review." })
          continue
        }
        const filled = await applyAnswerToTarget(target, value)
        if (filled) filledCount += 1
        notes.push({
          label: target.label,
          valuePreview: previewAnswer(value),
          filled,
          skippedReason: filled ? undefined : "Could not set the follow-up answer — fill manually.",
        })
        if (filled) await sleep(70 + Math.round(Math.random() * 120))
      }
    } else {
      for (const target of textFollowUps) {
        attemptedCount += 1
        notes.push({ label: target.label, filled: false, skippedReason: "Needs manual review." })
      }
    }

    // Option-widget follow-ups → the same safe fallback the last-resort uses.
    for (const target of optionFollowUps) {
      attemptedCount += 1
      const value = target.kind === "combobox" ? PICK_NO_ELSE_FIRST : "no"
      let filled = await applyAnswerToTarget(target, value)
      if (!filled && target.kind !== "combobox") filled = await applyAnswerToTarget(target, PICK_FIRST_OPTION)
      if (filled) filledCount += 1
      notes.push({
        label: target.label,
        valuePreview: previewAnswer(value),
        filled,
        skippedReason: filled ? undefined : "Could not set a fallback value — fill manually.",
      })
      if (filled) await sleep(70 + Math.round(Math.random() * 120))
    }
  }

  const manualReviewCount = collectAshbyQuestionTargets(doc, { requiredOnly: true, allowDiversity: args.profile.auto_fill_diversity === true })
    .filter((target) => !isQuestionAnswered(target))
    // A follow-up still counts as "needs review" only when its branch was
    // actually triggered (and we somehow couldn't fill it) — untriggered
    // follow-ups are effectively optional, so they don't inflate the count.
    .filter((target) => !isConditionalFollowUp(normalizeKey(target.label)) || conditionalFollowUpTriggered(target.label, doc))
    .length

  return { attemptedCount, filledCount, manualReviewCount, notes }
}

function previewAnswer(value: string): string {
  // Internal sentinels must never leak into the results panel.
  if (value === PICK_FIRST_OPTION) return "First available option"
  if (value === PICK_NO_ELSE_FIRST) return "No / first available option"
  if (value === PICK_ALL_OPTIONS) return "All boxes ticked"
  if (value.startsWith(SOURCE_CANDIDATES_PREFIX)) {
    const first = value.slice(SOURCE_CANDIDATES_PREFIX.length).split("|")[0] ?? ""
    return first ? `${first} (best match)` : "Best matching option"
  }
  if (/^(yes|no)$/i.test(value)) return value.toLowerCase() === "yes" ? "Yes" : "No"
  return value.length > 80 ? `${value.slice(0, 77)}...` : value
}

function toQuestionRequest(target: AshbyQuestionTarget, required: boolean): AshbyQuestionRequest {
  return {
    id: target.id,
    label: target.label,
    type: target.type,
    required,
    ...(target.options?.length ? { options: target.options } : {}),
  }
}

function collectAshbyQuestionTargets(
  doc: Document,
  opts: { requiredOnly: boolean; allowDiversity?: boolean },
): AshbyQuestionTarget[] {
  const rows = collectAshbyRows(doc)
  const targets: AshbyQuestionTarget[] = []
  // Dedup by the specific field (target id includes the control's id/name), NOT
  // by label — some Greenhouse forms (e.g. STR) render two DISTINCT questions
  // with the same label ("Desired Salary?"), and both must be filled.
  const seenTargets = new Set<string>()
  const seenControls = new Set<HTMLElement>()

  for (const row of rows) {
    if (!isElementUsable(row)) continue
    const label = getQuestionLabel(row)
    if (!label) continue
    if (PHONE_COUNTRY_WIDGET_RE.test(label)) continue
    // Site chrome (nav search, newsletter) is never an application question.
    if (/^search\b( for| jobs)?:?$/i.test(label.trim())) continue
    if (row.closest("nav, [role='navigation'], [role='search']")) continue
    const controls = getControlsForRow(row)
    if (controls.length === 0) continue
    if (controls.some((el) => el instanceof HTMLInputElement && el.type === "file")) continue
    if (opts.requiredOnly && !hasRequiredSignal(row, controls, doc)) continue
    // Skip if this exact control was already captured by another row.
    if (controls.every((c) => seenControls.has(c))) continue

    const target = buildQuestionTarget(row, label, controls)
    if (!target) continue
    if (
      isSensitiveAshbyQuestion(label, opts.allowDiversity === true) &&
      !canDeclineSensitiveQuestion(target)
    ) {
      continue
    }
    if (seenTargets.has(target.id)) continue
    seenTargets.add(target.id)
    target.controls.forEach((c) => seenControls.add(c))
    targets.push(target)
  }

  return targets
}

function isSensitiveAshbyQuestion(label: string, allowDiversity: boolean): boolean {
  const normalized = normalizeKey(label)
  if (/\bredact\b|\bage identifying\b|\bcandidate privacy\b|\bprivacy notice\b/.test(normalized)) {
    return false
  }
  if (ALWAYS_SKIP_QUESTION_RE.test(label)) return true
  // Demographics fill only when the user enabled EEO auto-fill in their profile.
  if (DEMOGRAPHIC_QUESTION_RE.test(label)) return !allowDiversity
  return false
}

function canDeclineSensitiveQuestion(target: AshbyQuestionTarget): boolean {
  if (target.options?.some((option) => /prefer not|do not want|don't want|decline|do not wish|don't wish/i.test(option))) {
    return true
  }
  return target.kind === "combobox" || target.kind === "select" || target.kind === "radio" || target.kind === "button"
}

function collectAshbyRows(doc: Document): HTMLElement[] {
  const root = findAshbyRoot(doc) ?? doc.body
  // Seed rows from native controls AND custom checkable web components:
  // SmartRecruiters' screening step renders <spl-radio role="radio"> with NO
  // native input anywhere, so seeding from inputs alone finds zero rows.
  const controls = [
    ...queryAllDeep<HTMLElement>(root, FORM_CONTROL_SELECTOR),
    ...queryAllDeep<HTMLElement>(root, "[role='radio']:not(input), [role='checkbox']:not(input)"),
  ]
    .filter(isElementUsable)
  const seen = new Set<HTMLElement>()
  const rows: HTMLElement[] = []

  for (const control of controls) {
    const row = findRowForControl(control)
    if (!row || seen.has(row)) continue
    seen.add(row)
    rows.push(row)
  }

  return rows
}

function findAshbyRoot(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(
    "._ashby-application-form, ._ashby-application-form-container form, form[action*='ashby'], form[action*='ashbyhq'], form[data-testid*='apply'], form",
  )
}

/**
 * Count QUESTIONS inside a node, not raw controls: radios/checkboxes sharing a
 * name are ONE question. Without this, a "How did you hear about us?" group
 * with 10 radio options blew past the >8 safety break and shattered into 10
 * bogus per-option "questions" labeled "Campus visit", "Referral", … (the EEO
 * Race group failed the same way).
 */
function controlGroupCount(node: HTMLElement): number {
  const seen = new Set<string>()
  let count = 0
  for (const el of queryAllDeepWithin<HTMLElement>(node, FORM_CONTROL_SELECTOR)) {
    if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox") && el.name) {
      const key = `grp:${el.name}`
      if (!seen.has(key)) {
        seen.add(key)
        count += 1
      }
    } else {
      count += 1
    }
  }
  return count
}

// Inline validation phrases that must never be mistaken for a question label.
// NOTE: cleanLabel() strips a trailing " required", so match the stripped
// forms too ("Value is required" → "Value is").
const VALIDATION_TEXT_RE =
  /^(value is( required)?|this field( is required)?|field is( required)?|required|invalid|please (provide|enter) a valid.*)$/i

function findRowForControl(control: HTMLElement): HTMLElement | null {
  // deepParentElement hops shadow boundaries (spl-input's inner <input> →
  // host → light-DOM row) so web-component controls resolve to real rows.
  // Depth 12: nested web-component widgets (SmartRecruiters screening) put
  // 8-10 wrappers between the inner <input> and the question row.
  let fallback: HTMLElement | null = deepParentElement(control)
  let node: HTMLElement | null = deepParentElement(control)
  for (let depth = 0; node && depth < 12; depth += 1, node = deepParentElement(node)) {
    // Custom elements name their ROLE in the tag, not the class —
    // <sr-question-field-radio> has an empty className. Match both.
    const className = `${typeof node.className === "string" ? node.className : ""} ${node.tagName.toLowerCase()}`
    const controls = controlGroupCount(node)
    if (/^spl-(radio-group|checkbox|autocomplete|multiselect-autocomplete|textarea)$/i.test(node.tagName)) {
      const candidateLabel = cleanLabel(getQuestionLabel(node))
      if (candidateLabel && !VALIDATION_TEXT_RE.test(candidateLabel)) return node
      fallback = node
      continue
    }
    // Field-level wrapper — but ONLY when it holds a small number of controls.
    // Greenhouse's whole section is "application--questions" (matches /question/)
    // with ~10 controls; matching it would group every field into one row under
    // the wrong label. The controls<=4 guard keeps us at the real field wrapper
    // (e.g. "field-wrapper"). "field-wrap" added so plain text fields resolve.
    if (
      /fieldentry|field-entry|field-wrap|application-question|form-field|question/i.test(className) &&
      controls <= 4
    ) {
      // A wrapper with NO question text is the widget's own plumbing
      // (<spl-internal-form-field> matches /form-field/ but carries nothing) —
      // keep climbing to the row that actually holds the question. Validation
      // messages ("Value is required") are NOT question text.
      const candidateLabel = cleanLabel(getQuestionLabel(node))
      if (candidateLabel && !VALIDATION_TEXT_RE.test(candidateLabel)) return node
      fallback = node
      continue
    }
    // Generic wrapper — only accept it when it carries a QUESTION label, i.e.
    // a legend/label/[class*=label] that does NOT wrap a control. A radio
    // group's <ul> has only option labels (each wrapping its input); stopping
    // there made the question label collapse to "Yes"/"No" (Lever multiple-
    // choice bug: sponsorship/work-auth rules never matched the row).
    if (controls > 1 && controls <= 4 && hasNonWrappingLabel(node)) return node
    if (controls === 1 && node.querySelector("label, [class*='label' i]")) fallback = node
    if (controls > 8) break
  }
  return fallback
}

function hasNonWrappingLabel(node: HTMLElement): boolean {
  return Array.from(node.querySelectorAll<HTMLElement>("legend, label, [class*='label' i]")).some(
    (lbl) => !lbl.querySelector(FORM_CONTROL_SELECTOR) && Boolean(normalizeText(lbl.textContent)),
  )
}

function getControlsForRow(row: HTMLElement): HTMLElement[] {
  const controls = queryAllDeepWithin<HTMLElement>(row, FORM_CONTROL_SELECTOR)
    .filter(isElementUsable)

  const roleControls = Array.from(
    queryAllDeepWithin<HTMLElement>(
      row,
      "[role='radio'], [role='checkbox'], [role='option'], button, [aria-pressed]",
    ),
  )
    .filter(isElementUsable)
    .filter((el) => {
      // spl-radio keeps its "Yes"/"No" text in a label attribute / its shadow
      // tree — plain textContent is EMPTY, so use the role-aware label.
      const text = normalizeText(roleOptionLabel(el))
      if (!text) return false
      if (/submit|apply|continue|next|upload file/i.test(text)) return false
      return true
    })

  return [...controls, ...roleControls]
}

function getQuestionLabel(row: HTMLElement): string {
  const legend = row.querySelector<HTMLElement>("legend")
  if (legend?.textContent) return cleanLabel(legend.textContent)

  // Web-component hosts carry the label as an ATTRIBUTE (<spl-input
  // label="First name">) — shadow content never appears in textContent.
  // EXCLUDE checkable options: <spl-radio label="Yes"> is an OPTION label,
  // not the question ("Are you under 18?" must not become "Yes").
  const NOT_OPTION = ":not([role='radio']):not([role='checkbox']):not(spl-radio):not(spl-checkbox)"
  const attrHost = row.matches?.(`[label]${NOT_OPTION}`) ? row : row.querySelector<HTMLElement>(`[label]${NOT_OPTION}`)
  const attrLabel = attrHost?.getAttribute("label")
  if (attrLabel?.trim()) return cleanLabel(attrLabel)

  const labels = Array.from(row.querySelectorAll<HTMLElement>("label, [class*='label' i], [data-testid*='label' i]"))
  for (const label of labels) {
    if (label.querySelector("input, select, textarea")) continue
    const text = cleanLabel(label.textContent)
    if (text) return text
  }

  const text = cleanLabel(row.textContent)
  if (text && !VALIDATION_TEXT_RE.test(text)) {
    return text
      .replace(/\b(Yes|No|Prefer not to answer|Select|Choose)\b\s*$/gi, "")
      .replace(/\s*\b\d+\/\d+\b\s*$/g, "") // trailing char counters ("0/200")
      .replace(/\s*\bValue is required\b\s*/gi, " ")
      .trim()
  }

  // Last resort: the control's own placeholder / aria-label (SmartRecruiters
  // EEO typeaheads carry "Gender" / "Race/Ethnicity" ONLY there; the salary
  // input carries "Salary in USD"). Without this the question is dropped.
  const firstControl = queryAllDeepWithin<HTMLElement>(row, FORM_CONTROL_SELECTOR)[0]
  if (firstControl) {
    const hint =
      firstControl.getAttribute("placeholder") ??
      firstControl.getAttribute("aria-label") ??
      (firstControl.getRootNode() instanceof ShadowRoot
        ? ((firstControl.getRootNode() as ShadowRoot).host.getAttribute("label") ??
           (firstControl.getRootNode() as ShadowRoot).host.getAttribute("placeholder"))
        : null)
    if (hint?.trim() && !VALIDATION_TEXT_RE.test(hint)) return cleanLabel(hint)
  }
  return ""
}

function hasRequiredSignal(row: HTMLElement, controls: HTMLElement[], doc: Document): boolean {
  if (
    row.hasAttribute("required") ||
    row.getAttribute("aria-required") === "true" ||
    row.getAttribute("data-required") === "true" ||
    queryAllDeepWithin(row, '[required],[aria-required="true"],[data-required="true"]').length > 0
  ) {
    return true
  }
  if (controls.some((control) => control.hasAttribute("required") || control.getAttribute("aria-required") === "true")) {
    return true
  }
  if (
    controls.some((control) => control.getAttribute("aria-invalid") === "true") &&
    /\b(required|missing|blank|empty|invalid|must|please)\b/i.test(row.textContent ?? "")
  ) {
    return true
  }
  if (/\*/.test(row.textContent ?? "")) return true
  const missing = missingRequiredLabels(doc)
  if (missing.length === 0) return false
  const labelKey = normalizeKey(getQuestionLabel(row))
  return missing.some((item) => item.includes(labelKey) || labelKey.includes(item))
}

function missingRequiredLabels(doc: Document): string[] {
  const text = normalizeText(doc.body?.textContent ?? "")
  if (!/missing entry for required field/i.test(text)) return []
  return text
    .split(/missing entry for required field\s*:/i)
    .slice(1)
    .map((part) => normalizeKey(part.split(" Missing entry for required field")[0] ?? part).slice(0, 220))
    .filter(Boolean)
}

function buildQuestionTarget(
  row: HTMLElement,
  label: string,
  controls: HTMLElement[],
): AshbyQuestionTarget | null {
  const nativeControls = controls.filter((el): el is FormControlElement =>
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement,
  )

  const radios = nativeControls.filter((el): el is HTMLInputElement =>
    el instanceof HTMLInputElement && el.type === "radio",
  )
  if (radios.length > 0) {
    const options = dedupe(radios.map((radio) => getOptionLabel(radio, row)).filter(Boolean))
    return {
      id: buildTargetId(row, label),
      label,
      type: isYesNoOptions(options) ? "yesno" : "select",
      options,
      row,
      controls: radios,
      kind: "radio",
    }
  }

  const roleOptions = controls.filter((el) => {
    const role = el.getAttribute("role")
    return role === "radio" || role === "option" || el.tagName.toLowerCase() === "button" || el.hasAttribute("aria-pressed")
  })
  if (roleOptions.length > 0 && !nativeControls.some((el) => el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type))) {
    const options = dedupe(roleOptions.map((option) => roleOptionLabel(option)).filter(Boolean))
    return {
      id: buildTargetId(row, label),
      label,
      type: isYesNoOptions(options) ? "yesno" : "select",
      options,
      row,
      controls: roleOptions,
      kind: "button",
    }
  }

  const select = nativeControls.find((el): el is HTMLSelectElement => el instanceof HTMLSelectElement)
  if (select) {
    const options = Array.from(select.options)
      .map((option) => normalizeText(option.textContent || option.value))
      .filter((option) => option && !/^select|choose|--$/i.test(option))
    return {
      id: buildTargetId(row, label),
      label,
      type: isYesNoOptions(options) ? "yesno" : "select",
      options: dedupe(options),
      row,
      controls: [select],
      kind: "select",
    }
  }

  const checkboxes = nativeControls.filter((el): el is HTMLInputElement =>
    el instanceof HTMLInputElement && el.type === "checkbox",
  )
  // A group of 2+ checkboxes is a "select all that apply" multi-select, NOT a
  // single yes/no consent — capture every option so we can tick one/some.
  if (checkboxes.length > 1) {
    const options = dedupe(checkboxes.map((cb) => getOptionLabel(cb, row)).filter(Boolean))
    return {
      id: buildTargetId(row, label),
      label,
      type: "select",
      options,
      row,
      controls: checkboxes,
      kind: "checkbox",
    }
  }
  if (checkboxes.length === 1) {
    return {
      id: buildTargetId(row, label),
      label,
      type: "yesno",
      options: ["Yes", "No"],
      row,
      controls: [checkboxes[0]],
      kind: "checkbox",
    }
  }

  const semanticInput = pickSemanticTextInput(label, nativeControls)
  if (semanticInput) {
    return {
      id: buildTargetId(row, label),
      label,
      type: "text",
      row,
      controls: [semanticInput],
      kind: "text",
    }
  }

  const textarea = nativeControls.find((el): el is HTMLTextAreaElement => el instanceof HTMLTextAreaElement)
  if (textarea) {
    return {
      id: buildTargetId(row, label),
      label,
      type: "textarea",
      row,
      controls: [textarea],
      kind: "textarea",
    }
  }

  // A react-select combobox is an <input type=text> too, so classify it BEFORE
  // the plain-text branch — otherwise it'd be treated as fillable text and a
  // value-set would silently fail to register a selection.
  const combobox = nativeControls.find(
    (el): el is HTMLInputElement => el instanceof HTMLInputElement && isComboboxInput(el),
  )
  if (combobox) {
    return {
      id: buildTargetId(row, label),
      label,
      type: "select",
      row,
      controls: [combobox],
      kind: "combobox",
    }
  }

  const input = nativeControls.find((el): el is HTMLInputElement =>
    el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has((el.type ?? "").toLowerCase()),
  )
  if (input) {
    return {
      id: buildTargetId(row, label),
      label,
      type: "text",
      row,
      controls: [input],
      kind: "text",
    }
  }

  return null
}

function pickSemanticTextInput(label: string, controls: FormControlElement[]): HTMLInputElement | null {
  const labelKey = normalizeKey(label)
  const wantsPhone = /\b(phone|mobile|telephone)\b/.test(labelKey)
  const wantsEmail = /\bemail\b/.test(labelKey)
  const wantsFirstName = /\bfirst name\b/.test(labelKey)
  const wantsLastName = /\blast name\b/.test(labelKey)
  if (!wantsPhone && !wantsEmail && !wantsFirstName && !wantsLastName) return null

  const inputs = controls.filter((el): el is HTMLInputElement =>
    el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has((el.type ?? "").toLowerCase()) && !isComboboxInput(el),
  )
  const matches = (input: HTMLInputElement): boolean => {
    const key = normalizeKey([
      input.id,
      input.name,
      input.getAttribute("aria-label") ?? "",
      input.getAttribute("placeholder") ?? "",
      input.getAttribute("autocomplete") ?? "",
      input.type,
    ].join(" "))
    if (wantsPhone) return /\b(phone|mobile|tel|telephone)\b/.test(key)
    if (wantsEmail) return /\bemail\b/.test(key)
    if (wantsFirstName) return /\bfirst name\b|\bfirst\b|\bgiven name\b/.test(key)
    if (wantsLastName) return /\blast name\b|\blast\b|\bfamily name\b|\bsurname\b/.test(key)
    return false
  }
  return inputs.find(matches) ?? null
}

function buildTargetId(row: HTMLElement, label: string): string {
  const control = queryAllDeepWithin<HTMLElement>(row, FORM_CONTROL_SELECTOR)[0] ?? row.querySelector<HTMLElement>(FORM_CONTROL_SELECTOR)
  const raw = control?.id || control?.getAttribute("name") || label
  return `ashby:${normalizeKey(raw).slice(0, 90)}`
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = cleanLabel(value)
    if (!clean) continue
    const key = normalizeKey(clean)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function isYesNoOptions(options: string[] | undefined): boolean {
  if (!options || options.length === 0) return false
  const keys = options.map((option) => normalizeKey(option))
  return keys.some((key) => key === "yes" || key === "y") && keys.some((key) => key === "no" || key === "n")
}

/**
 * Human label for a role-based/custom option control (spl-radio, role=radio
 * buttons). The text may live in a `label` attribute, aria-label, light-DOM
 * textContent, or the component's own shadow tree — check all of them.
 */
function roleOptionLabel(el: HTMLElement): string {
  const attr = el.getAttribute("label") ?? el.getAttribute("aria-label")
  if (attr?.trim()) return cleanLabel(attr)
  const light = cleanLabel(el.textContent)
  if (light) return light
  const shadow = el.shadowRoot ? cleanLabel(el.shadowRoot.textContent) : ""
  if (shadow) return shadow
  return cleanLabel(el.getAttribute("value"))
}

function getOptionLabel(input: HTMLInputElement, row: HTMLElement): string {
  if (input.id) {
    const lbl = input.ownerDocument.querySelector<HTMLLabelElement>(`label[for="${cssEscape(input.id)}"]`)
    if (lbl?.textContent) return cleanLabel(lbl.textContent)
  }
  const wrapping = input.closest("label")
  if (wrapping?.textContent) {
    const text = cleanLabel(wrapping.textContent)
    if (text && normalizeKey(text) !== normalizeKey(getQuestionLabel(row))) return text
  }
  const aria = input.getAttribute("aria-label")
  if (aria) return cleanLabel(aria)
  return cleanLabel(input.value)
}

function isQuestionAnswered(target: AshbyQuestionTarget): boolean {
  if (target.kind === "text" || target.kind === "textarea") {
    const control = target.controls[0] as HTMLInputElement | HTMLTextAreaElement | undefined
    return Boolean(normalizeText(control?.value))
  }
  if (target.kind === "select") {
    const select = target.controls[0] as HTMLSelectElement | undefined
    if (!select) return false
    const selected = select.options[select.selectedIndex]
    const label = normalizeText(selected?.textContent || selected?.value)
    return Boolean(normalizeText(select.value)) && !/^select|choose|--$/i.test(label)
  }
  if (target.kind === "combobox") {
    return comboboxCommitted(target.controls[0], target.row)
  }
  if (target.kind === "radio") {
    return target.controls.some((control) => control instanceof HTMLInputElement && control.checked)
  }
  if (target.kind === "checkbox") {
    return target.controls.some((control) => control instanceof HTMLInputElement && control.checked)
  }
  // Custom option groups (Ashby Yes/No BUTTONS, spl-radio, aria toggles) mark
  // the chosen option with aria-* OR a state CLASS. Ashby uses "_active_*" (no
  // aria at all), so an aria-only check reports an answered question as empty →
  // inflated manual-review count and, on a re-scan, a re-click that toggles the
  // answer back OFF. Match the state class too (same rule as the submit-guard's
  // selectedLike; \b misses "_active" since "_" is a word char).
  return target.controls.some(
    (control) =>
      control.getAttribute("aria-checked") === "true" ||
      control.getAttribute("aria-selected") === "true" ||
      control.getAttribute("aria-pressed") === "true" ||
      /(?:^|[^a-z])(?:active|checked|selected)(?:[^a-z]|$)/i.test(
        typeof control.className === "string" ? control.className : "",
      ),
  )
}

/**
 * Conditional follow-up qualifiers — "If yes, …", "If you selected international,
 * …", "If Industry Conference or Other, please provide details". Their answer
 * depends on a branch the applicant didn't take, so a generic profile value is
 * wrong (the "Lubbock, TX in the international box" / "no in the what-type-of-
 * sponsorship box" bug). Leave them blank; they are effectively always optional.
 */
function isConditionalFollowUp(key: string): boolean {
  return /^if\b/.test(key)
}

/**
 * True when a conditional follow-up's "if <…>" branch was actually taken —
 * e.g. the parent question is now answered "extensively" and the follow-up
 * reads "If you answered extensively or moderately, list the AI tools…". Only
 * then should the follow-up be filled; otherwise it stays skipped (its branch
 * wasn't taken, so any answer would be wrong). Conservative: when the trigger
 * clause can't be parsed or nothing on the form matches it, returns false.
 */
function conditionalFollowUpTriggered(label: string, doc: Document): boolean {
  const key = normalizeKey(label)
  if (!isConditionalFollowUp(key)) return false
  // Isolate the condition clause: text after "if" up to the instruction part
  // ("please list…", "provide…", "to the above question", a comma or colon).
  const match =
    /^if\s+(.*?)(?:\bthen\b|\bplease\b|\bprovide\b|\blist\b|\bdescribe\b|\bexplain\b|\bto the above\b|[,:]|$)/.exec(key)
  const clause = (match?.[1] ?? "").trim()
  if (!clause) return false

  // Trigger tokens = the option words that satisfy the condition, minus filler.
  // "you answered extensively or moderately" → [extensively, moderately];
  // "yes" → [yes]; "you selected other" → [other].
  const stop = new Set([
    "you", "your", "the", "a", "an", "answered", "answer", "selected", "select", "chose", "choose",
    "have", "has", "had", "any", "above", "question", "questions", "to", "of", "is", "are", "was",
    "were", "and", "or", "response", "responded", "this", "that", "for", "with", "in", "on", "at",
  ])
  const tokens = clause
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stop.has(token))
  if (tokens.length === 0) return false

  const answered = collectAnsweredOptionTexts(doc).join(" | ").toLowerCase()
  if (!answered) return false
  return tokens.some((token) => answered.includes(token))
}

/**
 * Text of every currently-selected answer on the form — react-select chips,
 * checked radios/checkboxes, aria-selected custom options, and non-placeholder
 * native <select> values. Used to evaluate conditional follow-up triggers.
 */
function collectAnsweredOptionTexts(doc: Document): string[] {
  const out: string[] = []
  const push = (text: string) => {
    const value = normalizeText(text)
    if (value) out.push(value)
  }
  for (const chip of queryAllDeep<HTMLElement>(
    doc,
    '[class*="singleValue" i], [class*="single-value" i], [class*="multiValue" i], [class*="multi-value" i]',
  )) {
    push(chip.textContent ?? "")
  }
  for (const input of queryAllDeep<HTMLInputElement>(doc, 'input[type="radio"], input[type="checkbox"]')) {
    if (!input.checked) continue
    const row = findRowForControl(input)
    push(row ? getOptionLabel(input, row) : input.value)
  }
  for (const el of queryAllDeep<HTMLElement>(
    doc,
    '[aria-checked="true"], [aria-selected="true"], [aria-pressed="true"]',
  )) {
    push(roleOptionLabel(el))
  }
  for (const select of queryAllDeep<HTMLSelectElement>(doc, "select")) {
    const option = select.options[select.selectedIndex]
    const text = normalizeText(option?.textContent || option?.value)
    if (text && !/^select|choose|--$/i.test(text)) push(text)
  }
  return out
}

function deterministicAnswerFor(target: AshbyQuestionTarget, profile: SafeProfile): string | null {
  const label = target.label
  const key = normalizeKey(label)

  if (isConditionalFollowUp(key)) return null

  // User-saved answers from the dashboard profile beat every heuristic —
  // the user wrote these specifically for questions like this.
  for (const qa of profile.custom_answers ?? []) {
    const answer = normalizeText(qa?.answer)
    if (!answer || !qa?.question_pattern) continue
    try {
      if (new RegExp(qa.question_pattern, "i").test(label)) return answer
    } catch {
      // invalid user-supplied pattern — ignore
    }
  }

  if (/\b(full name|candidate name|full legal name|legal name)\b|^name$/.test(key)) return fullName(profile)

  // Bare "Date" / "Today's date" / signature-date fields (the EEO / disability
  // self-identification signature block). Birth/start/end dates never reach
  // here — DOB rows are skipped as sensitive and start dates have their own
  // rule below.
  if (/^date$|^today s date$|\bsignature date\b|\bdate signed\b|\bdate of (signature|application)\b/.test(key)) {
    const now = new Date()
    const mm = String(now.getMonth() + 1).padStart(2, "0")
    const dd = String(now.getDate()).padStart(2, "0")
    return `${mm}/${dd}/${now.getFullYear()}`
  }
  if (/\bemail\b/.test(key)) return normalizeText(profile.email) || null
  if (/\bphone\b|\bmobile\b|\btelephone\b/.test(key)) return normalizeText(profile.phone) || null
  if (
    (target.kind === "combobox" || target.kind === "select" || target.kind === "checkbox") &&
    /\bfull\s*time\b.*\bpart\s*time\b|\bpart\s*time\b.*\bfull\s*time\b/.test(key)
  ) {
    return SOURCE_CANDIDATES_PREFIX + ["Either", "Full-Time", "Full Time", "Part-Time", "Part Time"].join("|")
  }
  if (
    (target.kind === "combobox" || target.kind === "select" || target.kind === "checkbox") &&
    (/\b(days?|shifts?)\b.*\bavailable\b|\bavailable\b.*\b(days?|shifts?)\b|\bavailable to work\b/.test(key))
  ) {
    return PICK_FIRST_OPTION
  }
  if (
    (target.kind === "combobox" || target.kind === "select" || target.kind === "checkbox") &&
    /\b(additional|other)\s+positions?\b.*\binterested\b|\binterested\b.*\b(additional|other)\s+positions?\b/.test(key)
  ) {
    return PICK_FIRST_OPTION
  }
  if (/which (other )?country are you a citizen of|country of (second|dual) citizenship/.test(key)) return "N/A"
  if (/\bpreferred (location|office|site|work location)\b|\blocation preference\b/.test(key)) {
    return PICK_FIRST_OPTION
  }
  if (/\blocation city\b|^city$|^current city\b|candidate location/.test(key)) {
    return locationValue(profile) || normalizeText(profile.city) || normalizeText(profile.state) || null
  }
  if (/\blocation\b|\bcity\b/.test(key) && !/\bpreferred\b|\bpreference\b/.test(key)) return locationValue(profile)
  if (/\bwhere have you most recently worked\b|\bmost recent(ly)? worked\b|\bcurrent employer\b/.test(key)) {
    return currentCompany(profile)
  }

  if (/\bprivacy notice\b|\bprocess your personal information\b|\bcandidate privacy\b/.test(key)) {
    return "yes"
  }

  // Age-eligibility screens ("Are you under the age of 18?", "Are you at
  // least 18 years of age?") — legal work-eligibility questions, NOT EEO
  // demographics (the server strips anything matching \bage\b, so these must
  // be answered client-side). Hireoven users are adults.
  if (/\bunder (the age of )?18\b/.test(key)) return "no"
  if (/\bat least 18\b|\b18 years (of age|or older)\b|\bover (the age of )?18\b|\b18 or older\b/.test(key)) return "yes"
  if (/\b(agree|accept|acknowledge|consent|certify|confirm)\b/.test(key) && target.kind === "checkbox") {
    // Multi-checkbox consent blocks ("Select all — by selecting all, you
    // acknowledge…") need every box ticked, not a "yes" that matches nothing.
    return target.controls.length > 1 ? PICK_ALL_OPTIONS : "yes"
  }
  if (/\bredact\b|\bage identifying\b|\bschool attendance\b|\bgraduation\b/.test(key)) {
    return "yes"
  }

  // Sponsorship / work-authorization — shared across every adapter so the
  // answer is identical everywhere (OPT/STEM OPT/H-1B/… → No sponsorship, Yes
  // authorized).
  const wa = workAuthAnswer(label, {
    workAuthorization: profile.work_authorization,
    requiresSponsorship: profile.requires_sponsorship,
    authorizedToWork: profile.authorized_to_work,
  })
  // workAuthAnswer already confirmed this is a sponsorship/authorization
  // question, but its "authoriz" test is broad (it would also fire on
  // "authorize a background check"), so only apply the answer when the label
  // carries real work / employment / visa context. Covers the common phrasings
  // "…have unrestricted work authorization…", "authorized to work", "eligible
  // to work", "right to work", not just "work authorization STATUS".
  const authWorkContext =
    /\bsponsor/.test(key) ||
    /\bwork authoriz|\bwork authoris/.test(key) || // "…have unrestricted work authorization…"
    /\bauthoriz\w*\s+to\s+work\b|\bauthoris\w*\s+to\s+work\b/.test(key) || // "authorized to work"
    /\beligible to work\b|\bright to work\b|\bwork permit\b/.test(key) ||
    /\blegally\s+(authoriz|authoris|able|entitled|permitted)/.test(key)
  if (wa && authWorkContext) {
    return wa
  }

  // Country selector (Greenhouse Country dropdown). Checked AFTER dual-country
  // free-text and yes/no work-auth branches above, since those labels also
  // mention "country" and should not receive the profile country.
  if (/\bcountry\b/.test(key) && target.kind !== "radio" && target.kind !== "checkbox" && target.type !== "yesno" && target.kind !== "text") {
    const country = normalizeText(profile.country)
    return country ? normalizeCountryAnswer(country) : null
  }

  if (/\bsnowflake\b/.test(key) && /\b(worked|employee|employed|past|previous)\b/.test(key)) {
    return hasCompany(profile, /\bsnowflake\b/i) ? "yes" : "no"
  }
  if (/\b(pricewaterhousecoopers|pwc)\b/.test(key)) {
    return hasCompany(profile, /\b(pricewaterhousecoopers|pwc)\b/i) ? "yes" : "no"
  }
  if (
    // "…previously/ever employed/worked AT/BY/FOR/WITH/HERE <company>?" — the
    // "at"/"here" phrasings ("Have you ever been employed at Precisely?") are as
    // common as "by/for". Require a company preposition so we don't match
    // "ever worked in a team".
    /\b(previously|formerly|ever|before)\b[^?.!]{0,60}\b(employ|work)\w*\b[^?.!]{0,40}\b(at|by|for|with|here|this)\b/.test(key) ||
    /\b(employ|work)\w*\b[^?.!]{0,40}\b(previously|formerly|before)\b/.test(key)
  ) {
    return "no"
  }
  if (
    /\bgovernment\b|\bmilitary\b|\bstate owned\b|\bpublicly funded\b|\bprocurement\b/.test(key) &&
    profileHasWorkHistory(profile)
  ) {
    const governmentLike = /\b(government|military|army|navy|air force|department of|ministry|state owned|publicly funded)\b/i
    return hasCompany(profile, governmentLike) ? "yes" : "no"
  }

  // Citizenship — driven by work-authorization status. Someone on a work visa
  // (OPT/H-1B/…) is not a U.S. citizen; "citizen" in the status means Yes.
  if (/\bu s citizen\b|\bus citizen\b|\bunited states citizen\b|\bare you a citizen\b|\bcitizen of the (u s|united states)\b/.test(key)) {
    if (isCurrentlyAuthorizedVisa(profile.work_authorization)) return "no"
    if (/\bcitizen\b/.test(normalizeKey(profile.work_authorization ?? "")) && !/not/.test(normalizeKey(profile.work_authorization ?? ""))) return "yes"
    return null
  }
  // Dual citizenship — no profile field; default No for a single-nationality
  // applicant. The "which country" free-text is then N/A.
  if (/\bdual citizen/.test(key)) return "no"
  // Security clearance — default to "no clearance". Wording varies
  // ("None" / "No Clearance" / "No security clearance"), so try candidates.
  if (/security clearance|clearance and access|clearance level|do you (currently )?hold.*clearance|highest level.*clearance/.test(key)) {
    return SOURCE_CANDIDATES_PREFIX + ["No Clearance", "None", "No security clearance", "No"].join("|")
  }
  // "Do you have relatives who work for …" / referral name prompts.
  // Yes/No widgets get "No"; free-text referral boxes get "N/A" — offering
  // "N/A" to a Yes/No radio matches nothing and strands the question.
  if (/relatives?.*(work|employ)|(work|employ).*relatives?|do you know (anyone|someone)/.test(key)) {
    // Only a free-TEXT referral box gets "N/A"; any option widget (radio, select,
    // AND react-select combobox — whose Yes/No options aren't in the DOM yet) gets
    // "no", the correct answer for "do you have relatives here?".
    return target.kind === "text" || target.kind === "textarea" ? "N/A" : "no"
  }
  // Availability / start date (free text).
  if (/\bwhen (are|will|can|could|would) you.*(available|begin|start)\b|\bavailable to (begin|start)\b|\bstart date\b|\bavailability\b|\bnotice period\b/.test(key)) {
    return normalizeText(profile.earliest_start_date) || "Immediately"
  }
  // "Which office(s) would you relocate to?" — a location picker (checkbox/select/
  // combobox with options), NOT a yes/no. Pick one office when the applicant is
  // open to relocating (user: "just randomly pick any of them").
  if (
    /relocat/.test(key) &&
    (target.kind === "checkbox" || target.kind === "select" || target.kind === "combobox" || (target.options?.length ?? 0) > 0)
  ) {
    if (profile.willing_to_relocate === false) return null
    return PICK_FIRST_OPTION
  }

  // Willing to relocate (yes/no).
  if (/\bwilling to relocate\b|\bopen to relocation\b|\brelocat/.test(key)) {
    if (profile.willing_to_relocate === true) return "yes"
    if (profile.willing_to_relocate === false) return "no"
    return "yes"
  }

  // "Are you a transitioning service member / on active duty?" — a military
  // status screen (distinct from the voluntary EEO veteran question). Default
  // No unless the profile explicitly marks active/transitioning service.
  if (/transitioning service member|currently serving|active duty|separating from (the )?(military|service)|service member/.test(key)) {
    const v = normalizeKey(profile.veteran_status ?? "")
    return /active|transitioning|currently serving|separating/.test(v) ? "yes" : "no"
  }

  // Salary expectations — prefer the max (single value); range only when asked.
  if (/\b(salary|compensation|pay rate|base pay|desired pay|desired salary|comp expectation|expected pay|minimum pay|pay expectation|hourly rate|wage)\b/.test(key) || /\b(minimum|expected|desired)\b.*\bpay\b|\bpay\b.*\bexpect/.test(key)) {
    const max = profile.salary_expectation_max
    const min = profile.salary_expectation_min
    const wantsRange = /\brange\b|minimum and maximum|min.*max|from.*to/.test(key)
    if (wantsRange && typeof min === "number" && typeof max === "number") return `${min}-${max}`
    if (typeof max === "number") return String(max)
    if (typeof min === "number") return String(min)
    return null
  }

  // "How did you hear about this job?" → the company's own careers channel.
  // Option wording varies widely ("<Company> Career Site", "Company Website",
  // "Career Site", …), so return an ordered candidate list; the combobox filler
  // tries each until one matches a real option.
  if (/\bhow did you hear\b|\bhear about (this|the) (job|role|position|opening)\b|\bsource\b/.test(key)) {
    const company = companyNameFromPage(target.row.ownerDocument ?? document)
    const candidates = [
      company ? `${company} career site` : "",
      company ? `${company} website` : "",
      "linkedin post",
      "linkedin",
      "company website",
      "career site",
      "company career site",
      "job board",
      "online",
      // Last-resort so a REQUIRED "how did you hear" radio/select is never left
      // empty — every such field has an "Other" bucket.
      "other",
    ].filter(Boolean)
    return SOURCE_CANDIDATES_PREFIX + candidates.join("|")
  }

  // A gender question isn't always labeled "gender" — e.g. "Do you think of
  // yourself as:", "How do you identify?" — so it slips past the keyword check
  // and the AI guesses the WRONG option (observed: a Male profile getting
  // "Female"). Recognize it by its OPTIONS (both Male and Female present) so the
  // PROFILE value is used, not a guess.
  const genderOptions = (target.options ?? []).map((o) => normalizeKey(o))
  const isGenderQuestion =
    (/\bgender\b/.test(key) && !/\btransgender\b/.test(key)) ||
    // Greenhouse's EEO gender field is literally "Do you think of yourself as:".
    // Match the phrasing so it works even for a react-select whose options
    // aren't in the DOM yet (the options-based signal below can't see them).
    /\bthink of yourself as\b|\bgender identity\b|\bhow do you identify your gender\b/.test(key) ||
    (genderOptions.some((o) => /^(male|man)$/.test(o)) &&
      genderOptions.some((o) => /^(female|woman)$/.test(o)) &&
      !/\brac|\bethnic|\bveteran|\bdisab|\bhispan|\blatin|\bpronoun/.test(key))

  if ((DEMOGRAPHIC_QUESTION_RE.test(label) || isGenderQuestion) && profile.auto_fill_diversity !== true) {
    return SOURCE_CANDIDATES_PREFIX + [
      "Prefer not to answer",
      "I do not want to answer",
      "I don't want to answer",
      "Decline to self-identify",
      "I do not wish to answer",
      "I don't wish to answer",
    ].join("|")
  }

  // EEO / self-identification — only when the user opted in (auto_fill_diversity).
  if (profile.auto_fill_diversity === true) {
    if (isGenderQuestion) return mapGenderValue(profile.gender)
    if (/\brac(e|ial)\b|\bethnic/.test(key)) return mapEthnicityValue(profile.ethnicity)
    if (/\bhispanic\b|\blatin[ox]?\b/.test(key)) return mapYesNoDeclineValue(profile.hispanic_latino)
    if (/\bveteran\b|\barmed forces\b|\bmilitary service\b/.test(key)) return mapYesNoDeclineValue(profile.veteran_status)
    if (/\bdisabilit/.test(key)) return mapYesNoDeclineValue(profile.disability_status)
  }

  return null
}

/** Map profile gender to values ATS gender dropdowns actually use (Man/Woman). */
function mapGenderValue(gender?: string | null): string | null {
  const g = normalizeKey(gender ?? "")
  if (!g) return null
  // Option wording varies per ATS ("Man" vs "Male"), so return an ordered
  // candidate list — the option filler tries each until one matches.
  if (/^(male|man|m)$/.test(g)) return SOURCE_CANDIDATES_PREFIX + ["Male", "Man"].join("|")
  if (/^(female|woman|f)$/.test(g)) return SOURCE_CANDIDATES_PREFIX + ["Female", "Woman"].join("|")
  if (/nonbinary|non binary|genderqueer|gendernonconforming/.test(g)) {
    return SOURCE_CANDIDATES_PREFIX + ["Non-binary", "Nonbinary", "Non binary"].join("|")
  }
  if (/prefer not|decline|dont wish|do not wish/.test(g)) {
    return SOURCE_CANDIDATES_PREFIX + ["Decline to self-identify", "I don't wish to answer", "Prefer not to say", "Prefer not to answer"].join("|")
  }
  return normalizeText(gender) || null
}

/**
 * Map the profile's EEOC-standard race value to a distinctive token that
 * matches this ATS's (differently-worded) race options via substring, e.g.
 * "Black or African American" → "Black" (matches "Black or of African descent").
 */
function mapEthnicityValue(ethnicity?: string | null): string | null {
  const k = normalizeKey(ethnicity ?? "")
  if (!k) return null
  if (/prefer not|decline|dont wish|do not wish/.test(k)) return "I don't wish to answer"
  if (/black|african/.test(k)) return "Black"
  if (/hispanic|latin|spanish/.test(k)) return "Hispanic"
  if (/american indian|alaska|indigenous|native american/.test(k)) return "American Indian"
  if (/native hawaiian|pacific islander/.test(k)) return "Native Hawaiian"
  if (/middle eastern|north african|mena/.test(k)) return "Middle Eastern"
  if (/east asian/.test(k)) return "East Asian"
  if (/south asian/.test(k)) return "South Asian"
  if (/southeast asian/.test(k)) return "Southeast Asian"
  if (/asian/.test(k)) return "Asian"
  if (/white|caucasian|european/.test(k)) return "White"
  if (/two or more|multiracial|mixed/.test(k)) return "Two or More"
  return normalizeText(ethnicity) || null
}

/** Map a Yes/No/decline-style profile value (veteran, disability, hispanic) to
 *  the option the form uses. */
function mapYesNoDeclineValue(value?: string | null): string | null {
  const k = normalizeKey(value ?? "")
  if (!k) return null
  // EEO options are often full sentences ("I identify as one or more of the
  // classifications…", "I am not a protected veteran") that a bare Yes/No can
  // never match — send ordered candidates instead.
  if (/prefer not|dont wish|do not wish|decline/.test(k)) {
    return SOURCE_CANDIDATES_PREFIX + ["Decline to self-identify", "I don't wish to answer", "I do not wish to answer", "Prefer not to say"].join("|")
  }
  if (/self describe/.test(k)) return "I prefer to self-describe"
  if (/^no|not a|dont have|do not have|i am not|no i|not identify/.test(k)) {
    return SOURCE_CANDIDATES_PREFIX + ["No", "I am not", "I do not have", "do not have a disability", "not a protected veteran", "No, I don't"].join("|")
  }
  if (/^yes|identify|i have|i am a|yes i|protected veteran$/.test(k)) {
    return SOURCE_CANDIDATES_PREFIX + ["Yes", "I identify", "I have a disability", "have had one in the past", "protected veteran"].join("|")
  }
  return normalizeText(value) || null
}

async function applyAnswerToTarget(target: AshbyQuestionTarget, value: string): Promise<boolean> {
  if (target.kind === "combobox") {
    return fillComboboxOption(target.controls[0], value, target.row.ownerDocument ?? document)
  }
  if (target.kind === "text" || target.kind === "textarea") {
    const control = target.controls[0]
    if (!control) return false
    // Sentinel answers (SOURCE_CANDIDATES / PICK_FIRST / PICK_ALL) are meant for
    // OPTION widgets. When the same question renders as a free-TEXT input (e.g.
    // "How did you hear about this job?" as a text box on Greenhouse), writing the
    // raw sentinel leaks "__ho_source__Calendly career site|…" into the field.
    // Fall back to the first plain candidate; drop the pick-* sentinels entirely.
    let text = value
    if (value.startsWith(SOURCE_CANDIDATES_PREFIX)) {
      text = value.slice(SOURCE_CANDIDATES_PREFIX.length).split("|")[0] ?? ""
    } else if (value === PICK_FIRST_OPTION || value === PICK_ALL_OPTIONS) {
      return false
    }
    return text ? setReactValue(control, text) : false
  }
  if (target.kind === "checkbox") {
    // Multi-select "select all that apply": tick the first option (PICK_FIRST_
    // OPTION) or the one matching a specific requested value.
    if (target.controls.length > 1) {
      if (value === PICK_ALL_OPTIONS) {
        let any = false
        for (const control of target.controls) {
          if (control instanceof HTMLInputElement && setReactChecked(control, true)) any = true
        }
        return any
      }
      if (value === PICK_FIRST_OPTION) {
        const first = target.controls[0]
        return first instanceof HTMLInputElement ? setReactChecked(first, true) : false
      }
      const items = target.controls.map((control) => {
        const optionLabel = control instanceof HTMLInputElement ? getOptionLabel(control, target.row) : normalizeText(control.textContent)
        return { value: optionLabel, label: optionLabel, control }
      })
      const match = findMatchingOption(items, value)
      return match?.control instanceof HTMLInputElement ? setReactChecked(match.control, true) : false
    }
    const control = target.controls[0]
    return control instanceof HTMLInputElement ? setReactChecked(control, normalizeKey(value) !== "no") : false
  }
  if (target.kind === "select") {
    const select = target.controls[0]
    if (!(select instanceof HTMLSelectElement)) return false
    const items = Array.from(select.options).map((item) => ({
      value: item.value,
      label: normalizeText(item.textContent || item.value),
    }))
    if (value === PICK_FIRST_OPTION) {
      const first = Array.from(select.options).find(
        (o) => o.value && !/^select|choose|--$/i.test(normalizeText(o.textContent || o.value)),
      )
      return first ? setReactValue(select, first.value) : false
    }
    if (value.startsWith(SOURCE_CANDIDATES_PREFIX)) {
      for (const cand of value.slice(SOURCE_CANDIDATES_PREFIX.length).split("|")) {
        const opt = findMatchingOption(items, cand)
        if (opt) return setReactValue(select, opt.value)
      }
      return false
    }
    const option = findMatchingOption(items, value)
    if (!option) return false
    return setReactValue(select, option.value)
  }

  const items = target.controls.map((control) => ({
    value: control instanceof HTMLInputElement ? control.value : normalizeText(roleOptionLabel(control)),
    label: control instanceof HTMLInputElement ? getOptionLabel(control, target.row) : roleOptionLabel(control),
    control,
  }))
  // Sentinels must work for radio/button groups too, not just <select> — a
  // required "How did you hear about us?" rendered as radios was stranded.
  let option: (typeof items)[number] | null = null
  if (value === PICK_FIRST_OPTION) {
    option = items.find((item) => item.label && !/^select|choose|--$/i.test(item.label)) ?? null
  } else if (value.startsWith(SOURCE_CANDIDATES_PREFIX)) {
    for (const cand of value.slice(SOURCE_CANDIDATES_PREFIX.length).split("|")) {
      option = findMatchingOption(items, cand)
      if (option) break
    }
  } else {
    option = findMatchingOption(items, value)
  }
  if (!option?.control) return false
  if (option.control instanceof HTMLInputElement) {
    return setReactChecked(option.control, true)
  }
  try {
    option.control.scrollIntoView({ block: "center", inline: "nearest" })
  } catch {
    // best-effort
  }
  option.control.click()
  option.control.dispatchEvent(new Event("input", { bubbles: true }))
  option.control.dispatchEvent(new Event("change", { bubbles: true }))
  return true
}

/**
 * Drive a react-select / downshift combobox: open the menu, type the query to
 * filter, wait for the option list to render, then click the matching option.
 * A plain value-set never registers a selection on these widgets, so this is
 * the only way Greenhouse's Country / work-auth / sponsorship dropdowns fill.
 */
/**
 * Dispatch a PointerEvent, falling back to MouseEvent where unsupported.
 * `composed: true` is essential for shadow-DOM widgets (SmartRecruiters spl-*):
 * the handler is bound OUTSIDE the option's shadow root, so a non-composed event
 * never crosses the boundary to reach it.
 */
function firePointer(el: Element, type: string, coords?: { x: number; y: number }): void {
  try {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        ...(coords ? { clientX: coords.x, clientY: coords.y } : {}),
      }),
    )
  } catch {
    // PointerEvent unavailable — the paired MouseEvent below still fires.
  }
}

/** Open a combobox with the pointer+mouse sequence react-select expects. */
function openCombo(el: Element): void {
  if (el instanceof HTMLElement) {
    try {
      el.focus({ preventScroll: true })
    } catch {
      // best-effort
    }
  }
  firePointer(el, "pointerdown")
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, button: 0 }))
  firePointer(el, "pointerup")
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true, button: 0 }))
  if (el instanceof HTMLElement) el.click()
  // SmartRecruiters spl-autocomplete (and other ARIA comboboxes) IGNORE pointer
  // events and only open via keyboard — ArrowDown reveals the full option list
  // (these fields set minquerylength=0). Harmless for react-select, which also
  // opens on ArrowDown.
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
}

/**
 * The deepest text-bearing descendant of an option, crossing open shadow roots.
 * SmartRecruiters spl-select-option handlers fire on the actual leaf under the
 * cursor (an inner <spl-truncate>/<slot>), NOT the option wrapper — a click on
 * the wrapper never commits. DOM traversal is used rather than elementFromPoint
 * so it stays correct for stacked / below-the-fold EEO fields where coordinate
 * hit-testing lands on the wrong element and silently closes the menu. The
 * MouseEvent coordinates are taken from the resolved leaf (0 under jsdom, where
 * the click still bubbles from leaf → option so fixtures keep working).
 */
function deepestOptionLeaf(el: Element): { node: Element; x: number; y: number } {
  let node: Element = el
  for (let depth = 0; depth < 14; depth += 1) {
    const scope: ParentNode = node.shadowRoot ?? node
    const kids = Array.from(scope.children)
    if (kids.length === 0) break
    // Prefer the last child that actually carries the label text; fall back to
    // the last element child (some leaves render text via a <slot>).
    const next = kids.filter((k) => normalizeText(k.textContent)).pop() ?? kids[kids.length - 1]
    if (!next || next === node) break
    node = next
  }
  const rect = node.getBoundingClientRect?.()
  const laidOut = Boolean(rect && (rect.width || rect.height))
  return {
    node,
    x: laidOut ? rect!.left + rect!.width / 2 : 0,
    y: laidOut ? rect!.top + rect!.height / 2 : 0,
  }
}

/**
 * Commit a combobox option. react-select v5 only accepts the selection when it
 * sees a pointerdown/pointerup pair on the option; SmartRecruiters spl-select-
 * options additionally require the events to target the DEEPEST leaf under the
 * cursor and be `composed` (the handler lives outside the option's shadow root).
 * Firing on the resolved leaf with real coordinates satisfies both.
 */
function commitOption(el: Element): void {
  const { node, x, y } = deepestOptionLeaf(el)
  const coords = { x, y }
  const mouse = (type: string) =>
    node.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, clientX: x, clientY: y }),
    )
  firePointer(node, "pointerover", coords)
  firePointer(node, "pointermove", coords)
  firePointer(node, "pointerdown", coords)
  mouse("mousedown")
  firePointer(node, "pointerup", coords)
  mouse("mouseup")
  mouse("click")
}

async function fillComboboxOption(
  input: HTMLElement | undefined,
  value: string,
  doc: Document,
): Promise<boolean> {
  if (!(input instanceof HTMLInputElement)) return false
  const row =
    input.closest<HTMLElement>(
      ".field-wrapper, .phone-input, [class*='fieldEntry' i], [class*='field-entry' i], .application-question, .field, fieldset",
    ) ??
    input.closest<HTMLElement>('[class*="select__control" i]')
  try {
    // Open via the react-select CONTROL, not just the input — some Greenhouse
    // widgets (e.g. the country selector) only open the option menu on a
    // control mousedown, so clicking the bare input leaves it closed.
    const control =
      input.closest<HTMLElement>('[class*="control" i]') ??
      row?.querySelector<HTMLElement>('[class*="control" i]') ??
      null
    try {
      input.scrollIntoView({ block: "center", inline: "nearest" })
    } catch {
      // best-effort
    }
    // Let the scroll settle: below-the-fold SmartRecruiters EEO dropdowns render
    // their popup at 0×0 (never open) when the field isn't yet in the viewport.
    await sleep(150)
    input.focus({ preventScroll: true })
    // Clear any residual filter text left by an EARLIER failed attempt on this
    // same combobox (e.g. the AI tier typed a non-matching value, then dropped
    // to the last-resort pass). Stale text keeps the menu filtered to nothing,
    // so the next open would find zero options and leave the field blank. The
    // committed selection lives in a chip, not input.value, so this is safe.
    if (input.value) {
      const clearSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      if (clearSetter) clearSetter.call(input, "")
      else input.value = ""
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }),
      )
    }
    // React-select v5 listens for POINTER events to open/commit; plain
    // MouseEvents open the menu but a subsequent option click silently
    // no-ops (the value never commits). Dispatch the full pointer sequence
    // (pointerdown → mousedown → pointerup → mouseup) so both the open and
    // the later option pick actually register.
    openCombo(control ?? input)

    const collect = (): HTMLElement[] => {
      // The option menu may live in a DIFFERENT shadow tree (SmartRecruiters
      // spl-autocomplete renders <spl-select-option> — no role=option — into
      // the element referenced by the input's aria-controls). Scope to that
      // menu when available, then fall back to a deep whole-document scan.
      const controlsId = input.getAttribute("aria-controls")
      let scope: ParentNode = doc
      if (controlsId) {
        const menu = queryAllDeep<HTMLElement>(doc, `#${cssEscape(controlsId)}`)[0]
        if (menu) scope = menu
      }
      return queryAllDeep<HTMLElement>(
        scope,
        'spl-select-option, [role="option"], [class*="select__option" i], [class*="option" i], [class*="menuItem" i], li[role="option"]',
      ).filter((el) => isElementUsable(el) && isElementRendered(el) && normalizeText(roleOptionLabel(el)).length > 0)
    }

    const pollOptions = async (): Promise<HTMLElement[]> => {
      const deadline = Date.now() + 3600
      let opts: HTMLElement[] = []
      while (Date.now() < deadline) {
        opts = collect()
        if (opts.length > 0) break
        await sleep(120)
      }
      return opts
    }

    const tryClickMatch = async (opts: HTMLElement[], desiredValue = value): Promise<boolean> => {
      if (opts.length === 0) return false
      const asItems = opts.map((el) => {
        const text = normalizeText(roleOptionLabel(el))
        return { value: text, label: text, el }
      })
      let chosen: HTMLElement | undefined
      if (desiredValue === PICK_NO_ELSE_FIRST) {
        // Prefer a safe negative/decline option; otherwise the first real one.
        const isPlaceholder = (el: HTMLElement) => /^select|choose|--$/i.test(normalizeText(roleOptionLabel(el)))
        chosen =
          opts.find(
            (el) =>
              !isPlaceholder(el) &&
              /^(no\b|none\b|prefer not|i do not|i don'?t|not applicable|n\/a\b)/i.test(
                normalizeText(roleOptionLabel(el)),
              ),
          ) ??
          opts.find((el) => !isPlaceholder(el)) ??
          opts[0]
      } else if (desiredValue === PICK_FIRST_OPTION) {
        chosen = opts.find((el) => !/^select|choose|--$/i.test(normalizeText(roleOptionLabel(el)))) ?? opts[0]
      } else if (desiredValue.startsWith(SOURCE_CANDIDATES_PREFIX)) {
        // Try each source candidate until one matches a real option.
        for (const cand of desiredValue.slice(SOURCE_CANDIDATES_PREFIX.length).split("|")) {
          const hit = findMatchingOption(asItems, cand)?.el
          if (hit) {
            chosen = hit
            break
          }
        }
      } else {
        chosen = findMatchingOption(asItems, desiredValue)?.el
      }
      if (!chosen) return false
      try {
        chosen.scrollIntoView({ block: "center", inline: "nearest" })
      } catch {
        // best-effort
      }
      commitOption(chosen)
      await sleep(180)
      if (comboboxCommitted(input, row)) return true
      return commitSmartRecruitersComboboxSelection(input, chosen, row)
    }

    const typeQuery = async (query: string): Promise<void> => {
      input.focus({ preventScroll: true })
      input.click()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      if (setter) setter.call(input, "")
      else input.value = ""
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }),
      )
      for (const ch of query) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }))
        input.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: ch,
          }),
        )
        if (setter) setter.call(input, `${input.value}${ch}`)
        else input.value = `${input.value}${ch}`
        input.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch }),
        )
        input.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }))
        await sleep(18 + Math.round(Math.random() * 22))
      }
    }

    // 1. Match from the freshly-opened list FIRST. Some Greenhouse widgets
    //    (e.g. the 244-country selector) don't filter on the react-select input,
    //    so typing leaves the full list and a blind Enter would grab the
    //    highlighted first option ("Afghanistan"). Clicking the real match
    //    avoids that entirely.
    if (await tryClickMatch(await pollOptions())) return true

    // 2. Not found in the open list — type to filter. Greenhouse async
    //    typeaheads (Location City) only fetch options from keyboard-like input
    //    events; a plain React value-set leaves the menu empty.
    if (value === PICK_FIRST_OPTION || value === PICK_NO_ELSE_FIRST) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      await sleep(220)
      if (comboboxCommitted(input, row)) return true
    } else if (value.startsWith(SOURCE_CANDIDATES_PREFIX)) {
      const candidates = value
        .slice(SOURCE_CANDIDATES_PREFIX.length)
        .split("|")
        .map((item) => normalizeText(item))
        .filter(Boolean)
      for (const candidate of candidates) {
        await typeQuery(candidate)
        if (await tryClickMatch(await pollOptions(), candidate)) return true
      }
    } else {
      const queries = dedupe([
        value,
        value.split(",")[0] ?? "",
      ].map((item) => normalizeText(item)).filter(Boolean))
      for (const query of queries) {
        await typeQuery(query)
        if (await tryClickMatch(await pollOptions(), query)) return true
      }
    }

    // 3. No confident match. Do NOT press Enter (that selects whatever is
    //    highlighted — often the wrong first option). Close and report failure.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    return false
  } catch {
    return false
  }
}

function smartRecruitersSelectionHost(input: HTMLInputElement): HTMLElement | null {
  const host = input.getRootNode() instanceof ShadowRoot
    ? ((input.getRootNode() as ShadowRoot).host as HTMLElement)
    : null
  if (!host) return null
  let node: HTMLElement | null = host
  for (let depth = 0; node && depth < 8; depth += 1, node = deepParentElement(node)) {
    if (/^sr-question-field-select$/i.test(node.tagName)) return node
  }
  return host.tagName.toLowerCase().startsWith("spl-") ? host : null
}

function hasSelectionProp(el: HTMLElement | null | undefined): boolean {
  if (!el) return false
  const record = el as unknown as Record<string, unknown>
  for (const key of ["values", "selectedValues", "selected", "value"]) {
    const value = record[key]
    if (Array.isArray(value) && value.length > 0) return true
    if (typeof value === "string" && normalizeText(value)) return true
  }
  return false
}

function setSelectionProp(el: HTMLElement | null | undefined, key: string, value: unknown): void {
  if (!el) return
  try {
    ;(el as unknown as Record<string, unknown>)[key] = value
  } catch {
    // Some web-component properties are read-only.
  }
}

function dispatchComposedSelectionEvents(el: HTMLElement | null | undefined, detail: unknown): void {
  if (!el) return
  for (const type of ["input", "change", "spl-input", "spl-change", "valueChange", "selectionChange"]) {
    try {
      el.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }))
    } catch {
      // best-effort
    }
  }
}

function commitSmartRecruitersComboboxSelection(
  input: HTMLInputElement,
  option: HTMLElement,
  row?: HTMLElement | null,
): boolean {
  const host = input.getRootNode() instanceof ShadowRoot
    ? ((input.getRootNode() as ShadowRoot).host as HTMLElement)
    : null
  const field = smartRecruitersSelectionHost(input)
  if (!host && !field) return false

  const value = normalizeText(option.getAttribute("value") || roleOptionLabel(option))
  if (!value) return false
  const label = normalizeText(roleOptionLabel(option)) || value
  const isMulti =
    host?.tagName.toLowerCase().includes("multiselect") === true ||
    Array.isArray((field as unknown as { value?: unknown } | null)?.value)
  const payload = isMulti ? [value] : value
  const detail = {
    value: payload,
    values: [value],
    selected: payload,
    selectedValues: [value],
    option: { value, label },
    label,
  }

  setSelectionProp(option, "selected", true)
  for (const target of [host, field]) {
    setSelectionProp(target, "value", payload)
    setSelectionProp(target, "values", [value])
    setSelectionProp(target, "selected", payload)
    setSelectionProp(target, "selectedValues", [value])
    dispatchComposedSelectionEvents(target, detail)
  }
  dispatchComposedSelectionEvents(input, detail)
  try {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    input.blur()
  } catch {
    // best-effort
  }
  return comboboxCommitted(input, row) || hasSelectionProp(host) || hasSelectionProp(field)
}

/**
 * After a combobox pick, react-select clears the search input and shows the
 * choice in a `singleValue`/`multiValue` chip. Treat either signal as committed.
 */
function comboboxCommitted(input: HTMLElement | undefined, row?: HTMLElement | null): boolean {
  if (!(input instanceof HTMLInputElement)) return false
  const container =
    (row?.isConnected ? row : null) ??
    input.closest<HTMLElement>(
      ".field-wrapper, .phone-input, [class*='fieldEntry' i], [class*='field-entry' i], .application-question, .field, fieldset",
    ) ??
    input.closest<HTMLElement>(
      '[class*="select__control" i], [class*="fieldEntry" i], .application-question, .field, fieldset',
    ) ??
    input.parentElement
  const chipSelector = [
    '[class*="singleValue" i]',
    '[class*="single-value" i]',
    '[class*="multiValue" i]',
    '[class*="multi-value" i]',
    "spl-chip",
    "spl-tag",
    // SmartRecruiters multi-select renders committed picks as <div class="c-spl-tag">
    '[class*="spl-tag" i]',
    '[part*="chip" i]',
    '[slot*="tag" i]',
  ].join(",")
  const scopes: ParentNode[] = []
  if (container) scopes.push(container)
  const host = input.getRootNode() instanceof ShadowRoot ? (input.getRootNode() as ShadowRoot).host : null
  if (host instanceof HTMLElement) {
    scopes.push(host)
    if (host.shadowRoot) scopes.push(host.shadowRoot)
  }
  if (input instanceof HTMLInputElement) {
    const field = smartRecruitersSelectionHost(input)
    if (field && !scopes.includes(field)) scopes.push(field)
    if (hasSelectionProp(host instanceof HTMLElement ? host : null) || hasSelectionProp(field)) return true
  }
  for (const scope of scopes) {
    const chip = queryAllDeep<HTMLElement>(scope, chipSelector).find((el) =>
      normalizeText(el.textContent || el.getAttribute("label") || el.getAttribute("value")).length > 0,
    )
    if (chip) return true
  }
  // SmartRecruiters spl-autocomplete keeps the menu OPEN (aria-expanded="true")
  // while the input still holds unconfirmed QUERY text — that is NOT a committed
  // selection (the field would submit as empty → "Value is required"). Only trust
  // leftover input text as a pick once the menu has closed.
  if (input.getAttribute("aria-expanded") === "true") return false
  // Some widgets keep the picked label as the input value instead of a chip.
  return normalizeText(input.value).length > 0
}

/**
 * Normalize common country synonyms so option-matching lands on the ATS's
 * canonical label (e.g. "US"/"USA"/"America" → "United States").
 */
/**
 * Best-effort employer name from the application page. Greenhouse titles read
 * "Job Application for <Role> at <Company>"; the URL slug (…/<company>/jobs/…)
 * is a fallback. Used to pick the company's own "<Company> Career Site" option.
 */
function companyNameFromPage(doc: Document): string {
  const title = doc.title || ""
  const m = title.match(/\bat\s+([^|]+?)\s*$/i)
  if (m?.[1]) {
    // Trim common suffixes ("International", "Inc", "LLC") to a matchable core.
    return m[1].replace(/\b(international|inc|llc|ltd|corp(oration)?|company|co)\b\.?/gi, "").trim().split(/\s+/)[0] ?? ""
  }
  const slug = (doc.location?.pathname || "").match(/job-boards\.[^/]*|\/([a-z0-9-]+)\/jobs\//i)
  const url = (doc.location?.href || "").match(/greenhouse\.io\/([a-z0-9-]+)\//i)
  return url?.[1] ? url[1].replace(/-/g, " ") : (slug ? "" : "")
}

function normalizeCountryAnswer(raw: string): string {
  const key = normalizeKey(raw)
  if (/^(us|u s|usa|u s a|america|united states|united states of america)$/.test(key)) {
    return "United States"
  }
  if (/^(uk|u k|britain|great britain|england|united kingdom)$/.test(key)) {
    return "United Kingdom"
  }
  return raw
}

function findMatchingOption<T extends { value: string; label: string }>(
  options: T[],
  desired: string,
): T | null {
  const key = normalizeKey(desired)
  const yesNo = key === "yes" || key === "y" || key === "true"
    ? "yes"
    : key === "no" || key === "n" || key === "false"
      ? "no"
      : null
  const candidates = options.filter((option) => normalizeText(option.label) || normalizeText(option.value))
  if (yesNo) {
    // Exact "Yes"/"No" option.
    const exact = candidates.find((option) => normalizeKey(option.label) === yesNo || normalizeKey(option.value) === yesNo)
    if (exact) return exact
    // Word-boundary START match: "No, I am not a veteran…" begins with "no".
    // NEVER substring-match a yes/no — "no" is a substring of "vetera(no)r
    // active member", which would wrongly select the "Yes" option.
    const startRe = new RegExp(`^${yesNo}\\b`)
    const startsWith = candidates.find(
      (option) => startRe.test(normalizeKey(option.label)) || startRe.test(normalizeKey(option.value)),
    )
    if (startsWith) return startsWith
    return null
  }
  return (
    candidates.find((option) => normalizeKey(option.label) === key || normalizeKey(option.value) === key) ??
    candidates.find((option) => normalizeKey(option.label).includes(key) || key.includes(normalizeKey(option.label))) ??
    null
  )
}

function setReactChecked(input: HTMLInputElement, checked: boolean): boolean {
  try {
    input.focus({ preventScroll: true })
  } catch {
    // best-effort
  }
  try {
    // React tracks checkbox/radio selection via the CLICK event — its onChange
    // fires from a click, NOT from a synthetic 'change'. Setting `.checked`
    // directly updates the DOM but leaves React's state stale, so controlled
    // radios (Ashby's EEO gender/race/veteran) revert on the next re-render and
    // SUBMIT EMPTY even though input.checked reads true. A real click both flips
    // `.checked` and fires React's onChange. Only click when the state must
    // change — clicking an already-checked radio is a no-op, but clicking a
    // checked checkbox would wrongly toggle it OFF.
    if (input.checked !== checked) {
      input.click()
    }
    // Fallback for widgets that preventDefault the click (or non-React,
    // uncontrolled inputs): force the value and fire the legacy events.
    if (input.checked !== checked) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set
      if (setter) setter.call(input, checked)
      else input.checked = checked
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new Event("change", { bubbles: true }))
    }
    return input.checked === checked
  } catch {
    return false
  }
}

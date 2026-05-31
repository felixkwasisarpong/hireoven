/**
 * Apex MVP — Safe-fields autofill detector for ATS application forms.
 *
 * Hard constraints (do NOT relax without owner review):
 *   - Best-effort profile autofill across ATSes. Workday has its own step-aware runner.
 *   - No demographic questions (gender, ethnicity, race, veteran, disability).
 *   - No final-submit clicks.
 *   - File inputs are *detected* but never filled — listed as "Needs user action".
 *   - Work-authorization / sponsorship answers ONLY when the user has them in
 *     their saved autofill profile. Never inferred or guessed.
 */

// ── Public types ─────────────────────────────────────────────────────────────

/** Server response shape from /api/extension/autofill-profile */
export type SafeProfile = {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  linkedin_url?: string | null
  github_url?: string | null
  portfolio_url?: string | null
  website_url?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
  country?: string | null
  authorized_to_work?: boolean | null
  requires_sponsorship?: boolean | null
  // Resume-derived
  current_title?: string | null
  current_company?: string | null
  resume_summary?: string | null
  skills?: string | null
  top_skills?: string[] | null
  work_experience?: Array<{
    title?: string | null
    company?: string | null
    start_date?: string | null
    end_date?: string | null
    is_current?: boolean | null
    description?: string | null
    achievements?: string[] | null
    location?: string | null
  }> | null
}

/** Per-field result returned from detection (preview) and from filling. */
export type AutofillFieldResult = {
  label: string
  selector?: string
  valuePreview?: string
  /** Raw unmasked value used at fill-time. */
  fillValue?: string
  confidence: "high" | "medium" | "needs_review"
  source:
    | "profile"
    | "resume"
    | "cover_letter"
    | "user_saved_answer"
    | "manual_required"
  filled: boolean
  skippedReason?: string
}

export type AutofillSource =
  | "greenhouse"
  | "lever"
  | "workday"
  | "ashby"
  | "icims"
  | "smartrecruiters"
  | "bamboohr"
  | "generic"

// ── Sensitive field detection (always skip) ──────────────────────────────────

/**
 * Substring patterns matched (case-insensitive) against label/name/id.
 * If any match, the field is skipped with a "sensitive" reason — NEVER filled
 * automatically, even if a profile value technically exists for it.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // EEO / demographics
  /\bgender\b/i,
  /\bsex\b/i,
  /\bethnicit/i,
  /\brace\b/i,
  /\bhispan/i,
  /\blatin/i,
  /\bveteran/i,
  /\bdisability\b/i,
  /\bdisabled\b/i,
  /\baccommodation/i,
  /\borientation/i,
  /\btransgender/i,
  /\bpronoun/i,
  // Government IDs / sensitive PII
  /\bssn\b|\bsocial[\s-]?security/i,
  /\bdate[\s-]?of[\s-]?birth\b/i,
  /\bdob\b/i,
  /\bage\b/i,
  // Salary screening (we don't auto-answer compensation negotiation)
  /\bsalary\b.*expect/i,
  /\bcompensation\b.*expect/i,
  /\bdesired\s+(salary|comp)/i,
]

function isSensitive(haystack: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(haystack))
}

// ── Safe-field key resolution ────────────────────────────────────────────────

/** Categories of safe fields the MVP fills. */
type SafeKey =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "location"
  | "linkedin_url"
  | "github_url"
  | "portfolio_url"
  | "website_url"
  | "resume_upload"
  | "cover_letter_upload"
  | "current_title"
  | "current_company"
  | "resume_summary"
  | "work_exp_start"
  | "work_exp_end"
  | "work_exp_current"
  | "work_exp_description"
  | "skills"

interface SafeKeyRule {
  key: SafeKey
  /** Match anywhere in label/name/id/placeholder, lowercased. */
  patterns: RegExp[]
  /** When the input element type matches one of these (lowercased). */
  inputTypes?: string[]
  /** Restrict matching to the visible field label only. */
  labelOnly?: boolean
}

/** Order matters — first match wins. More specific rules go before general. */
const SAFE_KEY_RULES: SafeKeyRule[] = [
  // File uploads first — must catch before any "name" fallthrough
  { key: "resume_upload",       patterns: [/\bresume\b|\bcv\b/i],                            inputTypes: ["file"] },
  { key: "cover_letter_upload", patterns: [/\bcover[\s_-]?letter\b/i],                       inputTypes: ["file"] },

  // Names — first/last more specific than "name"
  { key: "first_name", patterns: [/\bfirst[\s_-]?name\b|\bgiven[\s_-]?name\b|^fname$|^firstname$/i] },
  { key: "last_name",  patterns: [/\blast[\s_-]?name\b|\bsurname\b|\bfamily[\s_-]?name\b|^lname$|^lastname$/i] },
  { key: "full_name",  patterns: [/\bfull[\s_-]?name\b|^name$|\bcandidate[\s_-]?name\b/i] },

  // Contact
  { key: "email", patterns: [/\bemail\b|\be[\s-]?mail\b/i] },
  { key: "phone", patterns: [/\bphone\b|\bmobile\b|\btelephone\b|\btel\b/i] },

  // URLs — order: linkedin > github > portfolio > website (most specific first)
  { key: "linkedin_url",  patterns: [/\blinkedin\b/i] },
  { key: "github_url",    patterns: [/\bgithub\b|\bgit[\s_-]?hub\b/i] },
  { key: "portfolio_url", patterns: [/\bportfolio\b|\bpersonal[\s_-]?site\b/i] },
  { key: "website_url",   patterns: [/\bwebsite\b|\burl\b|\bother[\s_-]?(site|link)\b|\bhomepage\b/i] },

  // Location (single-line city/region)
  { key: "location", patterns: [/\blocation\b|\bcity\b|\baddress\b(?!\s*line\s*2)/i] },

  // Resume-derived fields
  { key: "work_exp_current", patterns: [/\bi[\s_-]*currently[\s_-]*work[\s_-]*here\b|currently[\s_-]*(?:employed|work(?:ing)?)\b/i], inputTypes: ["checkbox"], labelOnly: true },
  { key: "work_exp_start",   patterns: [/^\s*from\s*$/i, /\bstart[\s_-]?date\b/i, /\bdate[\s_-]?started\b/i, /\bemployment[\s_-]?start\b/i], inputTypes: ["text", "date", "month"], labelOnly: true },
  { key: "work_exp_end",     patterns: [/^\s*to\s*$/i, /\bend[\s_-]?date\b/i, /\bdate[\s_-]?ended\b/i, /\bemployment[\s_-]?end\b/i, /\bthrough\b/i], inputTypes: ["text", "date", "month"], labelOnly: true },
  { key: "work_exp_description", patterns: [/\brole[\s_-]?description\b|\bjob[\s_-]?description\b|\bresponsibilit/i, /\baccomplishment|achievement|duties\b/i], labelOnly: true },
  { key: "current_title",   patterns: [/current[\s_-]?(?:job[\s_-]?)?title|job[\s_-]?title|\btitle\b|current[\s_-]?role|position[\s_-]?title/i] },
  { key: "current_company", patterns: [/current[\s_-]?(?:employer|company|organization)|employer[\s_-]?name|company[\s_-]?name|\bemployer\b|\bcompany\b/i] },
  { key: "resume_summary",  patterns: [/professional[\s_-]?summary|about[\s_-]?(?:you|yourself)|tell[\s_-]?us[\s_-]?about|career[\s_-]?(?:summary|objective)|personal[\s_-]?summary/i] },
  { key: "skills",          patterns: [/\bskills?\b|technical[\s_-]?skills?|key[\s_-]?skills?|core[\s_-]?competenc|areas?[\s_-]?of[\s_-]?expertise/i] },
]

// ── Form scoping per source ──────────────────────────────────────────────────

const FORM_CONTROL_SELECTOR =
  "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea"
const FRAME_SELECTOR_PREFIX = "__ho_frame:"
type FormControlElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
type LocatedControl = { el: FormControlElement; framePath: number[] }

/**
 * Scope detection to the application form container so we don't hit unrelated
 * inputs on the page (search bars, newsletter, etc.). Returns the form root
 * element if found, or null when not on a supported application form.
 */
function findApplicationFormRoot(
  doc: Document,
  source: AutofillSource,
): HTMLElement | null {
  const SELECTORS: Record<AutofillSource, string[]> = {
    greenhouse: [
      "form#application-form",
      "form.application--form",
      "#grnhse_app form",
      "form[action*='boards']",
      "form[action*='greenhouse']",
      "form",
    ],
    lever: [
      "form.application-form",
      "form[action*='lever']",
      "form",
    ],
    workday: [
      "[data-automation-id='applyStep']",
      "[data-automation-id='applicationStep']",
      "[data-automation-id='stepContent']",
      "[data-automation-id='applyFlow']",
      "[data-automation-id='applicationSummaryStep']",
      "form[data-automation-id]",
      "form[action*='workday']",
      "form[action*='myworkday']",
      "form",
    ],
    ashby: [
      "._ashby-application-form",
      "._ashby-application-form-container form",
      "form[action*='ashby']",
      "form[action*='ashbyhq']",
      "form[data-testid*='apply']",
      "form",
    ],
    icims: [
      "#icims_content form",
      ".iCIMS_Content form",
      "#iCIMS_JobsWidget form",
      "form[action*='icims']",
      "form",
    ],
    smartrecruiters: [
      ".sr-apply-step",
      ".smartrecruiters-widget form",
      "#apply-form",
      "form[action*='smartrecruiters']",
      "form",
    ],
    bamboohr: [
      "#bamboohr-apply",
      ".BambooHR-ATS form",
      "#apply-form-card form",
      "form[action*='bamboohr']",
      "form",
    ],
    generic: [
      "form[action*='apply']",
      "form[id*='apply']",
      "form[class*='apply']",
      "[id*='application-form'] form",
      "[class*='application-form'] form",
      "form",
    ],
  }

  const selectors: string[] = [
    ...(SELECTORS[source] ?? []),
    ...(source === "generic" ? [] : SELECTORS.generic),
  ]

  const seen = new Set<HTMLElement>()
  const candidates: Array<{ root: HTMLElement; score: number }> = []

  for (const sel of selectors) {
    doc.querySelectorAll<HTMLElement>(sel).forEach((root) => {
      if (seen.has(root)) return
      seen.add(root)
      const score = root.querySelectorAll(FORM_CONTROL_SELECTOR).length
      if (score > 0) candidates.push({ root, score })
    })
  }

  // Fallback for Workday-style layouts where the visible step has no formal form wrapper.
  if (candidates.length === 0) {
    doc.querySelectorAll<HTMLElement>("main section, [role='main'] section, main article, [role='main'] article").forEach((root) => {
      if (seen.has(root)) return
      const score = root.querySelectorAll(FORM_CONTROL_SELECTOR).length
      if (score >= 3) candidates.push({ root, score })
    })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0].root
}

// ── Label resolution ─────────────────────────────────────────────────────────

/**
 * Best-effort label extraction. Order:
 *   1. <label for="id">
 *   2. wrapping <label>
 *   3. preceding sibling label-like element (Greenhouse uses .label or aria)
 *   4. aria-label / aria-labelledby
 *   5. placeholder
 */
function getFieldLabel(input: HTMLElement): string {
  const id = input.id
  if (id) {
    const lbl = input.ownerDocument.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)
    if (lbl?.textContent?.trim()) return lbl.textContent.trim()
  }
  const parentLabel = input.closest("label")
  if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim()

  // Common Greenhouse pattern: <div class="application-question"><label>…</label><input/></div>
  const ancestor = input.closest(".application-question, .field, .input-wrapper, .field-wrapper")
  if (ancestor) {
    const lbl = ancestor.querySelector("label, .label, [class*='label']")
    if (lbl?.textContent?.trim()) return lbl.textContent.trim()
  }

  const aria = input.getAttribute("aria-label")
  if (aria?.trim()) return aria.trim()
  const aribyId = input.getAttribute("aria-labelledby")
  if (aribyId) {
    const el = input.ownerDocument.getElementById(aribyId)
    if (el?.textContent?.trim()) return el.textContent.trim()
  }
  const ph = input.getAttribute("placeholder")
  if (ph?.trim()) return ph.trim()
  return input.getAttribute("name") ?? input.id ?? "Unlabelled field"
}

const WORK_EXPERIENCE_CONTEXT_RE = /\bwork[\s_-]?experience\b/i

function hasWorkExperienceContext(input: HTMLElement): boolean {
  let node: HTMLElement | null = input
  for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
    const attrs = [
      node.getAttribute("data-automation-id") ?? "",
      node.getAttribute("aria-label") ?? "",
      node.id,
      typeof node.className === "string" ? node.className : "",
    ].join(" ")
    if (WORK_EXPERIENCE_CONTEXT_RE.test(attrs)) return true

    const heading = node.querySelector<HTMLElement>(
      ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > [role='heading']",
    )
    if (heading?.textContent && WORK_EXPERIENCE_CONTEXT_RE.test(heading.textContent)) {
      return true
    }

    const directText = Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? "")
      .join(" ")
    if (WORK_EXPERIENCE_CONTEXT_RE.test(directText)) return true
  }
  return false
}

// ── Detection + classification ───────────────────────────────────────────────

interface DetectedField {
  el: FormControlElement
  label: string
  selector: string
  inputType: string
  /** SafeKey if matched; null = unknown (skipped). */
  safeKey: SafeKey | null
  /** True when label/name/id matches a sensitive pattern. */
  sensitive: boolean
}

function buildSelector(input: HTMLElement): string {
  if (input.id) return `#${CSS.escape(input.id)}`
  const name = input.getAttribute("name")
  if (name) return `${input.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`
  return input.tagName.toLowerCase()
}

function buildSelectorWithFrame(input: HTMLElement, framePath: number[]): string {
  const base = buildSelector(input)
  if (framePath.length === 0) return base
  return `${FRAME_SELECTOR_PREFIX}${framePath.join(".")}::${base}`
}

function collectControlsInElement(root: ParentNode, framePath: number[]): LocatedControl[] {
  return Array.from(root.querySelectorAll<FormControlElement>(FORM_CONTROL_SELECTOR)).map((el) => ({ el, framePath }))
}

function collectControlsInDocument(doc: Document, framePath: number[] = []): LocatedControl[] {
  const out: LocatedControl[] = collectControlsInElement(doc, framePath)
  const frameNodes: HTMLIFrameElement[] = Array.from(doc.querySelectorAll("iframe"))
  frameNodes.forEach((frameNode, index) => {
    try {
      const childDoc = frameNode.contentDocument
      if (!childDoc) return
      out.push(...collectControlsInDocument(childDoc, [...framePath, index]))
    } catch {
      // Cross-origin frame: inaccessible from this frame context.
    }
  })
  return out
}

function resolveFramePrefixedSelector(
  selector: string,
  topDoc: Document = document,
): HTMLElement | null {
  if (!selector.startsWith(FRAME_SELECTOR_PREFIX)) {
    try {
      return topDoc.querySelector<HTMLElement>(selector)
    } catch {
      return null
    }
  }

  const split = selector.indexOf("::")
  if (split < 0) return null
  const pathRaw = selector.slice(FRAME_SELECTOR_PREFIX.length, split)
  const baseSelector = selector.slice(split + 2)
  const indexes = pathRaw.split(".").map((v) => Number.parseInt(v, 10)).filter((n) => Number.isFinite(n))
  if (indexes.length === 0) return null

  let doc: Document | null = topDoc
  for (const idx of indexes) {
    if (!doc) return null
    const frameNodes: HTMLIFrameElement[] = Array.from(doc.querySelectorAll("iframe"))
    const frameNode: HTMLIFrameElement | undefined = frameNodes[idx]
    if (!frameNode) return null
    try {
      doc = frameNode.contentDocument
    } catch {
      return null
    }
  }
  if (!doc) return null
  try {
    return doc.querySelector<HTMLElement>(baseSelector)
  } catch {
    return null
  }
}

function classifyField(input: FormControlElement): DetectedField {
  const label = getFieldLabel(input)
  const tag = input.tagName.toLowerCase()
  const inputType =
    tag === "textarea"
      ? "textarea"
      : tag === "select"
      ? "select"
      : (input as HTMLInputElement).type?.toLowerCase() ?? "text"
  const haystack = [
    label,
    input.getAttribute("name") ?? "",
    input.id,
    input.getAttribute("placeholder") ?? "",
    input.getAttribute("autocomplete") ?? "",
  ].join(" ")

  const sensitive = isSensitive(haystack)
  let safeKey: SafeKey | null = null
  if (!sensitive) {
    for (const rule of SAFE_KEY_RULES) {
      if (rule.inputTypes && !rule.inputTypes.includes(inputType)) continue
      const target = rule.labelOnly ? label : haystack
      if (rule.patterns.some((p) => p.test(target))) {
        if (rule.key.startsWith("work_exp_") && !hasWorkExperienceContext(input)) {
          continue
        }
        safeKey = rule.key
        break
      }
    }
  }

  return {
    el: input,
    label,
    selector: buildSelector(input),
    inputType,
    safeKey,
    sensitive,
  }
}

// ── Profile → field-value resolution ─────────────────────────────────────────

type ValueResolutionState = {
  keyHits: Partial<Record<SafeKey, number>>
}

function nextKeyHitIndex(state: ValueResolutionState, key: SafeKey): number {
  const current = state.keyHits[key] ?? 0
  state.keyHits[key] = current + 1
  return current
}

function toTrimmed(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getWorkExperienceAt(profile: SafeProfile, index: number) {
  const rows = Array.isArray(profile.work_experience) ? profile.work_experience : []
  if (index < 0 || index >= rows.length) return null
  return rows[index] ?? null
}

function formatMonthYear(raw: string | null | undefined): string | null {
  const value = toTrimmed(raw)
  if (!value) return null

  const iso = value.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/)
  if (iso) {
    const month = Number.parseInt(iso[2], 10)
    const year = Number.parseInt(iso[1], 10)
    if (Number.isFinite(month) && month >= 1 && month <= 12 && Number.isFinite(year)) {
      return `${String(month).padStart(2, "0")}/${year}`
    }
  }

  const slash = value.match(/^(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const month = Number.parseInt(slash[1], 10)
    const year = Number.parseInt(slash[2], 10)
    if (Number.isFinite(month) && month >= 1 && month <= 12 && Number.isFinite(year)) {
      return `${String(month).padStart(2, "0")}/${year}`
    }
  }

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    const month = parsed.getUTCMonth() + 1
    const year = parsed.getUTCFullYear()
    if (year > 1900) return `${String(month).padStart(2, "0")}/${year}`
  }

  return value
}

function buildWorkDescription(row: {
  description?: string | null
  achievements?: string[] | null
} | null): string | null {
  if (!row) return null
  const description = toTrimmed(row.description)
  const achievements = Array.isArray(row.achievements)
    ? row.achievements
        .map((item) => toTrimmed(item ?? null))
        .filter((item): item is string => Boolean(item))
    : []
  if (description && achievements.length > 0) {
    return `${description}\n${achievements.map((a) => `• ${a}`).join("\n")}`.slice(0, 2800)
  }
  if (description) return description.slice(0, 2800)
  if (achievements.length > 0) return achievements.map((a) => `• ${a}`).join("\n").slice(0, 2800)
  return null
}

function normalizedTopSkills(profile: SafeProfile): string[] {
  const fromArray = Array.isArray(profile.top_skills) ? profile.top_skills : []
  const fromString = typeof profile.skills === "string" ? profile.skills.split(",") : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...fromArray, ...fromString]) {
    const skill = typeof raw === "string" ? raw.trim() : ""
    if (!skill) continue
    const key = skill.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(skill)
    if (out.length >= 28) break
  }
  return out
}

function profileValueFor(profile: SafeProfile, key: SafeKey, state: ValueResolutionState): string | null {
  switch (key) {
    case "first_name":   return profile.first_name ?? null
    case "last_name":    return profile.last_name ?? null
    case "full_name":    {
      const parts = [profile.first_name, profile.last_name].filter(Boolean)
      return parts.length > 0 ? parts.join(" ") : null
    }
    case "email":        return profile.email ?? null
    case "phone":        return profile.phone ?? null
    case "linkedin_url": return profile.linkedin_url ?? null
    case "github_url":   return profile.github_url ?? null
    case "portfolio_url":return profile.portfolio_url ?? null
    case "website_url":  return profile.website_url ?? profile.portfolio_url ?? null
    case "location": {
      const parts = [profile.city, profile.state].filter(Boolean)
      return parts.length > 0 ? parts.join(", ") : null
    }
    case "resume_upload":
    case "cover_letter_upload":
      return null // Always manual_required — file uploads aren't filled by the MVP
    case "current_title": {
      const idx = nextKeyHitIndex(state, key)
      const row = getWorkExperienceAt(profile, idx)
      return toTrimmed(row?.title ?? null) ?? (idx === 0 ? toTrimmed(profile.current_title ?? null) : null)
    }
    case "current_company": {
      const idx = nextKeyHitIndex(state, key)
      const row = getWorkExperienceAt(profile, idx)
      return toTrimmed(row?.company ?? null) ?? (idx === 0 ? toTrimmed(profile.current_company ?? null) : null)
    }
    case "resume_summary":  return profile.resume_summary ?? null
    case "work_exp_start": {
      const idx = nextKeyHitIndex(state, key)
      const row = getWorkExperienceAt(profile, idx)
      return formatMonthYear(row?.start_date ?? null)
    }
    case "work_exp_end": {
      const idx = nextKeyHitIndex(state, key)
      const row = getWorkExperienceAt(profile, idx)
      if (!row || row.is_current) return null
      return formatMonthYear(row.end_date ?? null)
    }
    case "work_exp_current": {
      const idx = nextKeyHitIndex(state, key)
      const row = getWorkExperienceAt(profile, idx)
      return row?.is_current ? "true" : null
    }
    case "work_exp_description": {
      const idx = nextKeyHitIndex(state, key)
      const row = getWorkExperienceAt(profile, idx)
      return buildWorkDescription(row)
    }
    case "skills": {
      const skills = normalizedTopSkills(profile)
      return skills.length > 0 ? skills.join(", ") : null
    }
  }
}

// ── Public: build preview from page + profile ────────────────────────────────

/**
 * Detect safe fields on the page and produce a preview list of what we WOULD
 * fill with the given profile. Does NOT mutate the DOM. The caller renders
 * this preview, then calls applySafeFills() with the same list to commit.
 */
export function buildAutofillPreview(
  source: AutofillSource,
  profile: SafeProfile | null,
  doc: Document = document,
): AutofillFieldResult[] {
  const root = findApplicationFormRoot(doc, source)
  let inputs: LocatedControl[] = []
  if (root) {
    inputs = collectControlsInElement(root, [])
  }
  if (inputs.length === 0) {
    // Fallback: include controls from the whole document tree (including
    // accessible same-origin iframes) when scoped root detection misses.
    inputs = collectControlsInDocument(doc)
  }

  const results: AutofillFieldResult[] = []
  const valueState: ValueResolutionState = { keyHits: {} }

  for (const { el: input, framePath } of inputs) {
    const f = classifyField(input)
    const selector = buildSelectorWithFrame(input, framePath)

    // Skip sensitive
    if (f.sensitive) {
      results.push({
        label: f.label,
        selector,
        confidence: "needs_review",
        source: "manual_required",
        filled: false,
        skippedReason: "Sensitive question — review and answer manually.",
      })
      continue
    }

    // Resume upload: surface as "Will attach" in the preview when the user
    // has a primary resume on file. The actual attach happens at confirm-time
    // via DataTransfer (same approach as JobRight / FrogHire / the legacy
    // overlay's INJECT_RESUME_FILE flow).
    if (f.safeKey === "resume_upload") {
      results.push({
        label: f.label,
        selector,
        valuePreview: "Your primary resume",
        confidence: "high",
        source: "resume",
        filled: false,
      })
      continue
    }
    // Cover letter upload: detected here so apex-bar knows the selector.
    // The actual generate/review/attach flow runs in a separate phase after
    // the regular profile fill (see apex-bar's CoverLetter section), so
    // applySafeFills() must skip these rows. We surface them with
    // source: "cover_letter" as the signal.
    if (f.safeKey === "cover_letter_upload") {
      results.push({
        label: f.label,
        selector,
        valuePreview: "Will generate & attach below",
        confidence: "high",
        source: "cover_letter",
        filled: false,
      })
      continue
    }

    // Unknown field (not a safe key, not sensitive)
    if (!f.safeKey) {
      results.push({
        label: f.label,
        selector,
        confidence: "needs_review",
        source: "manual_required",
        filled: false,
        skippedReason: "Custom question — answer manually.",
      })
      continue
    }

    // Safe key — try to resolve from profile
    if (!profile) {
      results.push({
        label: f.label,
        selector,
        confidence: "needs_review",
        source: "manual_required",
        filled: false,
        skippedReason: "No saved autofill profile.",
      })
      continue
    }

    const value = profileValueFor(profile, f.safeKey, valueState)
    if (!value) {
      results.push({
        label: f.label,
        selector,
        confidence: "needs_review",
        source: "profile",
        filled: false,
        skippedReason: "Profile field is empty.",
      })
      continue
    }

    // Confidence: high when label/name closely matches the safe key,
    // medium when matched via softer signals (placeholder, autocomplete only).
    const confidence: "high" | "medium" =
      [f.label, input.getAttribute("name") ?? "", input.id]
        .filter(Boolean)
        .some((s) => SAFE_KEY_RULES.find((r) => r.key === f.safeKey)?.patterns.some((p) => p.test(s)))
        ? "high"
        : "medium"

    results.push({
      label: f.label,
      selector,
      valuePreview: previewValue(f.safeKey, value),
      fillValue: value,
      confidence,
      source: "profile",
      filled: false,
    })
  }

  return results
}

/** Mask sensitive values in the preview (email/phone) so the bar doesn't expose them. */
function previewValue(key: SafeKey, value: string): string {
  if (key === "email") {
    const [local, domain] = value.split("@")
    if (!domain) return value
    const masked = local.length <= 2 ? local : `${local[0]}…${local[local.length - 1]}`
    return `${masked}@${domain}`
  }
  if (key === "phone") {
    return value.length > 4 ? `…${value.slice(-4)}` : value
  }
  if (key === "work_exp_current") {
    return value === "true" ? "Yes" : value
  }
  if (key === "skills" && value.length > 140) {
    return `${value.slice(0, 137)}…`
  }
  return value
}

// ── Public: apply fills ──────────────────────────────────────────────────────

/**
 * Bytes of the user's primary resume — used for file-input attachment.
 * Caller fetches once via api-client and passes here so this module stays
 * free of chrome.runtime imports (testable in isolation).
 */
export type ResumeBytes = { base64: string; filename: string }

/**
 * Commit the preview to the DOM. Sets values via React-aware native setters
 * and dispatches input/change/blur events so React-controlled inputs accept.
 * For resume_upload fields, uses the same DataTransfer pattern that the
 * legacy overlay (and JobRight / FrogHire) use to attach a real File.
 *
 * Returns a new AutofillFieldResult[] with `filled: true` on success and
 * skippedReason populated when fill failed.
 */
export async function applySafeFills(
  source: AutofillSource,
  profile: SafeProfile,
  resumeBytes: ResumeBytes | null,
  doc: Document = document,
): Promise<AutofillFieldResult[]> {
  const preview = buildAutofillPreview(source, profile, doc)
  const out: AutofillFieldResult[] = []

  for (const item of preview) {
    if (!item.selector || item.skippedReason) {
      out.push(item)
      continue
    }
    // Cover letter rows are owned by the cover-letter review flow in apex-bar.
    // Pass them through unchanged so the bar can attach later.
    if (item.source === "cover_letter") {
      out.push(item)
      continue
    }
    let el: HTMLElement | null = null
    el = resolveFramePrefixedSelector(item.selector, doc)
    if (!el) {
      out.push({ ...item, skippedReason: "Field disappeared from page — skipped." })
      continue
    }

    // Recompute the actual safeKey at fill-time (so preview and apply stay aligned).
    const safeKey = classifyField(el as FormControlElement).safeKey
    if (!safeKey) {
      out.push({ ...item, skippedReason: "Could not re-classify at fill time — skipped." })
      continue
    }

    // Resume file attach
    if (safeKey === "resume_upload") {
      if (!resumeBytes) {
        out.push({
          ...item,
          source: "manual_required",
          skippedReason: "No resume on file — upload one in Hireoven first.",
        })
        continue
      }
      const ok = injectResumeFile(el as HTMLInputElement, resumeBytes)
      out.push(ok
        ? { ...item, filled: true, source: "resume" }
        : { ...item, source: "manual_required", skippedReason: "Could not attach resume — attach it manually." },
      )
      continue
    }

    let ok = false
    if (safeKey === "skills") {
      const skills = (item.fillValue ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
      ok = fillSkillTokens(el, skills)
    } else if (safeKey === "work_exp_current") {
      ok = item.fillValue === "true" ? setReactChecked(el, true) : true
    } else {
      const value = item.fillValue ?? null
      if (!value) {
        out.push({ ...item, skippedReason: "Profile value missing at fill time — skipped." })
        continue
      }
      ok = setReactValue(el, value)
    }
    out.push(ok
      ? { ...item, filled: true }
      : { ...item, skippedReason: "Could not set field value — fill it manually." },
    )
  }

  return out
}

/**
 * Attach a generated DOCX (resume or cover letter) to a file input via the
 * same DataTransfer pattern used by JobRight / FrogHire. Exported so apex-bar
 * can call it directly for the cover-letter Attach step.
 */
export function injectDocxFile(target: HTMLInputElement, bytes: ResumeBytes): boolean {
  return injectResumeFile(target, bytes)
}

/**
 * Attach a resume file to a file input via DataTransfer. Mirrors the
 * legacy `injectResumeFile()` in content.ts — Chrome grants extension
 * isolated worlds the right to set `input.files` even though regular page
 * scripts cannot.
 */
function injectResumeFile(target: HTMLInputElement, bytes: ResumeBytes): boolean {
  try {
    const binary = atob(bytes.base64)
    const arr = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)

    const lower = bytes.filename.toLowerCase()
    const mimeType =
      lower.endsWith(".pdf")
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    const blob = new Blob([arr], { type: mimeType })
    const file = new File([blob], bytes.filename, { type: mimeType, lastModified: Date.now() })

    const dt = new DataTransfer()
    dt.items.add(file)

    // React-controlled inputs only re-render when the native setter is invoked
    // BEFORE the input/change events fire — otherwise React's onChange sees the
    // synthesized value and ignores the later setter call. Set first, dispatch
    // second; plain assignment is the fallback for non-React forms.
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set
    if (nativeSetter) nativeSetter.call(target, dt.files)
    else target.files = dt.files

    target.dispatchEvent(new Event("input", { bubbles: true }))
    target.dispatchEvent(new Event("change", { bubbles: true }))

    // Verify the attach actually took (some forms re-validate and reject
    // synthetic file events — better to surface that than silently "succeed").
    return target.files !== null && target.files.length > 0
  } catch {
    return false
  }
}

function setReactChecked(el: HTMLElement, checked: boolean): boolean {
  if (el.tagName.toLowerCase() !== "input") return false
  const inputEl = el as HTMLInputElement
  const type = (inputEl.type ?? "").toLowerCase()
  if (type !== "checkbox" && type !== "radio") return false
  try {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set
    setter?.call(inputEl, checked)
    inputEl.dispatchEvent(new Event("input", { bubbles: true }))
    inputEl.dispatchEvent(new Event("change", { bubbles: true }))
    inputEl.dispatchEvent(new Event("blur", { bubbles: true }))
    return inputEl.checked === checked
  } catch {
    return false
  }
}

function dispatchEnterKey(el: HTMLElement): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }))
  el.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }))
  el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }))
}

function isTokenizedSkillInput(el: HTMLElement): boolean {
  const role = (el.getAttribute("role") ?? "").toLowerCase()
  const ariaAutocomplete = (el.getAttribute("aria-autocomplete") ?? "").toLowerCase()
  if (role === "combobox") return true
  if (ariaAutocomplete === "list" || ariaAutocomplete === "both") return true
  const container = el.closest(
    "[data-automation-id*='token'], [data-automation-id*='chip'], [data-automation-id*='tag'], [class*='token'], [class*='chip'], [class*='tag']",
  )
  return Boolean(container)
}

function fillSkillTokens(el: HTMLElement, skills: string[]): boolean {
  const normalized = skills
    .map((skill) => skill.trim())
    .filter((skill) => skill.length > 0)
    .slice(0, 20)

  if (normalized.length === 0) return false

  if (el.tagName.toLowerCase() === "select") {
    const select = el as HTMLSelectElement
    let matched = 0
    const want = new Set(normalized.map((skill) => skill.toLowerCase()))
    Array.from(select.options).forEach((option) => {
      const txt = option.textContent?.trim().toLowerCase() ?? ""
      const val = option.value.trim().toLowerCase()
      if (want.has(txt) || want.has(val)) {
        option.selected = true
        matched += 1
      }
    })
    if (matched > 0) {
      select.dispatchEvent(new Event("input", { bubbles: true }))
      select.dispatchEvent(new Event("change", { bubbles: true }))
      select.dispatchEvent(new Event("blur", { bubbles: true }))
      return true
    }
    return false
  }

  if (el.tagName.toLowerCase() !== "input" && el.tagName.toLowerCase() !== "textarea") {
    return false
  }

  if (!isTokenizedSkillInput(el)) {
    return setReactValue(el, normalized.join(", "))
  }

  let wrote = false
  for (const skill of normalized) {
    const ok = setReactValue(el, skill, { blur: false })
    if (!ok) continue
    dispatchEnterKey(el)
    wrote = true
  }
  el.dispatchEvent(new Event("blur", { bubbles: true }))
  return wrote
}

/**
 * Set an input/textarea/select value in a way React's controlled-input synthetic
 * event system will accept. Mirrors the pattern in chrome-extension/src/content.ts.
 */
export function setReactValue(el: HTMLElement, value: string, opts?: { blur?: boolean }): boolean {
  const tag = el.tagName.toLowerCase()
  try {
    if (tag === "textarea") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(el as HTMLTextAreaElement, value)
    } else if (tag === "select") {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
      setter?.call(el as HTMLSelectElement, value)
    } else if (tag === "input") {
      const inputEl = el as HTMLInputElement
      const type = (inputEl.type ?? "").toLowerCase()
      // file inputs aren't filled here (preview/applySafeFills already skipped)
      if (type === "file" || type === "submit" || type === "button") return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(inputEl, value)
    } else {
      return false
    }
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    if (opts?.blur !== false) {
      el.dispatchEvent(new Event("blur", { bubbles: true }))
    }
    return true
  } catch {
    return false
  }
}

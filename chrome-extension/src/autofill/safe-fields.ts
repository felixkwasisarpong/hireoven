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

import { SHADOW_DELIM, queryAllDeep, queryShadowSelector, shadowHostChain } from "./shadow-dom"

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
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
  country?: string | null
  authorized_to_work?: boolean | null
  requires_sponsorship?: boolean | null
  /** Free-text visa/work-auth status, e.g. "OPT", "STEM OPT", "H-1B", "Citizen". */
  work_authorization?: string | null
  earliest_start_date?: string | null
  willing_to_relocate?: boolean | null
  preferred_work_type?: string | null
  // Salary expectations
  salary_expectation_min?: number | null
  salary_expectation_max?: number | null
  // EEO / self-identification — only populated when auto_fill_diversity is on
  auto_fill_diversity?: boolean | null
  gender?: string | null
  ethnicity?: string | null
  hispanic_latino?: string | null
  veteran_status?: string | null
  disability_status?: string | null
  // User-saved custom answers (dashboard "Common questions"): regex pattern →
  // the user's own answer. Highest-precedence source in the question tier.
  custom_answers?: Array<{ question_pattern: string; answer: string }> | null
  // Resume-derived
  current_title?: string | null
  current_company?: string | null
  resume_location?: string | null
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
  // Education, resume-derived. The server (autofill-profile route) sends both a
  // multi-row list AND flat "highest degree" fields; the flat ones back-fill a
  // single-entry form when the list is absent.
  resume_education?: Array<{
    institution?: string | null
    degree?: string | null
    field?: string | null
    start_date?: string | null
    end_date?: string | null
    gpa?: string | null
  }> | null
  highest_degree?: string | null
  field_of_study?: string | null
  university?: string | null
  graduation_year?: number | string | null
  gpa?: string | null
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
  | "jazzhr"
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
  | "address_line1"
  | "location"
  | "city"
  | "state"
  | "zip_code"
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
  | "school"
  | "degree"
  | "field_of_study"
  | "graduation_date"
  | "gpa"
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
  // labelOnly: the `^name$` anchor must test the human label, not the joined
  // haystack — Ashby/CSS-module forms pollute name/id with opaque tokens
  // (`_systemfield_name`) that break the anchor and drop the field to "custom
  // question". first_name/last_name still win first via their \b… patterns.
  { key: "full_name",  patterns: [/\bfull[\s_-]?name\b|^name$|\bcandidate[\s_-]?name\b|\b(full[\s_-]?)?legal[\s_-]?name\b/i], labelOnly: true },

  // Contact
  { key: "email", patterns: [/\bemail\b|\be[\s-]?mail\b/i] },
  { key: "phone", patterns: [/\bphone\b|\bmobile\b|\btelephone\b|\btel\b/i] },

  // URLs — order: linkedin > github > portfolio > website (most specific first)
  { key: "linkedin_url",  patterns: [/\blinkedin\b/i] },
  { key: "github_url",    patterns: [/\bgithub\b|\bgit[\s_-]?hub\b/i] },
  { key: "portfolio_url", patterns: [/\bportfolio\b|\bpersonal[\s_-]?site\b/i] },
  // NOTE: bare "url" must NOT claim social-handle fields ("Twitter URL",
  // "Facebook URL", …) — the profile has no value for those, and the old rule
  // was pouring the portfolio domain into the Twitter box on Lever forms.
  { key: "website_url",   patterns: [/\bwebsite\b|\bother[\s_-]?(site|link|url)\b|\bhomepage\b/i, /^(?!.*\b(twitter|facebook|instagram|youtube|tiktok|dribbble|behance|medium|stack[\s_-]?overflow|x)\b).*\burl\b/i] },

  // Address block — dedicated City/State/Zip rules MUST precede the generic
  // `location` rule below so forms with separate inputs get each part filled,
  // rather than every one collapsing to the combined "City, State" value.
  // (Workday/Ashby have their own address handling; these serve Greenhouse,
  // Lever and generic forms.) `address-level1/2` match the autocomplete tokens.
  // "state" the NOUN, never the VERB — "Please state your full legal name"
  // was matching this rule and pouring the profile state ("TX") into the
  // legal-name box. Reject when followed by your/the/a/if/why/how/what.
  // Street address only. The negative lookahead MUST exclude the HTML
  // autocomplete tokens `address-level1` (State) and `address-level2` (City) —
  // otherwise this rule (evaluated before state/city) steals those fields and
  // pours the street address (or nothing) into them. Also excludes "address
  // line 2". Matches bare "address", "street address", "address line 1".
  { key: "address_line1", patterns: [/\baddress\b(?![\s_-]*(?:level|line[\s_-]*2))/i, /\bstreet[\s_-]?address\b|\baddress[\s_-]?line[\s_-]?1\b/i] },
  { key: "state",     patterns: [/\bstate\b(?![\s:]*\b(your|the|a|an|if|why|how|what|where|which|below))|\bprovince\b|\baddress[\s_-]?level[\s_-]?1\b/i] },
  { key: "city",      patterns: [/\bcity\b|\btown\b|\bmunicipalit/i, /\baddress[\s_-]?level[\s_-]?2\b/i] },
  { key: "zip_code",  patterns: [/\bzip\b|\bzip[\s_-]?code\b|\bpostal\b|\bpostal[\s_-]?code\b|\bpost[\s_-]?code\b|\bpostcode\b/i] },

  // Location (single-line city/region)
  { key: "location", patterns: [/\blocation\b|\bcity\b/i] },

  // Resume-derived fields
  { key: "work_exp_current", patterns: [/\bi[\s_-]*currently[\s_-]*work[\s_-]*here\b|currently[\s_-]*(?:employed|work(?:ing)?)\b/i], inputTypes: ["checkbox"], labelOnly: true },
  { key: "work_exp_start",   patterns: [/^\s*from\s*$/i, /\bstart[\s_-]?date\b/i, /\bdate[\s_-]?started\b/i, /\bemployment[\s_-]?start\b/i], inputTypes: ["text", "date", "month"], labelOnly: true },
  { key: "work_exp_end",     patterns: [/^\s*to\s*$/i, /\bend[\s_-]?date\b/i, /\bdate[\s_-]?ended\b/i, /\bemployment[\s_-]?end\b/i, /\bthrough\b/i], inputTypes: ["text", "date", "month"], labelOnly: true },
  { key: "work_exp_description", patterns: [/\brole[\s_-]?description\b|\bjob[\s_-]?description\b|\bresponsibilit/i, /\baccomplishment|achievement|duties\b/i], labelOnly: true },

  // Education (resume-derived). labelOnly so opaque name/id tokens don't false-
  // match; these serve Greenhouse/Lever/Ashby/BambooHR/iCIMS/generic forms with
  // an education section. Workday has its own multi-step education handler.
  // "field of study" before "degree"/"school" so "Major" resolves to the field.
  { key: "field_of_study",  patterns: [/\bfield[\s_-]?of[\s_-]?study\b|\barea[\s_-]?of[\s_-]?study\b|\bcourse[\s_-]?of[\s_-]?study\b|\bconcentration\b|\bspecial(?:ization|isation)\b/i, /\bmajor\b(?!\s*(?:responsibilit|achievement|accomplishment|dut|contribution))/i], labelOnly: true },
  { key: "graduation_date", patterns: [/\bgraduation\b|\bgrad[\s_-]?(?:date|year)\b|\byear[\s_-]?(?:of[\s_-]?)?graduat|\bexpected[\s_-]?graduation\b|\bcompletion[\s_-]?(?:date|year)\b/i], labelOnly: true },
  { key: "gpa",             patterns: [/\bgpa\b|\bgrade[\s_-]?point[\s_-]?average\b/i], labelOnly: true },
  { key: "degree",          patterns: [/\bdegree\b|\bqualification\b|\bhighest[\s_-]?(?:level[\s_-]?of[\s_-]?)?education\b|\beducation[\s_-]?level\b/i], labelOnly: true },
  { key: "school",          patterns: [/\bschool\b|\buniversit|\bcollege\b|\binstitution\b|\balma[\s_-]?mater\b/i], labelOnly: true },
  { key: "current_title",   patterns: [/current[\s_-]?(?:job[\s_-]?)?title|job[\s_-]?title|\btitle\b|current[\s_-]?role|position[\s_-]?title/i] },
  // Bare "company" must NOT claim message/interest prompts ("Let the company
  // know about your interest…") — require an employer-ish phrasing, or bare
  // company/employer only when the label isn't a sentence-style prompt.
  { key: "current_company", patterns: [/current[\s_-]?(?:employer|company|organization)|employer[\s_-]?name|company[\s_-]?name|(?:most[\s_-]?recent|previous|last)[\s_-]?employer/i, /^(?!.*\b(know|interest|why|tell|message|question|contact)\b).*(\bemployer\b|\bcompany\b)/i] },
  { key: "resume_summary",  patterns: [/professional[\s_-]?summary|about[\s_-]?(?:you|yourself)|tell[\s_-]?us[\s_-]?about|career[\s_-]?(?:summary|objective)|personal[\s_-]?summary/i] },
  { key: "skills",          patterns: [/\bskills?\b|technical[\s_-]?skills?|key[\s_-]?skills?|core[\s_-]?competenc|areas?[\s_-]?of[\s_-]?expertise/i] },
]

// ── Form scoping per source ──────────────────────────────────────────────────

const FORM_CONTROL_SELECTOR =
  // The tabindex/aria-hidden exclusions filter out react-select plumbing inputs,
  // but file inputs are LEGITIMATELY rendered hidden (tabindex="-1", clipped) and
  // triggered by a styled button/dropzone — Ashby's Resume field is exactly this.
  // Always include `input[type=file]` so résumé/attachment fields are collected.
  "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([aria-hidden='true']):not([tabindex='-1']), input[type=file], select, textarea"
const FRAME_SELECTOR_PREFIX = "__ho_frame:"
type FormControlElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
type LocatedControl = { el: FormControlElement; framePath: number[] }

/**
 * Scope detection to the application form container so we don't hit unrelated
 * inputs on the page (search bars, newsletter, etc.). Returns the form root
 * element if found, or null when not on a supported application form.
 */
/**
 * True for controls that belong to the SITE's chrome, not the application:
 * nav/header search boxes, footer newsletter signups, cookie banners. These
 * must never appear in the autofill preview ("Search For:" is not a question).
 */
function isSiteChromeControl(el: HTMLElement): boolean {
  if (el.closest("nav, [role='navigation'], [role='search'], [aria-label*='cookie' i], [id*='cookie' i]")) return true
  const hay = [
    el.getAttribute("name") ?? "",
    el.id,
    el.getAttribute("placeholder") ?? "",
    el.getAttribute("aria-label") ?? "",
  ].join(" ").toLowerCase()
  if (/\b(search|newsletter|subscribe)\b/.test(hay)) return true
  // Header-level search widgets often live outside <nav> — a text control whose
  // resolved label is just "Search…" is never an application question.
  const label = getFieldLabel(el).toLowerCase().trim()
  return /^search\b( for| jobs)?:?$/.test(label)
}

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
      // Real Ashby markup uses these *unprefixed* stable classes (the
      // `_jobPostingForm_<hash>` is the CSS-module twin). The application form is
      // a <div>, not a <form>. Scoping here is critical: it EXCLUDES the separate
      // "Autofill from resume" parser pane (.ashby-application-form-autofill-uploader),
      // so we don't re-upload to the parser and race its re-parse while attaching
      // the résumé to the real required Resume field.
      ".ashby-application-form-container",
      ".ashby-application-form",
      // Legacy/older builds (kept as fallbacks).
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
      "[data-test='application-form']",
      "#oneclick-ui form",
      "#oneclick-ui",
      "form[action*='smartrecruiters']",
      "form",
      "main",
    ],
    bamboohr: [
      "#bamboohr-apply",
      ".BambooHR-ATS form",
      "#apply-form-card form",
      "form[action*='bamboohr']",
      "form",
    ],
    jazzhr: [
      "form#form_submit_new_resume",
      "form[data-test='form_submit_new_resume']",
      "#resumator-application-form form",
      "form[action*='applytojob.com/apply']",
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
  const candidates: Array<{ root: HTMLElement; score: number; sel: string }> = []

  for (const sel of selectors) {
    doc.querySelectorAll<HTMLElement>(sel).forEach((root) => {
      if (seen.has(root)) return
      seen.add(root)
      const score = root.querySelectorAll(FORM_CONTROL_SELECTOR).length
      if (score > 0) candidates.push({ root, score, sel })
    })
  }

  // Fallback for Workday-style layouts where the visible step has no formal form wrapper.
  if (candidates.length === 0) {
    doc.querySelectorAll<HTMLElement>("main section, [role='main'] section, main article, [role='main'] article").forEach((root) => {
      if (seen.has(root)) return
      const score = root.querySelectorAll(FORM_CONTROL_SELECTOR).length
      if (score >= 3) candidates.push({ root, score, sel: "main-section" })
    })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  const top = candidates[0]

  // Some ATS forms split ONE application form into SIBLING containers that each
  // match the same selector — e.g. Baseten's Ashby form renders the main fields
  // (Name/Email/…) and the EEO block as two disjoint `.ashby-application-form-
  // container`s. Picking the single highest-scoring one silently drops every
  // field in the others (the "0 ready to fill, only EEO shows" bug). When the top
  // candidate has disjoint same-selector siblings, climb to the smallest common
  // ancestor that holds them all (bounded away from <body> so we never grab the
  // page's nav/search inputs).
  const siblings = candidates.filter(
    (c) => c.sel === top.sel && c.root !== top.root && !top.root.contains(c.root) && !c.root.contains(top.root),
  )
  if (siblings.length > 0) {
    const ancestor = lowestCommonAncestor([top.root, ...siblings.map((c) => c.root)])
    if (ancestor) return ancestor
  }
  return top.root
}

/** Smallest common ancestor of the elements, or null if it would be <body>/<html>. */
function lowestCommonAncestor(els: HTMLElement[]): HTMLElement | null {
  if (els.length === 0) return null
  let ancestor: HTMLElement | null = els[0]
  for (let i = 1; i < els.length && ancestor; i += 1) {
    const chain = new Set<HTMLElement>()
    for (let n: HTMLElement | null = ancestor; n; n = n.parentElement) chain.add(n)
    let found: HTMLElement | null = null
    for (let n: HTMLElement | null = els[i]; n; n = n.parentElement) {
      if (chain.has(n)) { found = n; break }
    }
    ancestor = found
  }
  if (ancestor && (ancestor.tagName === "BODY" || ancestor.tagName === "HTML")) return null
  return ancestor
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
  // Web-component control (SmartRecruiters spl-input etc.): the human label is
  // an attribute on the shadow HOST (`<spl-input label="First name">`), and any
  // wrapping label/row lives in the light DOM around the host — so read the
  // host attribute first, then fall through to labelling the host itself.
  const rootNode = input.getRootNode()
  if (rootNode instanceof ShadowRoot && rootNode.host instanceof HTMLElement) {
    const host = rootNode.host
    const hostLabel = host.getAttribute("label") ?? host.getAttribute("aria-label")
    if (hostLabel?.trim()) return hostLabel.trim()
    const aria = input.getAttribute("aria-label") ?? input.getAttribute("placeholder")
    if (aria?.trim()) return aria.trim()
    return getFieldLabel(host)
  }
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

  // CSS-module ATSes (Ashby's `_fieldEntry_<hash>` rows, etc.) associate the
  // label with the control purely by DOM proximity: no `for`, no wrapping
  // <label>, no aria, no placeholder. Without this, every Ashby field falls
  // through to its opaque id (`_systemfield_…`) and shows in the drawer as an
  // unnamed row that can't be classified — i.e. the "long list of fields with
  // no name, autofill only partial" failure. Climb a few row-wrappers and take
  // the nearest label-like element, but only while the wrapper holds a single
  // control so we never borrow a neighbouring field's label.
  const tidy = (s: string | null | undefined) =>
    (s ?? "").replace(/\s+/g, " ").replace(/[\s*]+$/, "").trim()
  let row: HTMLElement | null = input.parentElement
  for (let depth = 0; row && depth < 4; depth += 1, row = row.parentElement) {
    if (row.querySelectorAll("input, select, textarea").length > 2) break
    const lbl = row.querySelector<HTMLElement>(
      "label, legend, [class*='label' i], [data-testid*='label' i]",
    )
    if (lbl && tidy(lbl.textContent)) return tidy(lbl.textContent)
  }

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

function buildSelectorInTree(input: HTMLElement): string {
  if (input.id) return `#${CSS.escape(input.id)}`
  const name = input.getAttribute("name")
  if (name) return `${input.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`
  // No id/name (common on React/Remix forms): build a unique nth-of-type path so
  // the selector resolves to THIS element. A bare `input` tag would resolve to the
  // first input on the page and clobber an unrelated field.
  return buildUniquePath(input)
}

function buildSelector(input: HTMLElement): string {
  // Controls inside open shadow roots need a host-hopping path
  // ("spl-input#first-name-input >>> input") — a flat CSS selector can never
  // cross a shadow boundary.
  const segments = [buildSelectorInTree(input)]
  for (const host of shadowHostChain(input).reverse()) {
    segments.unshift(buildSelectorInTree(host))
  }
  return segments.join(SHADOW_DELIM)
}

/**
 * Build a CSS path that uniquely identifies `el`, walking up to the nearest
 * ancestor with an id (or <body>) and chaining `tag:nth-of-type(n)` segments.
 */
function buildUniquePath(el: HTMLElement): string {
  const segments: string[] = []
  let node: HTMLElement | null = el
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    if (node.id) {
      segments.unshift(`#${CSS.escape(node.id)}`)
      break
    }
    const tag = node.tagName.toLowerCase()
    if (tag === "body" || tag === "html") {
      segments.unshift(tag)
      break
    }
    const parent: HTMLElement | null = node.parentElement
    if (!parent) {
      segments.unshift(tag)
      break
    }
    const sameTag = Array.from(parent.children).filter(
      (c) => c.tagName === node!.tagName,
    )
    const idx = sameTag.indexOf(node) + 1
    segments.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${idx})` : tag)
    node = parent
  }
  return segments.join(" > ")
}

function buildSelectorWithFrame(input: HTMLElement, framePath: number[]): string {
  const base = buildSelector(input)
  if (framePath.length === 0) return base
  return `${FRAME_SELECTOR_PREFIX}${framePath.join(".")}::${base}`
}

// Ashby's "Autofill from resume" PARSER pane also holds a file dropzone. When
// the form root widens to a common ancestor (multi-section Ashby forms), that
// pane comes into scope — its input must be skipped so we never attach the
// résumé to the parser (which triggers a re-parse) instead of the real Resume
// field. Tight per-container scoping used to exclude it implicitly.
const PARSER_PANE_SELECTOR = "[class*='autofill-uploader' i], [class*='autofill-input' i]"

function collectControlsInElement(root: ParentNode, framePath: number[]): LocatedControl[] {
  // Deep query — SmartRecruiters oneclick-ui (spl-* web components) puts every
  // control inside an open shadow root; a plain querySelectorAll sees nothing.
  return queryAllDeep<FormControlElement>(root, FORM_CONTROL_SELECTOR)
    .filter((el) => !el.closest?.(PARSER_PANE_SELECTOR))
    .map((el) => ({ el, framePath }))
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
    return queryShadowSelector(topDoc, selector)
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
  return queryShadowSelector(doc, baseSelector)
}

/**
 * react-select / combobox widgets (Greenhouse Country, Location, School, Degree;
 * Ashby dropdowns) render a text `<input>` that can't be filled by setting
 * `.value` — they need a click → type → option-pick interaction. Detect them so
 * we skip rather than silently "succeed" with a value that never sticks.
 */
function isComboboxControl(input: HTMLElement): boolean {
  if (input.getAttribute("role") === "combobox") return true
  if (input.getAttribute("aria-autocomplete") === "list") return true
  if (input.getAttribute("aria-haspopup") === "listbox") return true
  const cls = input.getAttribute("class") ?? ""
  if (/\bselect__input\b|\bselect__control\b/.test(cls)) return true
  return false
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
  const combobox = isComboboxControl(input)
  // Branch-dependent follow-ups ("If you selected international, what
  // location(s)?", "If yes, what type of sponsorship?") must never take a
  // generic profile value — the answer depends on a branch the applicant may
  // not have taken. This was pouring the profile city into the international
  // box on Lever forms. Leave them for manual review.
  const conditionalFollowUp = /^if\b/i.test(label.trim())
  let safeKey: SafeKey | null = null
  if (!sensitive && !combobox && !conditionalFollowUp) {
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

  // Fallback: an unlabelled document-accepting file input on an application form
  // is almost always the resume dropzone (SmartRecruiters/Ashby render it with no
  // "resume"/"cv" text). Don't claim image/photo uploads or cover-letter slots.
  if (!safeKey && !sensitive && inputType === "file") {
    const accept = (input.getAttribute("accept") ?? "").toLowerCase()
    // Ashby puts the "Cover Letter, Portfolio…" hint in a sibling description
    // div (outside the haystack), so include the field row's text — otherwise
    // "Additional Attachments" gets mislabelled as the résumé and the résumé is
    // injected into the wrong slot.
    const row = input.closest<HTMLElement>(
      "[class*='fieldEntry' i],[class*='field-entry' i],.application-question,.field,fieldset",
    )
    const ctx = `${haystack} ${row?.textContent ?? ""}`.toLowerCase().slice(0, 400)
    const isResumeWord = /\bresume\b|\bcv\b|curriculum/.test(ctx)
    const isOtherAttachment =
      /\bcover[\s_-]?letter\b|\bportfolio\b|\battachment\b|\badditional\b|\btranscript\b|\bwriting[\s_-]?sample\b|\bphoto\b|\bheadshot\b|\bavatar\b/.test(ctx)
    const acceptsDocs = !accept || /pdf|\.doc|word|document|text|rtf|\.txt/.test(accept)
    const isImageOnly = accept !== "" && /image|\.png|\.jpe?g|\.gif|\.heic/.test(accept) && !acceptsDocs
    // Résumé only when it's a doc field that isn't another attachment slot — or
    // it explicitly says résumé/CV.
    if (acceptsDocs && !isImageOnly && (isResumeWord || !isOtherAttachment)) {
      safeKey = "resume_upload"
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

/**
 * Education entry at `index`, with the flat "highest degree" profile fields
 * synthesized into a row 0 fallback so a single-entry form still fills when the
 * server sent only the flat fields (no resume_education list).
 */
function getEducationAt(profile: SafeProfile, index: number) {
  const rows = Array.isArray(profile.resume_education) ? profile.resume_education : []
  if (index >= 0 && index < rows.length && rows[index]) return rows[index]
  if (index === 0) {
    const flat = {
      institution: toTrimmed(profile.university ?? null),
      degree: toTrimmed(profile.highest_degree ?? null),
      field: toTrimmed(profile.field_of_study ?? null),
      start_date: null as string | null,
      end_date: profile.graduation_year != null ? String(profile.graduation_year) : null,
      gpa: toTrimmed(profile.gpa ?? null),
    }
    if (flat.institution || flat.degree || flat.field || flat.end_date || flat.gpa) return flat
  }
  return null
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
    case "address_line1": return toTrimmed(profile.address_line1 ?? null)
    case "linkedin_url": return profile.linkedin_url ?? null
    case "github_url":   return profile.github_url ?? null
    case "portfolio_url":return profile.portfolio_url ?? null
    case "website_url":  return profile.website_url ?? profile.portfolio_url ?? null
    case "location": {
      const parts = [profile.city, profile.state].filter(Boolean)
      return parts.length > 0 ? parts.join(", ") : toTrimmed(profile.resume_location ?? null)
    }
    case "city":     return toTrimmed(profile.city ?? null)
    case "state":    return toTrimmed(profile.state ?? null)
    case "zip_code": return toTrimmed(profile.zip_code ?? null)
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
    case "school": {
      const row = getEducationAt(profile, nextKeyHitIndex(state, key))
      return toTrimmed(row?.institution ?? null)
    }
    case "degree": {
      const row = getEducationAt(profile, nextKeyHitIndex(state, key))
      return toTrimmed(row?.degree ?? null)
    }
    case "field_of_study": {
      const row = getEducationAt(profile, nextKeyHitIndex(state, key))
      return toTrimmed(row?.field ?? null)
    }
    case "graduation_date": {
      const row = getEducationAt(profile, nextKeyHitIndex(state, key))
      const raw = toTrimmed(row?.end_date ?? null)
      if (!raw) return null
      // A bare year ("2024") stays a year — graduation fields usually want the
      // year, and synthesizing "01/2024" invents a month the résumé never had.
      if (/^\d{4}$/.test(raw)) return raw
      return formatMonthYear(raw)
    }
    case "gpa": {
      const row = getEducationAt(profile, nextKeyHitIndex(state, key))
      return toTrimmed(row?.gpa ?? null)
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
  // Site-chrome plumbing (nav search boxes, cookie banners) must never count
  // as application fields — a careers page whose scoped "form root" is the
  // header search box otherwise shows an EMPTY preview while the real
  // application (EEO selects, questions) sits un-scanned further down.
  inputs = inputs.filter(({ el }) => !isSiteChromeControl(el))
  if (inputs.length < 2) {
    // Fallback: include controls from the whole document tree (including
    // accessible same-origin iframes) when scoped root detection misses or
    // catches only plumbing.
    inputs = collectControlsInDocument(doc).filter(({ el }) => !isSiteChromeControl(el))
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
  const out: (AutofillFieldResult | null)[] = new Array<AutofillFieldResult | null>(preview.length).fill(null)

  type Prepared = { index: number; item: AutofillFieldResult; safeKey: SafeKey }
  const pending: Prepared[] = []

  preview.forEach((item, index) => {
    if (!item.selector || item.skippedReason) {
      out[index] = item
      return
    }
    // Cover letter rows are owned by the cover-letter review flow in apex-bar.
    // Pass them through unchanged so the bar can attach later.
    if (item.source === "cover_letter") {
      out[index] = item
      return
    }
    const el = resolveFramePrefixedSelector(item.selector, doc)
    if (!el) {
      out[index] = { ...item, skippedReason: "Field disappeared from page — skipped." }
      return
    }
    // Recompute the actual safeKey at fill-time (so preview and apply stay aligned).
    const safeKey = classifyField(el as FormControlElement).safeKey
    if (!safeKey) {
      out[index] = { ...item, skippedReason: "Could not re-classify at fill time — skipped." }
      return
    }
    pending.push({ index, item, safeKey })
  })

  // ── Phase 1: RESUME FIRST ──────────────────────────────────────────────────
  // ATSes parse an attached resume and auto-populate the form from it
  // (SmartRecruiters "Easy Apply" literally says "autocomplete your
  // application"). Attaching AFTER filling let the parse OVERRIDE our values —
  // the "fills, then cleans again" bug. So: attach, wait for the parse to
  // settle, THEN write profile values over whatever the parser left.
  let attached = false
  for (const p of pending) {
    if (p.safeKey !== "resume_upload") continue
    if (!resumeBytes) {
      out[p.index] = {
        ...p.item,
        source: "manual_required",
        skippedReason: "No resume on file — upload one in Hireoven first.",
      }
      continue
    }
    const el = resolveFramePrefixedSelector(p.item.selector!, doc)
    if (el instanceof HTMLInputElement) {
      prepareResumeInputForSource(source, el, doc)
    }
    const ok = el ? injectResumeFile(el as HTMLInputElement, resumeBytes) : false
    if (ok) attached = true
    out[p.index] = ok
      ? { ...p.item, filled: true, source: "resume" }
      : { ...p.item, source: "manual_required", skippedReason: "Could not attach resume — attach it manually." }
  }
  // Wait for the resume parse to finish before filling — whether WE attached
  // the file (Ashby/Greenhouse/Lever) or the USER dropped their CV into the
  // ATS's own parse box (SmartRecruiters Easy Apply) just before clicking
  // Fill. Filling mid-parse loses the race: the parser repopulates the form
  // and clears our values. Skipped entirely when no parse is happening, so
  // fills stay fast on forms without a resume box.
  if (attached || resumeParseInFlight(doc)) await waitForResumeParseSettle(doc)

  // ── Phase 2: fill everything else into the post-parse form ───────────────
  for (const p of pending) {
    if (p.safeKey === "resume_upload") continue
    const { item } = p
    // Re-resolve — the resume parse may have re-rendered/replaced the node.
    const el = resolveFramePrefixedSelector(item.selector!, doc)
    if (!el) {
      out[p.index] = { ...item, skippedReason: "Field disappeared from page — skipped." }
      continue
    }

    let ok = false
    if (p.safeKey === "skills") {
      const skills = (item.fillValue ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
      ok = fillSkillTokens(el, skills)
    } else if (p.safeKey === "work_exp_current") {
      ok = item.fillValue === "true" ? setReactChecked(el, true) : true
    } else {
      let value = item.fillValue ?? null
      if (!value) {
        out[p.index] = { ...item, skippedReason: "Profile value missing at fill time — skipped." }
        continue
      }
      // Phone into a web-component intl phone widget (tel input inside a
      // shadow root, e.g. SmartRecruiters spl-phone-field): use the
      // INTERNATIONAL format. The widget infers the country from the "+"
      // prefix — which also restores a country-code selection the ATS's
      // resume parse erased. Verified live: bare "6055853783" → ng-invalid
      // with empty country; "+16055853783" → ng-valid, country resolved,
      // number reformatted by the widget itself. Plain light-DOM tel inputs
      // (Greenhouse/Ashby/Lever) keep the profile's own format.
      if (
        p.safeKey === "phone" &&
        ((el as HTMLInputElement).type ?? "").toLowerCase() === "tel" &&
        el.getRootNode() instanceof ShadowRoot &&
        !value.trim().startsWith("+")
      ) {
        value = toInternationalPhone(value, profile.country)
      }
      item.fillValue = value // carry the final value into the repair watchdog
      ok = setReactValue(el, value)
    }
    out[p.index] = ok
      ? { ...item, filled: true }
      : { ...item, skippedReason: "Could not set field value — fill it manually." }
    // Human-like pause between fields. Filling many inputs in the same tick is a
    // strong bot signal for anti-automation systems (DataDome on SmartRecruiters,
    // etc.) and gets the user IP-blocked. Jittered, not fixed, to look organic.
    if (ok) await humanDelay(90, 240)
  }

  return out.map((row, index) => row ?? preview[index])
}

/**
 * Convert a NANP (US/Canada) phone number to E.164 (+1XXXXXXXXXX). Only
 * prefixes when confident: 10-digit numbers (or 11 starting with 1) and the
 * profile country is US/Canada or unset. Everything else passes through.
 */
function toInternationalPhone(phone: string, country?: string | null): string {
  const digits = phone.replace(/\D/g, "")
  const key = (country ?? "").trim().toLowerCase()
  const isNanp = key === "" || /united states|\busa?\b|u\.s|canada|america/.test(key)
  if (!isNanp) return phone
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return phone
}

/**
 * True when the ATS is (or is about to be) parsing an attached resume:
 * a file input already holds a file, or the page shows a parse indicator
 * ("Analyzing resume…", "Processing your CV…"). Cheap — safe to call before
 * every fill.
 */
function resumeParseInFlight(doc: Document): boolean {
  const hasAttachedFile = queryAllDeep<HTMLInputElement>(doc, 'input[type="file"]')
    .some((input) => input.files != null && input.files.length > 0)
  if (hasAttachedFile) return true
  const text = doc.body?.textContent ?? ""
  return /\b(analyzing|parsing|processing|reading|uploading)\b[^.!?]{0,40}\b(resume|cv|application)\b/i.test(text)
}

/**
 * Wait for the ATS's resume-parse-and-populate cycle to finish: poll every
 * control's value and return once nothing has changed for ~2s (minimum 2.5s
 * total so a slow-starting parse isn't missed; hard cap 12s so a parser that
 * never runs can't stall the fill).
 */
async function waitForResumeParseSettle(doc: Document): Promise<void> {
  const snapshot = () =>
    queryAllDeep<FormControlElement>(doc, FORM_CONTROL_SELECTOR)
      .map((el) => ("value" in el ? String((el as HTMLInputElement).value ?? "") : ""))
      .join("")
  const start = Date.now()
  let last = snapshot()
  let lastChange = Date.now()
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 600))
    const elapsed = Date.now() - start
    if (elapsed > 12_000) return
    const current = snapshot()
    if (current !== last) {
      last = current
      lastChange = Date.now()
    } else if (elapsed > 2_500 && Date.now() - lastChange > 2_000) {
      return
    }
  }
}

/**
 * Ground-truth pass over result rows: a row marked "skipped" whose control
 * NOW holds a value (filled by the question tier under a different label, by
 * the ATS's own logic, or by the user) flips to filled with the real value.
 * Label-based reconciliation can't do this — tier-1 labels come from widget
 * attributes ("Salary in USD") while tier-2 labels come from the question
 * text ("What is your minimum expected pay?"). Sensitive rows are left
 * untouched so their values never surface in the panel.
 */
export function reconcileRowsWithDom(
  rows: AutofillFieldResult[],
  doc: Document = document,
): AutofillFieldResult[] {
  return rows.map((row) => {
    if (!row.skippedReason || !row.selector) return row
    if (/sensitive/i.test(row.skippedReason)) return row
    const el = resolveFramePrefixedSelector(row.selector, doc)
    if (!el) return row
    const tag = el.tagName.toLowerCase()
    const type = ((el as HTMLInputElement).type ?? "").toLowerCase()
    if (type === "file") return row
    let current = ""
    if (type === "checkbox" || type === "radio") {
      current = (el as HTMLInputElement).checked ? "Yes" : ""
    } else if (tag === "select") {
      const sel = el as HTMLSelectElement
      const opt = sel.options[sel.selectedIndex]
      current = (opt?.textContent ?? sel.value ?? "").replace(/\s+/g, " ").trim()
      if (/^(select|choose|--)/i.test(current)) current = ""
    } else {
      current = ((el as HTMLInputElement | HTMLTextAreaElement).value ?? "").trim()
    }
    if (!current) return row
    return { ...row, filled: true, skippedReason: undefined, valuePreview: current.slice(0, 80) }
  })
}

/**
 * Restore previously-filled fields that a SPA wiped after the fact.
 * SmartRecruiters' Lit components re-commit their (stale, empty) model over
 * the DOM on their own render schedule — ~20s after our fill in testing.
 * Resolves each row's selector fresh (survives node re-creation) and ONLY
 * refills when the field is currently EMPTY, so user edits are never clobbered.
 * Returns the number of fields repaired.
 */
export async function repairEmptyFills(
  rows: AutofillFieldResult[],
  doc: Document = document,
): Promise<number> {
  let repaired = 0
  for (const row of rows) {
    if (!row.filled || !row.selector || !row.fillValue) continue
    const el = resolveFramePrefixedSelector(row.selector, doc)
    if (!el) continue
    const tag = el.tagName.toLowerCase()
    const type = ((el as HTMLInputElement).type ?? "").toLowerCase()
    if (type === "file" || type === "checkbox" || type === "radio") continue
    const current =
      tag === "select"
        ? (el as HTMLSelectElement).value
        : ((el as HTMLInputElement | HTMLTextAreaElement).value ?? "")
    if (current.trim()) continue
    if (setReactValue(el, row.fillValue)) repaired += 1
  }
  return repaired
}

/** Randomized short delay (ms) to make automated input look human-paced. */
function humanDelay(min = 80, max = 220): Promise<void> {
  const ms = Math.round(min + Math.random() * Math.max(0, max - min))
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Attach a generated DOCX (resume or cover letter) to a file input via the
 * same DataTransfer pattern used by JobRight / FrogHire. Exported so apex-bar
 * can call it directly for the cover-letter Attach step.
 */
export function injectDocxFile(target: HTMLInputElement, bytes: ResumeBytes): boolean {
  return injectResumeFile(target, bytes)
}

function dispatchDropWithFile(target: HTMLElement, file: File): void {
  try {
    const dt = new DataTransfer()
    dt.items.add(file)
    for (const type of ["dragenter", "dragover", "drop"] as const) {
      let ev: Event & { dataTransfer?: DataTransfer }
      try {
        ev = new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }) as DragEvent & {
          dataTransfer?: DataTransfer
        }
      } catch {
        ev = new Event(type, { bubbles: true, cancelable: true, composed: true }) as Event & { dataTransfer?: DataTransfer }
      }
      if (!ev.dataTransfer) {
        try { Object.defineProperty(ev, "dataTransfer", { value: dt }) } catch { /* read-only */ }
      }
      target.dispatchEvent(ev)
    }
  } catch {
    // best-effort only
  }
}

function findDropzoneFor(input: HTMLInputElement): HTMLElement {
  const zone = input.closest<HTMLElement>(
    '[class*="dropzone" i],[class*="drop-zone" i],[class*="droparea" i],[class*="drag" i],' +
    '[class*="fileupload" i],[class*="file-upload" i],[class*="upload" i],[data-testid*="upload" i]',
  )
  if (zone) return zone
  // react-dropzone roots (Ashby) are a role="presentation" div wrapping the
  // hidden input. The drop MUST fire on that root (or the input itself) — the
  // field-entry row is an ANCESTOR of the dropzone, so a drop dispatched there
  // bubbles up and away and never reaches the handler.
  const presentation = input.closest<HTMLElement>('[role="presentation"]')
  return presentation ?? input.parentElement ?? input
}

function prepareResumeInputForSource(source: AutofillSource, target: HTMLInputElement, doc: Document): void {
  if (source !== "jazzhr") return
  try {
    const wrapper = target.closest<HTMLElement>("#resumator-resume-upload-wrapper")
    const isHidden = wrapper?.classList.contains("none") || target.offsetParent === null
    if (isHidden) {
      doc.querySelector<HTMLElement>("#resumator-choose-upload")?.click()
      wrapper?.classList.remove("none")
      wrapper?.removeAttribute("hidden")
      wrapper?.removeAttribute("aria-hidden")
    }
    target.removeAttribute("disabled")
  } catch {
    // Best-effort only; direct file injection may still work.
  }
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

    // composed:true so the events escape shadow roots — SmartRecruiters'
    // spl-dropzone keeps the file input INSIDE its shadow tree and listens on
    // (or above) the host.
    target.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
    target.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
    dispatchDropWithFile(findDropzoneFor(target), file)
    // Shadow-DOM dropzone (spl-dropzone): also fire the drop sequence on the
    // HOST element — closest() can't cross the boundary, so findDropzoneFor
    // never reaches it from the inner input.
    const rootNode = target.getRootNode()
    if (rootNode instanceof ShadowRoot && rootNode.host instanceof HTMLElement) {
      dispatchDropWithFile(rootNode.host, file)
    }

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
    // Focus first — some controlled forms (React/Remix) only run their onChange
    // reducer for the currently-focused field, and ignore writes otherwise.
    try { (el as HTMLElement).focus({ preventScroll: true }) } catch { /* best-effort */ }

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
    // Dispatch a real InputEvent — React's ChangeEventPlugin reads `_valueTracker`
    // on `input`; a bare Event works in most cases, but InputEvent is what trusted
    // typing produces and is accepted by stricter listeners.
    // composed:true lets the events cross shadow boundaries — web-component
    // forms (SmartRecruiters spl-*) listen at/above the host, and a
    // non-composed event dies at the shadow root. Harmless for light-DOM forms.
    const InputEventCtor = (globalThis as { InputEvent?: typeof InputEvent }).InputEvent
    const inputEvent = typeof InputEventCtor === "function"
      ? new InputEventCtor("input", { bubbles: true, composed: true, inputType: "insertText", data: value })
      : new Event("input", { bubbles: true, composed: true })
    el.dispatchEvent(inputEvent)
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
    if (opts?.blur !== false) {
      el.dispatchEvent(new Event("blur", { bubbles: true, composed: true }))
    }
    // Mirror the value onto the shadow host: Stencil/Angular wrappers
    // (spl-input) sync host.value → inner input, and some read it back.
    const rootNode = el.getRootNode()
    if (rootNode instanceof ShadowRoot && rootNode.host instanceof HTMLElement) {
      try {
        ;(rootNode.host as HTMLElement & { value?: string }).value = value
      } catch { /* readonly host prop — best-effort */ }
    }
    return true
  } catch {
    return false
  }
}

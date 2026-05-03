/**
 * Scout MVP — Safe-fields autofill detector for Greenhouse and Lever only.
 *
 * Hard constraints (do NOT relax without owner review):
 *   - Greenhouse + Lever only. Workday/iCIMS/etc. NOT supported in this MVP.
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
}

/** Per-field result returned from detection (preview) and from filling. */
export type AutofillFieldResult = {
  label: string
  selector?: string
  valuePreview?: string
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

interface SafeKeyRule {
  key: SafeKey
  /** Match anywhere in label/name/id/placeholder, lowercased. */
  patterns: RegExp[]
  /** When the input element type matches one of these (lowercased). */
  inputTypes?: string[]
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
]

// ── Form scoping per source ──────────────────────────────────────────────────

/**
 * Scope detection to the application form container so we don't hit unrelated
 * inputs on the page (search bars, newsletter, etc.). Returns the form root
 * element if found, or null when not on a supported application form.
 */
function findApplicationFormRoot(doc: Document, source: "greenhouse" | "lever"): HTMLElement | null {
  if (source === "greenhouse") {
    return (
      // job-boards.greenhouse.io
      doc.querySelector<HTMLElement>("form#application-form, form.application--form") ??
      // boards.greenhouse.io legacy
      doc.querySelector<HTMLElement>("#grnhse_app form, form[action*='boards']") ??
      doc.querySelector<HTMLElement>("form")
    )
  }
  // Lever
  return (
    doc.querySelector<HTMLElement>("form.application-form, form[action*='lever']") ??
    doc.querySelector<HTMLElement>("form")
  )
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

// ── Detection + classification ───────────────────────────────────────────────

interface DetectedField {
  el: HTMLInputElement | HTMLTextAreaElement
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

function classifyField(input: HTMLInputElement | HTMLTextAreaElement): DetectedField {
  const label = getFieldLabel(input)
  const inputType = (input as HTMLInputElement).type?.toLowerCase() ?? "text"
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
      if (rule.patterns.some((p) => p.test(haystack))) {
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

function profileValueFor(profile: SafeProfile, key: SafeKey): string | null {
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
  }
}

// ── Public: build preview from page + profile ────────────────────────────────

/**
 * Detect safe fields on the page and produce a preview list of what we WOULD
 * fill with the given profile. Does NOT mutate the DOM. The caller renders
 * this preview, then calls applySafeFills() with the same list to commit.
 */
export function buildAutofillPreview(
  source: "greenhouse" | "lever",
  profile: SafeProfile | null,
  doc: Document = document,
): AutofillFieldResult[] {
  const root = findApplicationFormRoot(doc, source)
  if (!root) return []

  const inputs = Array.from(
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea",
    ),
  )

  const results: AutofillFieldResult[] = []

  for (const input of inputs) {
    const f = classifyField(input)

    // Skip sensitive
    if (f.sensitive) {
      results.push({
        label: f.label,
        selector: f.selector,
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
        selector: f.selector,
        valuePreview: "Your primary resume",
        confidence: "high",
        source: "resume",
        filled: false,
      })
      continue
    }
    // Cover letter upload: detected here so scout-bar knows the selector.
    // The actual generate/review/attach flow runs in a separate phase after
    // the regular profile fill (see scout-bar's CoverLetter section), so
    // applySafeFills() must skip these rows. We surface them with
    // source: "cover_letter" as the signal.
    if (f.safeKey === "cover_letter_upload") {
      results.push({
        label: f.label,
        selector: f.selector,
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
        selector: f.selector,
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
        selector: f.selector,
        confidence: "needs_review",
        source: "manual_required",
        filled: false,
        skippedReason: "No saved autofill profile.",
      })
      continue
    }

    const value = profileValueFor(profile, f.safeKey)
    if (!value) {
      results.push({
        label: f.label,
        selector: f.selector,
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
      selector: f.selector,
      valuePreview: previewValue(f.safeKey, value),
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
  source: "greenhouse" | "lever",
  profile: SafeProfile,
  resumeBytes: ResumeBytes | null,
  doc: Document = document,
): Promise<AutofillFieldResult[]> {
  const preview = buildAutofillPreview(source, profile, doc)
  const out: AutofillFieldResult[] = []

  for (const item of preview) {
    if (!item.selector || item.skippedReason || !item.valuePreview) {
      out.push(item)
      continue
    }
    // Cover letter rows are owned by the cover-letter review flow in scout-bar.
    // Pass them through unchanged so the bar can attach later.
    if (item.source === "cover_letter") {
      out.push(item)
      continue
    }
    let el: HTMLElement | null = null
    try {
      el = doc.querySelector<HTMLElement>(item.selector)
    } catch {
      out.push({ ...item, skippedReason: "Invalid selector — skipped." })
      continue
    }
    if (!el) {
      out.push({ ...item, skippedReason: "Field disappeared from page — skipped." })
      continue
    }

    // Recompute the actual safeKey at fill-time (so the masked preview can't
    // diverge from what we end up writing).
    const safeKey = SAFE_KEY_RULES.find((rule) => {
      if (rule.inputTypes && el && el.tagName.toLowerCase() === "input") {
        const t = (el as HTMLInputElement).type?.toLowerCase() ?? "text"
        if (!rule.inputTypes.includes(t)) return false
      }
      return rule.patterns.some((p) =>
        [
          getFieldLabel(el!),
          el!.getAttribute("name") ?? "",
          el!.id,
          el!.getAttribute("placeholder") ?? "",
        ].some((s) => p.test(s)),
      )
    })?.key
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

    const value = profileValueFor(profile, safeKey)
    if (!value) {
      out.push({ ...item, skippedReason: "Profile value missing at fill time — skipped." })
      continue
    }

    const ok = setReactValue(el, value)
    out.push(ok
      ? { ...item, filled: true }
      : { ...item, skippedReason: "Could not set field value — fill it manually." },
    )
  }

  return out
}

/**
 * Attach a generated DOCX (resume or cover letter) to a file input via the
 * same DataTransfer pattern used by JobRight / FrogHire. Exported so scout-bar
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
    target.files = dt.files

    // Fire React-compatible events with native setter for files property
    target.dispatchEvent(new Event("input", { bubbles: true }))
    target.dispatchEvent(new Event("change", { bubbles: true }))
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set
    if (nativeSetter) nativeSetter.call(target, dt.files)
    target.dispatchEvent(new Event("input", { bubbles: true }))
    target.dispatchEvent(new Event("change", { bubbles: true }))

    // Verify the attach actually took (some forms re-validate and reject
    // synthetic file events — better to surface that than silently "succeed").
    return target.files !== null && target.files.length > 0
  } catch {
    return false
  }
}

/**
 * Set an input/textarea value in a way React's controlled-input synthetic
 * event system will accept. Mirrors the pattern in chrome-extension/src/content.ts.
 */
function setReactValue(el: HTMLElement, value: string): boolean {
  const tag = el.tagName.toLowerCase()
  try {
    if (tag === "textarea") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(el as HTMLTextAreaElement, value)
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
    el.dispatchEvent(new Event("blur", { bubbles: true }))
    return true
  } catch {
    return false
  }
}

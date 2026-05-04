/**
 * Application-form detector.
 *
 * Pure detection — never fills, clicks, uploads, or mutates the DOM.
 *
 * Used by the Scout Bar to:
 *   1. Decide whether the current page hosts a real application form (vs. a
 *      job description page or a careers landing page).
 *   2. Tell the user whether autofill is fully supported, partial, or not
 *      available on this ATS.
 *   3. Surface the list of detected fields (label / type / required) for
 *      review *before* the user enables autofill.
 *
 * The MVP autofill is wired only for Greenhouse + Lever; this detector
 * intentionally also recognizes other ATSes (Workday, Ashby, etc.) so the
 * bar can say "form detected — autofill not supported here yet" instead of
 * silently going dark.
 */

import { detectSite, type SupportedSite } from "./site"

export type ApplicationFormDetection = {
  hasForm: boolean
  formCount: number
  detectedAts: SupportedSite
  fields: Array<{
    label: string
    name?: string
    type?: string
    required: boolean
    selector?: string
    confidence: "high" | "medium" | "low"
  }>
  supportsAutofill: boolean
  reasons: string[]
}

// ── Form-root detection ──────────────────────────────────────────────────────

/**
 * ATS-specific form selectors we trust as "this is an application form".
 * Order matters: the most specific selector for each ATS goes first.
 */
const ATS_FORM_SELECTORS: ReadonlyArray<string> = [
  // Greenhouse
  "form#application-form",
  "form.application--form",
  // Lever
  "form.application-form",
  // Ashby
  "form[action*='ashby']",
  "form[action*='jobs.ashbyhq']",
  // Workday
  "form[action*='workday']",
  "form[action*='myworkday']",
  // Generic ATS hints
  "form[action*='greenhouse']",
  "form[action*='lever']",
  "form[action*='boards']",
]

/**
 * Class/id hints for forms that aren't matched by a strict ATS selector but
 * still look like an application form. Conservative: we'd rather miss a
 * non-standard form than claim a newsletter signup is an application.
 */
const FORM_HINT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bapplication[-_\s]?form\b/i,
  /\bapply[-_\s]?form\b/i,
  /\bcareers?[-_\s]?form\b/i,
  /\bjob[-_\s]?application\b/i,
]

const RESUME_LABEL_RE = /\bresume\b|\bcv\b/i
const COVER_LETTER_LABEL_RE = /\bcover[\s_-]?letter\b/i

const SAFE_PROFILE_FIELD_RE =
  /\b(first[\s_-]?name|last[\s_-]?name|full[\s_-]?name|email|phone|tel|mobile|linkedin|github|portfolio|website|location|city|address)\b/i

function findFormRoots(doc: Document): HTMLFormElement[] {
  const seen = new Set<HTMLFormElement>()

  // 1. ATS-specific selectors — strongest signal.
  for (const sel of ATS_FORM_SELECTORS) {
    doc.querySelectorAll<HTMLFormElement>(sel).forEach((f) => seen.add(f))
  }

  // 2. Otherwise: any <form> whose id/class/action hints at an application form,
  //    or that looks structurally like one (file input + at least 2 text inputs).
  if (seen.size === 0) {
    doc.querySelectorAll<HTMLFormElement>("form").forEach((f) => {
      const id = f.id ?? ""
      const cls = f.className ?? ""
      const action = f.getAttribute("action") ?? ""
      const hayStack = `${id} ${cls} ${action}`
      if (FORM_HINT_PATTERNS.some((re) => re.test(hayStack))) {
        seen.add(f)
        return
      }
      const hasFileInput = !!f.querySelector("input[type=file]")
      const textCount = f.querySelectorAll(
        "input[type=text], input[type=email], input[type=tel], input[type=url], textarea",
      ).length
      if (hasFileInput && textCount >= 2) seen.add(f)
    })
  }

  return [...seen]
}

// ── Label resolution ─────────────────────────────────────────────────────────

function getFieldLabel(input: HTMLElement): string {
  const id = input.id
  if (id) {
    const lbl = input.ownerDocument.querySelector<HTMLLabelElement>(
      `label[for="${CSS.escape(id)}"]`,
    )
    if (lbl?.textContent?.trim()) return lbl.textContent.trim()
  }
  const wrapping = input.closest("label")
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim()
  const ancestor = input.closest(".application-question, .field, .input-wrapper, .field-wrapper")
  if (ancestor) {
    const lbl = ancestor.querySelector("label, .label, [class*='label']")
    if (lbl?.textContent?.trim()) return lbl.textContent.trim()
  }
  const aria = input.getAttribute("aria-label")
  if (aria?.trim()) return aria.trim()
  const ariaby = input.getAttribute("aria-labelledby")
  if (ariaby) {
    const el = input.ownerDocument.getElementById(ariaby)
    if (el?.textContent?.trim()) return el.textContent.trim()
  }
  const ph = input.getAttribute("placeholder")
  if (ph?.trim()) return ph.trim()
  return input.getAttribute("name") ?? input.id ?? "Unlabelled field"
}

/**
 * Confidence in the *label-to-input association*:
 *   - high    when a real <label for=…> or wrapping <label> ties text to input
 *   - medium  when only aria-label / aria-labelledby / placeholder is present
 *   - low     when the only signal is the input's name/id attribute
 */
function classifyConfidence(input: HTMLElement, label: string): "high" | "medium" | "low" {
  const id = input.id
  if (id) {
    const linked = input.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)
    if (linked?.textContent?.trim()) return "high"
  }
  if (input.closest("label")?.textContent?.trim()) return "high"
  if (input.getAttribute("aria-label")?.trim()) return "medium"
  if (input.getAttribute("aria-labelledby")) return "medium"
  if (input.getAttribute("placeholder")?.trim()) return "medium"
  return label && label !== "Unlabelled field" ? "low" : "low"
}

function buildSelector(input: HTMLElement): string {
  if (input.id) return `#${CSS.escape(input.id)}`
  const name = input.getAttribute("name")
  if (name) return `${input.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`
  return input.tagName.toLowerCase()
}

function isFieldRequired(el: HTMLElement): boolean {
  if (el.hasAttribute("required")) return true
  if (el.getAttribute("aria-required") === "true") return true
  // Greenhouse / Lever mark the wrapper, not the input itself.
  const wrapper = el.closest(
    ".required, .application-question--required, [aria-required='true'], [data-required='true']",
  )
  if (wrapper) return true
  // Some forms append " *" to the visible label.
  const id = el.id
  if (id) {
    const lbl = el.ownerDocument.querySelector<HTMLLabelElement>(
      `label[for="${CSS.escape(id)}"]`,
    )
    if (lbl?.textContent?.includes("*")) return true
  }
  return false
}

// ── Public detector ──────────────────────────────────────────────────────────

/**
 * Detects whether a LinkedIn Easy Apply modal is currently open. Only the
 * modal counts — the inert "Easy Apply" button on a normal job page does
 * NOT qualify as an application form for autofill purposes.
 *
 * LinkedIn renders the modal under one of these top-level shells when open:
 *   - `.jobs-easy-apply-modal`            (current)
 *   - `[data-test-modal-id^="easy-apply-modal"]`
 *   - `.artdeco-modal-overlay` containing an `[aria-label*="Easy Apply"]`
 */
export function detectLinkedInEasyApplyModal(doc: Document = document): boolean {
  if (doc.querySelector(".jobs-easy-apply-modal")) return true
  if (doc.querySelector("[data-test-modal-id^='easy-apply-modal']")) return true
  if (doc.querySelector("[aria-labelledby*='easy-apply']")) return true
  // Fallback: an open artdeco-modal whose label mentions Easy Apply.
  const modal = doc.querySelector<HTMLElement>(".artdeco-modal[aria-label*='Easy Apply' i], [aria-label*='Easy Apply' i].artdeco-modal")
  return Boolean(modal)
}

/**
 * Pure detection — examines the page and reports what was found. Never
 * touches values, never dispatches events. Safe to call repeatedly (e.g.
 * on every URL change in an SPA).
 */
export function detectApplicationForm(doc: Document = document): ApplicationFormDetection {
  const ats = detectSite()
  const reasons: string[] = []

  const forms = findFormRoots(doc)
  if (forms.length === 0) {
    reasons.push("No application form element found on the page.")
    return {
      hasForm: false,
      formCount: 0,
      detectedAts: ats,
      fields: [],
      supportsAutofill: false,
      reasons,
    }
  }

  type Field = ApplicationFormDetection["fields"][number]
  const fields: Field[] = []
  const seenInputs = new Set<Element>()
  let resumeUpload = false
  let coverLetterUpload = false

  for (const form of forms) {
    const inputs = form.querySelectorAll<HTMLElement>(
      // Real input surface only — exclude hidden/submit/button/reset.
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea",
    )
    for (const el of inputs) {
      if (seenInputs.has(el)) continue
      seenInputs.add(el)

      const tag = el.tagName.toLowerCase()
      const type =
        tag === "input"
          ? ((el as HTMLInputElement).type ?? "text").toLowerCase()
          : tag

      const label = getFieldLabel(el)
      const name = el.getAttribute("name") ?? undefined
      const required = isFieldRequired(el)

      fields.push({
        label,
        name,
        type,
        required,
        selector: buildSelector(el),
        confidence: classifyConfidence(el, label),
      })

      // File-input semantic detection (resume vs. cover letter).
      if (type === "file") {
        const haystack = `${label} ${name ?? ""} ${el.id} ${el.getAttribute("placeholder") ?? ""}`
        if (RESUME_LABEL_RE.test(haystack))       resumeUpload = true
        if (COVER_LETTER_LABEL_RE.test(haystack)) coverLetterUpload = true
      }
    }
  }

  if (resumeUpload)      reasons.push("Resume upload field detected.")
  if (coverLetterUpload) reasons.push("Cover letter upload field detected.")

  // Heuristic: autofill is "supported" only when the ATS is one we've actually
  // wired (Greenhouse / Lever) AND we see at least 2 profile-fillable fields
  // (so a contact form with a single email box doesn't qualify).
  const safeFieldCount = fields.filter((f) =>
    SAFE_PROFILE_FIELD_RE.test(`${f.label} ${f.name ?? ""}`),
  ).length

  const atsIsWired = ats === "greenhouse" || ats === "lever"
  const supportsAutofill = atsIsWired && safeFieldCount >= 2

  if (!atsIsWired) {
    reasons.push(
      ats === "unknown"
        ? "ATS not recognized — autofill is supported only on Greenhouse and Lever."
        : `Autofill not yet wired for ${ats} in this MVP.`,
    )
  } else if (safeFieldCount < 2) {
    reasons.push("Form detected but profile-fillable fields are limited — autofill may be partial.")
  }

  return {
    hasForm: true,
    formCount: forms.length,
    detectedAts: ats,
    fields,
    supportsAutofill,
    reasons,
  }
}

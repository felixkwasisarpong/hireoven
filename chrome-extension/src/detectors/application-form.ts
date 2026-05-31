/**
 * Application-form detector.
 *
 * Pure detection — never fills, clicks, uploads, or mutates the DOM.
 *
 * Used by the Apex Bar to:
 *   1. Decide whether the current page hosts a real application form (vs. a
 *      job description page or a careers landing page).
 *   2. Tell the user whether autofill is fully supported, partial, or not
 *      available on this ATS.
 *   3. Surface the list of detected fields (label / type / required) for
 *      review *before* the user enables autofill.
 *
 * The detector recognizes application forms across ATSes and reports whether
 * profile-driven autofill is likely to work on this page.
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
  "form[data-automation-id]",
  "[data-automation-id='applicationSummaryStep']",
  "[data-automation-id='applyStep']",
  "[data-automation-id='applyFlow']",
  "[data-automation-id='applicationStep']",
  "[data-automation-id='stepContent']",
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

const WORKDAY_QUESTION_PLACEHOLDER_RE = /^(select one|select|choose one|choose|please select)$/i

function hasApplicationLikeInputs(root: Element, ats: SupportedSite): boolean {
  const candidates = root.querySelectorAll(
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea",
  )
  if (candidates.length >= 4) return true
  const textLike = root.querySelectorAll(
    "input[type=text], input[type=email], input[type=tel], input[type=url], textarea",
  ).length
  const hasFile = Boolean(root.querySelector("input[type=file]"))
  // Workday's first "Autofill with Resume" step often exposes only a file
  // picker before any text fields. Treat that as a valid application step.
  if (ats === "workday" && hasFile) return true
  return hasFile && textLike >= 2
}

function findFormRoots(doc: Document, ats: SupportedSite): HTMLElement[] {
  const seen = new Set<HTMLElement>()

  // 1. ATS-specific selectors — strongest signal.
  for (const sel of ATS_FORM_SELECTORS) {
    doc.querySelectorAll<HTMLElement>(sel).forEach((root) => {
      if (hasApplicationLikeInputs(root, ats)) seen.add(root)
    })
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

  // 3. Workday frequently renders application steps without a <form> wrapper.
  //    If ATS selectors above missed, use a conservative density fallback.
  if (seen.size === 0) {
    const denseRoots = Array.from(
      doc.querySelectorAll<HTMLElement>(
        "main section, main article, [role='main'] section, [role='main'] article, [data-automation-id]",
      ),
    )
      .filter((root) => hasApplicationLikeInputs(root, ats))
      .sort((a, b) => b.querySelectorAll("input, select, textarea").length - a.querySelectorAll("input, select, textarea").length)

    if (denseRoots.length > 0) {
      seen.add(denseRoots[0])
    }
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

function normalizeLabelText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s*\*\s*$/g, "")
    .trim()
}

function getWorkdayComboboxLabel(node: HTMLElement): string {
  const container = node.closest<HTMLElement>("[data-automation-id*='formField']")
  if (!container) return getFieldLabel(node)

  const explicit = container.querySelector<HTMLElement>(
    ":scope > label, :scope > legend, :scope > [data-automation-id*='label'], :scope > [role='heading'], :scope > h1, :scope > h2, :scope > h3, :scope > h4",
  )
  if (explicit?.textContent?.trim()) {
    return normalizeLabelText(explicit.textContent)
  }

  const chunks = Array.from(
    container.querySelectorAll<HTMLElement>("label, legend, [role='heading'], h1, h2, h3, h4, p, span, div"),
  )
    .filter((el) => !el.closest("[role='combobox']"))
    .map((el) => normalizeLabelText(el.textContent ?? ""))
    .filter((text) =>
      text.length > 6 &&
      !WORKDAY_QUESTION_PLACEHOLDER_RE.test(text) &&
      !/^\*?\s*indicates?\s+a\s+required\s+field\b/i.test(text),
    )
    .sort((a, b) => b.length - a.length)

  if (chunks.length > 0) return chunks[0]
  return getFieldLabel(node)
}

function classifyWorkdayComboboxConfidence(node: HTMLElement): "high" | "medium" | "low" {
  const container = node.closest<HTMLElement>("[data-automation-id*='formField']")
  if (container?.querySelector(":scope > label, :scope > legend, :scope > [data-automation-id*='label']")) {
    return "high"
  }
  if (node.getAttribute("aria-label")?.trim() || node.getAttribute("aria-labelledby")) {
    return "medium"
  }
  return "low"
}

function isWorkdayComboboxRequired(node: HTMLElement): boolean {
  if (node.getAttribute("aria-required") === "true") return true
  if (node.hasAttribute("required")) return true
  const container = node.closest<HTMLElement>("[data-automation-id*='formField']")
  if (!container) return false
  if (container.getAttribute("aria-required") === "true") return true
  if (container.hasAttribute("required")) return true
  const text = container.textContent ?? ""
  return /(\*+\s*)$/.test(text.trim()) || /\brequired\b/i.test(container.getAttribute("class") ?? "")
}

function buildWorkdayComboboxSelector(node: HTMLElement): string {
  const ownAutomation = node.getAttribute("data-automation-id")
  if (ownAutomation) {
    return `[data-automation-id="${CSS.escape(ownAutomation)}"]`
  }
  const containerAutomation = node.closest<HTMLElement>("[data-automation-id]")?.getAttribute("data-automation-id")
  if (containerAutomation) {
    return `[data-automation-id="${CSS.escape(containerAutomation)}"] [role="combobox"]`
  }
  return buildSelector(node)
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

  const forms = findFormRoots(doc, ats)
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

    // Workday question steps frequently use custom combobox widgets instead
    // of native <select>. Include them in read-only detection so the user
    // sees the real question fields rather than only hidden text inputs.
    if (ats === "workday") {
      const comboboxes = form.querySelectorAll<HTMLElement>(
        "[data-automation-id*='formField'] [role='combobox'], [data-automation-id*='formField'] [aria-haspopup='listbox']",
      )
      for (const box of comboboxes) {
        if (seenInputs.has(box)) continue
        seenInputs.add(box)
        const label = getWorkdayComboboxLabel(box)
        fields.push({
          label,
          name: box.getAttribute("name") ?? undefined,
          type: "combobox",
          required: isFieldRequired(box) || isWorkdayComboboxRequired(box),
          selector: buildWorkdayComboboxSelector(box),
          confidence: classifyWorkdayComboboxConfidence(box),
        })
      }
    }
  }

  if (resumeUpload)      reasons.push("Resume upload field detected.")
  if (coverLetterUpload) reasons.push("Cover letter upload field detected.")

  // Heuristic: autofill is "supported" when we detect at least 2 profile-
  // fillable fields. Workday is a special case because its step surfaces can
  // intentionally expose fewer native controls while still being fillable by
  // the dedicated runner.
  const safeFieldCount = fields.filter((f) =>
    SAFE_PROFILE_FIELD_RE.test(`${f.label} ${f.name ?? ""}`),
  ).length

  const supportsAutofill = ats === "workday" ? true : safeFieldCount >= 2

  if (ats !== "workday" && safeFieldCount < 2) {
    reasons.push("Form detected but profile-fillable fields are limited — autofill may be partial.")
  } else if (ats === "workday") {
    reasons.push("Workday step detected — Autofill uses step-aware runner (question dropdowns included).")
  } else if (ats === "unknown") {
    reasons.push("Application form detected on a non-standard ATS host — using generic autofill strategy.")
  } else {
    reasons.push(`Application form detected on ${ats} — using ATS-aware autofill strategy.`)
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

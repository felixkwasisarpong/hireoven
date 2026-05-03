/**
 * Application-confirmation detector.
 *
 * Runs after the user submits an application manually. Detects whether the
 * current page is a "thanks for applying" / submitted-successfully screen so
 * the Scout Bar can prompt the user to save proof.
 *
 * Pure detection — never submits, never mutates. Safe to call on every URL
 * change or DOM tick.
 *
 * Heuristic stack (any one match → confirmed):
 *   1. URL pattern  — /thank-you, /confirmation, /submitted, /success, plus
 *      ATS-specific query params (Greenhouse application_complete, Lever
 *      thank-you).
 *   2. ATS DOM hook — Greenhouse `.application-confirmation`, Lever
 *      `.completed-section`, etc. Strongest signal when present.
 *   3. Visible text — common confirmation phrases scanned in headings, main
 *      content, and aria-live regions.
 *
 * Returns a structured result so callers can decide how confident to be.
 */

import { detectSite, type SupportedSite } from "./site"

export type ConfirmationDetection = {
  isConfirmation: boolean
  confirmationText: string
  ats: SupportedSite
  signals: string[]
  /** Confidence in the detection — drives whether the bar auto-prompts. */
  confidence: "high" | "medium" | "low"
}

// ── URL patterns ─────────────────────────────────────────────────────────────

/** Generic post-submit URL patterns common across ATSes and careers sites. */
const URL_PATTERNS: ReadonlyArray<RegExp> = [
  /\/thank[-_]?you(?:\b|\/|$)/i,
  /\/confirmation(?:\b|\/|$)/i,
  /\/submitted(?:\b|\/|$)/i,
  /\/success(?:\b|\/|$)/i,
  /\/applied(?:\b|\/|$)/i,
  /\/application[-_]?(?:complete|submitted|received)\b/i,
]

/** ATS-specific query/path signals. */
const URL_PATTERNS_ATS: ReadonlyArray<RegExp> = [
  /[?&]application_complete=true\b/i,    // Greenhouse — common post-submit redirect
  /[?&]submitted=true\b/i,
  /\/apply\/?\?\b.*\bthank[-_]?you\b/i,   // Lever — `?thank-you` style
]

// ── Visible-text patterns ────────────────────────────────────────────────────

/** Phrases the user would actually see on a successful submission page. */
const TEXT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bapplication\s+(?:was\s+)?submitted\b/i,
  /\bthank(?:s|\s*you)\s+for\s+applying\b/i,
  /\byour\s+application\s+has\s+been\s+(?:received|submitted)\b/i,
  /\bsuccessfully\s+(?:submitted|applied)\b/i,
  /\bwe(?:'ve| have)\s+received\s+your\s+application\b/i,
  /\byour\s+application\s+is\s+(?:complete|in)\b/i,
  /\bapplication\s+complete\b/i,
]

// ── ATS-specific DOM hooks ───────────────────────────────────────────────────

/** Strong signal when present — these classes are emitted by the ATS itself. */
const ATS_SELECTORS: ReadonlyArray<{ ats: SupportedSite; selector: string }> = [
  { ats: "greenhouse", selector: ".application-confirmation" },
  { ats: "greenhouse", selector: ".confirmation-message" },
  { ats: "greenhouse", selector: "#application_confirmation" },
  { ats: "lever",      selector: ".completed-section" },
  { ats: "lever",      selector: ".application-completed" },
  { ats: "lever",      selector: ".posting-thank-you" },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pull short, user-visible text that's likely the confirmation message. We
 * prefer headings / aria-live regions / ATS-specific containers; fall back to
 * a trimmed snippet of body text. Capped at 400 chars so we never persist
 * arbitrarily large blobs.
 */
function extractConfirmationText(doc: Document, atsContainer: Element | null): string {
  const candidates: string[] = []

  if (atsContainer) {
    const text = atsContainer.textContent?.trim()
    if (text) candidates.push(text)
  }

  const ariaLive = doc.querySelector<HTMLElement>("[role='status'], [aria-live='polite'], [aria-live='assertive']")
  if (ariaLive?.textContent?.trim()) candidates.push(ariaLive.textContent.trim())

  // Headings on a confirmation page tend to be the confirmation itself.
  for (const sel of ["h1", "h2", "main h1, main h2"]) {
    const el = doc.querySelector<HTMLElement>(sel)
    const text = el?.textContent?.trim()
    if (text && /apply|applic|submit|thank|received|success/i.test(text)) {
      candidates.push(text)
      break
    }
  }

  if (candidates.length === 0) {
    // Last resort: scan main content for a matching paragraph.
    const main = doc.querySelector<HTMLElement>("main") ?? doc.body
    const paragraphs = main?.querySelectorAll<HTMLElement>("p, div") ?? []
    for (const p of paragraphs) {
      const text = p.textContent?.trim() ?? ""
      if (text.length > 0 && text.length < 400 && TEXT_PATTERNS.some((re) => re.test(text))) {
        candidates.push(text)
        break
      }
    }
  }

  const picked = candidates.find((t) => t.length > 0) ?? ""
  return picked.replace(/\s+/g, " ").slice(0, 400)
}

// ── Public API ───────────────────────────────────────────────────────────────

export function detectConfirmation(doc: Document = document): ConfirmationDetection {
  const ats = detectSite()
  const url = doc.location?.href ?? location.href
  const signals: string[] = []

  // 1. URL match — cheapest signal, do it first.
  const urlMatch = URL_PATTERNS.some((re) => re.test(url))
  const urlAtsMatch = URL_PATTERNS_ATS.some((re) => re.test(url))
  if (urlMatch)    signals.push("url-pattern")
  if (urlAtsMatch) signals.push("url-pattern-ats")

  // 2. ATS-specific DOM hook — strongest signal.
  let atsContainer: Element | null = null
  for (const { selector } of ATS_SELECTORS) {
    const el = doc.querySelector(selector)
    if (el) {
      atsContainer = el
      signals.push(`ats-dom:${selector}`)
      break
    }
  }

  // 3. Visible text — only scan if no ATS hook (cheap-by-default).
  let textMatched = false
  if (!atsContainer) {
    // Limit the scan to body innerText (capped) to avoid pathologies on huge
    // SPAs. innerText already filters out hidden subtrees.
    const bodyText = (doc.body?.innerText ?? "").slice(0, 5000)
    if (bodyText && TEXT_PATTERNS.some((re) => re.test(bodyText))) {
      signals.push("visible-text")
      textMatched = true
    }
  }

  const confirmationText = extractConfirmationText(doc, atsContainer)

  // Confidence model:
  //   high   — ATS-specific DOM hook OR (URL + visible text)
  //   medium — URL pattern alone OR visible text alone (with confirmation text)
  //   low    — no signals (caller should treat as "not confirmed")
  let confidence: ConfirmationDetection["confidence"] = "low"
  let isConfirmation = false
  if (atsContainer) {
    isConfirmation = true
    confidence = "high"
  } else if ((urlMatch || urlAtsMatch) && textMatched) {
    isConfirmation = true
    confidence = "high"
  } else if (urlMatch || urlAtsMatch) {
    isConfirmation = true
    confidence = "medium"
  } else if (textMatched && confirmationText) {
    isConfirmation = true
    confidence = "medium"
  }

  return {
    isConfirmation,
    confirmationText,
    ats,
    signals,
    confidence,
  }
}

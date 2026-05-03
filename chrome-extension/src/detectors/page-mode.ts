/**
 * Extension page-mode detector.
 *
 * Splits the world the extension operates in into two distinct modes so the
 * Scout Bar can wear the right hat:
 *
 *   1. Job-board overlay mode  — LinkedIn / Indeed / Glassdoor / Handshake.
 *      These are discovery surfaces. The user can't reliably submit from
 *      here (the apply often hops to another site), so the extension acts
 *      like a Froghire-style intelligence overlay: match score, sponsorship
 *      signal, ghost-job risk, etc. — all sourced from extracted data or
 *      backend analysis. Autofill is hidden.
 *
 *   2. ATS / application mode  — Greenhouse / Lever / Ashby / Workday /
 *      iCIMS / SmartRecruiters. These host the real application form, so
 *      autofill is the relevant primitive. Scout panel still works on
 *      ATS job-detail pages even before the user reaches the form.
 *
 * Pure detection — never fills, clicks, navigates, or mutates the DOM.
 */

import { detectSite, isProbablyJobPage, type SupportedSite } from "./site"

// ── Public types ─────────────────────────────────────────────────────────────

export type ExtensionPageMode =
  | "job_board_search"
  | "job_board_detail"
  | "ats_job_detail"
  | "ats_application_form"
  | "unknown"

// ── Site classification helpers ──────────────────────────────────────────────

/** Discovery surfaces — intelligence overlay, not autofill. */
const JOB_BOARD_SITES: ReadonlySet<SupportedSite> = new Set<SupportedSite>([
  "linkedin",
  "indeed",
  "glassdoor",
  "handshake",
])

/** ATS / application-form hosts — autofill candidates. */
const ATS_SITES: ReadonlySet<SupportedSite> = new Set<SupportedSite>([
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "icims",
  "smartrecruiters",
])

export function isJobBoardSite(site: SupportedSite): boolean {
  return JOB_BOARD_SITES.has(site)
}

export function isAtsSite(site: SupportedSite): boolean {
  return ATS_SITES.has(site)
}

/**
 * Job-board overlay (Froghire-style) is shown on:
 *   - any job_board_* page
 *   - ats_job_detail (the user is reading a JD on an ATS — useful pre-apply)
 * Hidden on application forms (we don't want to clutter the form), and on
 * unknown pages.
 */
export function shouldShowJobBoardOverlay(mode: ExtensionPageMode): boolean {
  return (
    mode === "job_board_search" ||
    mode === "job_board_detail" ||
    mode === "ats_job_detail"
  )
}

/**
 * Autofill UI (Autofill button, preview panel, cover-letter review) is only
 * relevant on the application-form page itself. Hidden everywhere else —
 * including on ATS job-detail pages where there's no form yet.
 */
export function shouldShowAutofillFeatures(mode: ExtensionPageMode): boolean {
  return mode === "ats_application_form"
}

// ── Internal: form presence check ────────────────────────────────────────────

/**
 * Cheap "is there an application form here?" probe. Cheaper than running the
 * full detectApplicationForm() — this only looks for the strongest ATS
 * selectors so we can decide between ats_job_detail and ats_application_form
 * during the synchronous mode detection.
 *
 * Callers that need the full field list should still use detectApplicationForm.
 */
const APPLICATION_FORM_SELECTORS: ReadonlyArray<string> = [
  // Greenhouse
  "form#application-form",
  "form.application--form",
  // Lever
  "form.application-form",
  // Ashby — embedded apply iframe / SPA form
  "form[action*='ashby']",
  "form[action*='jobs.ashbyhq']",
  // Workday — Workday's apply view is feature-flagged, but these match its
  // shadow-rendered shell when present.
  "form[action*='workday']",
  "form[action*='myworkday']",
  // iCIMS
  "form[action*='icims']",
  "form#applicationForm",
  // SmartRecruiters
  "form[action*='smartrecruiters']",
  "form.sr-application-form",
  // Generic ATS-action hints
  "form[action*='greenhouse']",
  "form[action*='lever']",
  "form[action*='boards']",
]

function pageHasApplicationForm(doc: Document): boolean {
  for (const sel of APPLICATION_FORM_SELECTORS) {
    if (doc.querySelector(sel)) return true
  }
  // Structural fallback: a <form> with a file input + ≥2 text-like inputs.
  // Conservative — catches custom application shells without false-positiving
  // newsletters or search bars.
  const forms = doc.querySelectorAll<HTMLFormElement>("form")
  for (const form of forms) {
    if (!form.querySelector("input[type=file]")) continue
    const textCount = form.querySelectorAll(
      "input[type=text], input[type=email], input[type=tel], input[type=url], textarea",
    ).length
    if (textCount >= 2) return true
  }
  return false
}

// ── URL-level page-kind detection ────────────────────────────────────────────

/**
 * For job-board sites, decide whether the URL indicates a search/list view
 * vs. a job detail. Falls through to "search" for ambiguous job-board URLs
 * — those tend to be recommendation feeds, saved searches, etc., not detail.
 */
function classifyJobBoardUrl(site: SupportedSite, url: URL): "search" | "detail" {
  const path = url.pathname.toLowerCase()
  const params = url.searchParams

  if (site === "linkedin") {
    // /jobs/view/<id>  → standalone detail
    // /jobs/search… or /jobs/collections… with ?currentJobId  → list with side pane
    // Treat side-pane as detail (the user is reading one job).
    if (/^\/jobs\/view\//.test(path)) return "detail"
    if (params.has("currentJobId")) return "detail"
    if (/^\/jobs(\/|$)/.test(path)) return "search"
    return "search"
  }

  if (site === "indeed") {
    if (/^\/viewjob/.test(path) || /^\/rc\/clk/.test(path) || /^\/pagead/.test(path)) return "detail"
    if (/^\/jobs/.test(path) || /^\/q-/.test(path) || /^\/m\/jobs/.test(path)) return "search"
    return "search"
  }

  if (site === "glassdoor") {
    if (/^\/job-listing\//.test(path) || params.has("jl")) return "detail"
    if (/^\/Job\//.test(path) || /^\/Search\//.test(path)) return "search"
    return "search"
  }

  if (site === "handshake") {
    // joinhandshake.com/stu/jobs/<id>  → detail; /stu/jobs (no id) or /jobs → search
    if (/^\/(?:[a-z]{2,4}\/)?jobs\/\d+/.test(path)) return "detail"
    if (/^\/(?:[a-z]{2,4}\/)?jobs(\/|$)/.test(path)) return "search"
    return "search"
  }

  return "search"
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Decide which mode the extension should operate in for the current page.
 *
 * - URL-only callers (`detectExtensionPageMode(url)`) get a coarse mode based
 *   on the URL alone. ATS sites without a `doc` always resolve to
 *   `ats_job_detail` (we can't see whether the form is rendered).
 * - DOM-aware callers (`detectExtensionPageMode(url, doc)`) get a refined
 *   mode that upgrades ATS job pages to `ats_application_form` when a real
 *   form is visible, and that sanity-checks job-board detail vs. search using
 *   the existing `isProbablyJobPage` heuristic.
 */
export function detectExtensionPageMode(
  url?: string,
  doc?: Document,
): ExtensionPageMode {
  const href = url ?? (typeof window !== "undefined" ? window.location.href : "")
  if (!href) return "unknown"

  let parsed: URL
  try {
    parsed = new URL(href)
  } catch {
    return "unknown"
  }

  const site = detectSite(href)

  if (isJobBoardSite(site)) {
    const kind = classifyJobBoardUrl(site, parsed)
    if (kind === "detail") return "job_board_detail"
    // Cross-check with isProbablyJobPage when DOM is available. If the URL
    // looks like a list but the page actually rendered a single job (e.g.
    // LinkedIn pushed a job to the side pane), prefer detail.
    if (doc && isProbablyJobPage(href, doc)) return "job_board_detail"
    return "job_board_search"
  }

  if (isAtsSite(site)) {
    // With DOM access, distinguish "we're reading a JD" from "the apply form
    // is rendered". Without DOM, default to JD; the bar will refresh once the
    // form mounts.
    if (doc && pageHasApplicationForm(doc)) return "ats_application_form"
    return "ats_job_detail"
  }

  return "unknown"
}

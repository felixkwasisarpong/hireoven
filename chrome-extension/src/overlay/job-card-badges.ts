/**
 * Hireoven Job-Card Badges — light intelligence overlay for job-board cards.
 *
 * Mounts on LinkedIn / Indeed / Glassdoor / Handshake search/list pages. For
 * each visible card, extracts a best-effort `JobCardExtract`, then injects a
 * tiny pill row showing match / sponsorship / ghost / matched skills when
 * backend analysis is available, or "Hireoven · Analyze · Save" placeholder
 * pills when it isn't.
 *
 * Hard rules:
 *   - Pure read on the host DOM until the user explicitly clicks an action.
 *   - No hardcoded badge values: every signal renders only if the analysis
 *     payload carries real evidence; otherwise we either show "Unknown" or
 *     hide the row.
 *   - No autofill UI on these pages.
 *   - Idempotent on SPA / infinite scroll: cards are stamped with
 *     `data-hireoven-processed="true"` so we never inject twice.
 */

import { analyzeExtractedJob, saveExtractedJob } from "../api-client"
import type { ExtensionJobAnalysis } from "../api-types"
import type { ExtractedJob } from "../extractors/scout-extractor"
import type { SupportedSite } from "../detectors/site"
import {
  registerCardForFiltering,
  updateCardAnalysis,
  unregisterCard,
} from "./job-screener"

// ── Public type ──────────────────────────────────────────────────────────────

export type JobCardExtract = {
  source: SupportedSite
  externalJobId?: string
  jobUrl?: string
  title?: string
  company?: string
  location?: string
  snippet?: string
  salaryText?: string
  postedAgeText?: string
  workModeText?: string
  confidence: "high" | "medium" | "low"
}

/**
 * Deterministic facts the extractor can read straight off a card without
 * any backend call. Used by the Screener Bar to apply filters before
 * analysis arrives, and by the badge row to surface obvious truths
 * (Salary listed, Remote, Promoted) immediately.
 */
export type JobCardFacts = {
  hasSalary: boolean
  isRemote: boolean
  isPromoted: boolean
  isViewed: boolean
  isStaffingAgency: boolean
  isEasyApply: boolean
  isActivelyReviewing: boolean
}

// ── Internal constants ───────────────────────────────────────────────────────

const PROCESSED_ATTR  = "data-hireoven-processed"
const CARD_KEY_ATTR   = "data-ho-card-key"
const ACTION_ATTR     = "data-ho-action"
const ROOT_CLASS      = "ho-card-badges"
const STYLE_ELEMENT_ID = "ho-card-badges-style"

const CARD_SELECTORS: Partial<Record<SupportedSite, string>> = {
  // LinkedIn — both authenticated search and public job-search shells.
  // Order is broadest-first so we still match when LinkedIn ships a new
  // class hash; specific class names act as fallbacks.
  linkedin: [
    "div[data-job-id]",
    "li[data-occludable-job-id]",
    "div[data-occludable-job-id]",
    "div.job-card-container",
    "li.jobs-search-results__list-item",
    "li.scaffold-layout__list-item",
    "li.base-card",
    "div.base-card",
    ".jobs-search-results-list__list-item",
    ".job-search-card",
  ].join(", "),

  // Indeed — `data-jk` is the most reliable signal across SerpJobCard variants
  indeed: [
    "div.job_seen_beacon",
    "div.cardOutline",
    "div[data-jk]",
    "td.resultContent",
  ].join(", "),

  // Glassdoor — modern + legacy class names
  glassdoor: [
    "li.JobsList_jobListItem__wjTHv",
    "li[data-test='jobListing']",
    "li.react-job-listing",
    "div.react-job-listing",
    "[id^='job-listing-']",
  ].join(", "),

  // Handshake — class names are hash-suffixed; rely on ARIA / data hooks first
  handshake: [
    "[data-hook='jobs-card']",
    "[data-hook='job-card']",
    "li[role='listitem'][class*='job']",
    "div[role='listitem'][class*='job']",
    "[class*='JobCard']",
  ].join(", "),
}

// ── Style injection (one-shot) ───────────────────────────────────────────────

const STYLE_RULES = `
  .${ROOT_CLASS} {
    display: flex !important;
    flex-wrap: wrap !important;
    justify-content: flex-end !important;
    gap: 3px !important;
    align-items: center !important;
    margin: 6px 12px 8px 12px !important;
    padding: 0 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    font-size: 10px !important;
    line-height: 1 !important;
    color: #0a0a0a !important;
    width: auto !important;
  }
  .${ROOT_CLASS} .ho-pill {
    display: inline-flex !important;
    align-items: center !important;
    gap: 3px !important;
    height: 18px !important;
    padding: 0 6px !important;
    border-radius: 9px !important;
    border: 1px solid rgba(15, 23, 42, 0.10) !important;
    background: transparent !important;
    color: #4a4a4a !important;
    font-size: 10px !important;
    font-weight: 500 !important;
    letter-spacing: 0 !important;
    cursor: default !important;
    white-space: nowrap !important;
    line-height: 1 !important;
  }
  .${ROOT_CLASS} .ho-pill-brand {
    background: transparent !important;
    color: #0a0a0a !important;
    border-color: rgba(15, 23, 42, 0.16) !important;
    font-weight: 600 !important;
  }
  .${ROOT_CLASS} .ho-pill-brand::before {
    content: "" !important;
    display: inline-block !important;
    width: 6px !important;
    height: 6px !important;
    border-radius: 50% !important;
    background: #FF5C18 !important;
    margin-right: 1px !important;
  }
  .${ROOT_CLASS} .ho-pill-action  { color: #0a0a0a !important; cursor: pointer !important; }
  .${ROOT_CLASS} .ho-pill-action:hover:not([disabled]) { background: rgba(15, 23, 42, 0.04) !important; border-color: rgba(15, 23, 42, 0.20) !important; }
  .${ROOT_CLASS} .ho-pill-action[disabled] { opacity: 0.4 !important; cursor: not-allowed !important; }
  .${ROOT_CLASS} .ho-pill-primary {
    color: #FF5C18 !important;
    border-color: rgba(255, 92, 24, 0.35) !important;
    background: transparent !important;
    cursor: pointer !important;
    font-weight: 600 !important;
  }
  .${ROOT_CLASS} .ho-pill-primary:hover:not([disabled]) {
    background: rgba(255, 92, 24, 0.06) !important;
    border-color: #FF5C18 !important;
  }
  .${ROOT_CLASS} .ho-pill-saved { color: #FF5C18 !important; border-color: rgba(255, 92, 24, 0.35) !important; font-weight: 600 !important; }
  .${ROOT_CLASS} .ho-pill-error { color: #b91c1c !important; border-color: rgba(220, 38, 38, 0.28) !important; }
  .${ROOT_CLASS} .ho-pill-match         { background: rgba(255, 92, 24, 0.06) !important; color: #c2410c !important; border-color: rgba(255, 92, 24, 0.22) !important; font-weight: 600 !important; }
  .${ROOT_CLASS} .ho-pill-spons-likely  { color: #15803d !important; border-color: rgba(34, 197, 94, 0.30) !important; }
  .${ROOT_CLASS} .ho-pill-spons-no      { color: #52525b !important; }
  .${ROOT_CLASS} .ho-pill-spons-unclear { color: #a16207 !important; border-color: rgba(250, 204, 21, 0.30) !important; }
  .${ROOT_CLASS} .ho-pill-ghost-low     { color: #15803d !important; border-color: rgba(34, 197, 94, 0.30) !important; }
  .${ROOT_CLASS} .ho-pill-ghost-medium  { color: #a16207 !important; border-color: rgba(250, 204, 21, 0.30) !important; }
  .${ROOT_CLASS} .ho-pill-ghost-high    { color: #b91c1c !important; border-color: rgba(220, 38, 38, 0.28) !important; }
  .${ROOT_CLASS} .ho-pill-skill         { color: #4a4a4a !important; }
  .${ROOT_CLASS} .ho-pill-signal        { color: #4a4a4a !important; }
  .${ROOT_CLASS} .ho-pill-salary        { color: #15803d !important; border-color: rgba(34, 197, 94, 0.30) !important; }
  .${ROOT_CLASS} .ho-pill-work          { color: #4a4a4a !important; }
  .${ROOT_CLASS} .ho-pill-info          { color: #0a0a0a !important; }
  .${ROOT_CLASS} .ho-pill-muted {
    color: #71717a !important;
    border-color: rgba(15, 23, 42, 0.08) !important;
  }
  .${ROOT_CLASS} .ho-pill-pending {
    color: #71717a !important;
    border-color: rgba(15, 23, 42, 0.10) !important;
    font-style: italic !important;
  }
`

function ensureStylesInjected(doc: Document): void {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return
  const style = doc.createElement("style")
  style.id = STYLE_ELEMENT_ID
  style.textContent = STYLE_RULES
  doc.head.appendChild(style)
}

// ── Card discovery ───────────────────────────────────────────────────────────

/**
 * Returns visible job cards on the page for the given site. Hidden / detached
 * cards are filtered out so we don't waste work on virtualized rows.
 *
 * Sites like LinkedIn nest a card-shaped <div> inside a card-shaped <li> and
 * both shapes match our selector list, so we'd badge each card twice without
 * deduping. Drop any match that contains another match — keep only the
 * innermost one.
 */
export function findJobCards(site: SupportedSite, doc: Document = document): HTMLElement[] {
  const selector = CARD_SELECTORS[site]
  if (!selector) return []
  const visible = Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(isVisible)
  if (visible.length < 2) return visible
  return visible.filter(
    (card) => !visible.some((other) => other !== card && card.contains(other)),
  )
}

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  if (el.offsetParent !== null) return true
  // offsetParent is null for fixed-position elements; double-check via rects.
  return el.getClientRects().length > 0
}

// ── Best-effort field extraction ─────────────────────────────────────────────

function readTextFromAny(card: HTMLElement, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const el = card.querySelector<HTMLElement>(sel)
    const text = el?.textContent?.trim()
    if (text) return text.replace(/\s+/g, " ")
  }
  return undefined
}

function readHrefFromAny(card: HTMLElement, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const el = card.querySelector<HTMLAnchorElement>(sel)
    const href = el?.href
    if (href) return href
  }
  return undefined
}

function jobIdFromUrl(url: string | undefined, site: SupportedSite): string | undefined {
  if (!url) return undefined
  let parsed: URL
  try { parsed = new URL(url, location.href) } catch { return undefined }
  if (site === "linkedin") {
    const m = parsed.pathname.match(/\/jobs\/view\/(\d+)/)
    if (m) return m[1]
    const cur = parsed.searchParams.get("currentJobId")
    if (cur) return cur
  }
  if (site === "indeed") {
    const jk = parsed.searchParams.get("jk")
    if (jk) return jk
  }
  if (site === "glassdoor") {
    const jl = parsed.searchParams.get("jl")
    if (jl) return jl
    const m = parsed.pathname.match(/JV_IC[\d_]+_KO[\d,]+_KE[\d,]+\.htm/)
    if (m) return m[0]
  }
  if (site === "handshake") {
    const m = parsed.pathname.match(/\/jobs\/(\d+)/)
    if (m) return m[1]
  }
  return undefined
}

export function extractJobCard(card: HTMLElement, site: SupportedSite): JobCardExtract {
  let title: string | undefined
  let company: string | undefined
  let location: string | undefined
  let snippet: string | undefined
  let salaryText: string | undefined
  let postedAgeText: string | undefined
  let workModeText: string | undefined
  let jobUrl: string | undefined
  let externalJobId: string | undefined

  if (site === "linkedin") {
    title = readTextFromAny(card, [
      ".job-card-list__title-link",
      ".job-card-list__title",
      ".base-search-card__title",
      "[class*='job-card-list__title']",
      "h3",
    ])
    company = readTextFromAny(card, [
      ".job-card-container__company-name",
      ".job-card-container__primary-description",
      ".artdeco-entity-lockup__subtitle",
      ".base-search-card__subtitle",
    ])
    location = readTextFromAny(card, [
      ".job-card-container__metadata-item",
      ".job-search-card__location",
      ".artdeco-entity-lockup__caption",
    ])
    postedAgeText = readTextFromAny(card, [
      "time",
      ".job-search-card__listdate",
      ".job-search-card__listdate--new",
    ])
    jobUrl = readHrefFromAny(card, [
      "a.job-card-list__title-link",
      "a.job-card-container__link",
      "a.base-card__full-link",
      "a[href*='/jobs/view/']",
      "a[href]",
    ])
    externalJobId =
      card.getAttribute("data-occludable-job-id") ??
      card.getAttribute("data-job-id") ??
      jobIdFromUrl(jobUrl, "linkedin")
  } else if (site === "indeed") {
    title = readTextFromAny(card, [
      "h2.jobTitle a span[title]",
      "h2.jobTitle a",
      "[data-testid='job-title']",
      "h2 a",
    ])
    company = readTextFromAny(card, [
      "[data-testid='company-name']",
      "span.companyName",
      ".company_location .companyName",
    ])
    location = readTextFromAny(card, [
      "[data-testid='text-location']",
      "div.companyLocation",
      ".company_location > div:nth-child(2)",
    ])
    snippet = readTextFromAny(card, [
      "[data-testid='job-snippet']",
      ".job-snippet",
      ".job-snippet-container",
    ])
    salaryText = readTextFromAny(card, [
      "[data-testid='attribute_snippet_testid']",
      ".salary-snippet",
      ".attribute_snippet",
    ])
    postedAgeText = readTextFromAny(card, [
      "[data-testid='myJobsStateDate']",
      "span.date",
      ".date",
    ])
    jobUrl = readHrefFromAny(card, [
      "h2.jobTitle a",
      "[data-testid='job-title-link']",
      "a[href*='viewjob']",
      "a[id^='job_']",
    ])
    if (jobUrl && !/^https?:/i.test(jobUrl)) {
      try { jobUrl = new URL(jobUrl, window.location.href).toString() } catch { /* leave relative */ }
    }
    externalJobId =
      card.getAttribute("data-jk") ??
      card.getAttribute("data-jobkey") ??
      jobIdFromUrl(jobUrl, "indeed")
  } else if (site === "glassdoor") {
    title = readTextFromAny(card, [
      "[data-test='job-title']",
      "a.JobCard_jobTitle",
      ".jobLink",
      "h3 a",
    ])
    company = readTextFromAny(card, [
      "[data-test='employer-name']",
      "[data-test='employerName']",
      ".employerName",
    ])
    location = readTextFromAny(card, [
      "[data-test='emp-location']",
      "[data-test='job-location']",
      ".location",
    ])
    salaryText = readTextFromAny(card, [
      "[data-test='detailSalary']",
      "[data-test='salary-estimate']",
      ".salaryText",
    ])
    postedAgeText = readTextFromAny(card, [
      "[data-test='job-age']",
      ".css-17n8uzg",
      ".listing-age",
    ])
    jobUrl = readHrefFromAny(card, [
      "a[data-test='job-link']",
      "a.JobCard_jobTitle",
      "a.jobLink",
      "a[href*='job-listing']",
    ])
    externalJobId =
      card.getAttribute("data-id") ??
      card.getAttribute("data-jobid") ??
      jobIdFromUrl(jobUrl, "glassdoor")
  } else if (site === "handshake") {
    title = readTextFromAny(card, [
      "[data-hook='job-title']",
      "h1, h2, h3",
      "[class*='Title']",
    ])
    company = readTextFromAny(card, [
      "[data-hook='job-employer-name']",
      "[class*='employerName']",
      "[class*='Employer']",
    ])
    location = readTextFromAny(card, [
      "[data-hook='job-location']",
      "[class*='location']",
      "[class*='Location']",
    ])
    jobUrl = readHrefFromAny(card, [
      "a[data-hook='job-card-link']",
      "a[href*='/jobs/']",
      "a[href]",
    ])
    externalJobId = jobIdFromUrl(jobUrl, "handshake")
  }

  // Confidence reflects how much primary data we recovered. We need at least
  // a title + URL to call the analyze/save endpoints reliably.
  let confidence: JobCardExtract["confidence"] = "low"
  const hits = [title, company, jobUrl].filter(Boolean).length
  if (hits === 3) confidence = "high"
  else if (hits >= 2) confidence = "medium"

  // Lightweight work-mode read from the card itself; the (Remote / Hybrid /
  // On-site) marker is usually right next to the location on every site.
  workModeText = inferWorkMode(card, location ?? "")

  return {
    source: site,
    title,
    company,
    location,
    snippet,
    salaryText,
    postedAgeText,
    workModeText,
    jobUrl,
    externalJobId,
    confidence,
  }
}

/**
 * Read deterministic facts off a card. Pure DOM read — no network.
 * Run once during extract and cached so the Screener Bar can filter
 * immediately, before any backend call resolves.
 */
export function extractJobCardFacts(card: HTMLElement, extract: JobCardExtract): JobCardFacts {
  const haystack = (
    `${extract.title ?? ""} ${extract.company ?? ""} ${extract.location ?? ""} ` +
    `${extract.snippet ?? ""} ${extract.salaryText ?? ""} ${extract.workModeText ?? ""} ` +
    (card.innerText ?? "").slice(0, 800)
  ).toLowerCase()

  return {
    hasSalary: !!extract.salaryText && /\$|usd|eur|gbp|salary|\bk\b/i.test(extract.salaryText),
    isRemote:  /\bremote\b|\bwork from home\b|\bwfh\b/.test(haystack) && !/\bon[-\s]?site only\b/.test(haystack),
    isPromoted: /\bpromoted\b/.test(haystack),
    isViewed:   /\bviewed\b/.test(haystack),
    isStaffingAgency: STAFFING_AGENCY_RE.test(extract.company ?? ""),
    isEasyApply: /\beasy\s+apply\b/i.test(haystack),
    isActivelyReviewing: /\bactively\s+(?:reviewing|recruiting|hiring)\b/i.test(haystack),
  }
}

const STAFFING_AGENCY_RE =
  /\b(staffing|talent\s+(?:partners?|solutions?|group)|recruiting|recruitment|consulting\s+group|consultants?|search\s+(?:partners?|firm|group)|placement|outsourc(?:ing|e)|managed\s+services|capgemini|infosys|tcs|wipro|cognizant|accenture)\b/i

function inferWorkMode(card: HTMLElement, locationText: string): string | undefined {
  const blob = (locationText + " " + (card.innerText ?? "").slice(0, 400)).toLowerCase()
  if (/\bremote\b|\bwork from home\b|\bwfh\b/.test(blob)) return "Remote"
  if (/\bhybrid\b/.test(blob)) return "Hybrid"
  if (/\bon[-\s]?site\b|\bin[-\s]?office\b/.test(blob)) return "On-site"
  return undefined
}

// ── Badge injection ──────────────────────────────────────────────────────────

/**
 * Render (or refresh) the badge row inside `card`. Idempotent — re-call to
 * update with new analysis without duplicating DOM.
 */
export function injectJobCardBadges(card: HTMLElement, analysis?: ExtensionJobAnalysis): void {
  ensureStylesInjected(card.ownerDocument)

  let root = card.querySelector<HTMLElement>(`:scope > .${ROOT_CLASS}, .${ROOT_CLASS}[${CARD_KEY_ATTR}]`)
  // Don't pull in a sibling card's badge row — verify the root we found really
  // is inside this card.
  if (root && !card.contains(root)) root = null

  if (!root) {
    root = card.ownerDocument.createElement("div")
    root.className = ROOT_CLASS
    root.setAttribute(CARD_KEY_ATTR, getCardKey(card))
    insertBadgeRoot(card, root)
  }

  const extract = readCardExtract(card)
  const facts = readCardFacts(card)
  root.innerHTML = renderBadgeHtml(extract, facts, analysis, getSaveState(card), getAnalyzeState(card))
}

function readCardFacts(card: HTMLElement): JobCardFacts | null {
  const key = card.getAttribute(CARD_KEY_ATTR)
  if (!key) return null
  return cardKeyToFacts.get(key) ?? null
}

function insertBadgeRoot(card: HTMLElement, root: HTMLElement): void {
  // Always append AS A CHILD OF THE CARD — never walk up. Walking up past the
  // card boundary (as we used to) drops the row between cards instead of
  // inside them. Appending also keeps the host's flex/grid layout intact.
  card.appendChild(root)
}

// ── Per-card extract / state cache ───────────────────────────────────────────
//
// We can't use a WeakMap from inside a content-script-injected fragment
// without coordination, so we keep the cache on the engine. The badge
// renderers retrieve it via attributes. Fall back to re-extracting if the
// cache is cold (e.g. badges injected before the engine cached the extract).

const cardKeyToExtract = new Map<string, JobCardExtract>()
const cardKeyToFacts = new Map<string, JobCardFacts>()
const cardKeyToSaveState = new Map<string, "idle" | "saving" | "saved" | "error">()
const cardKeyToAnalyzeState = new Map<string, "idle" | "pending" | "done" | "error">()
const analysisByJobUrl = new Map<string, ExtensionJobAnalysis>()
const inFlightAnalyzeUrls = new Set<string>()
let nextCardKey = 1

// Concurrency cap on auto-analyze: a LinkedIn search page can render 25+
// cards. Without a cap we'd fire 25 simultaneous requests on every render
// and rate-limit ourselves. 3 in-flight is enough to feel snappy without
// hammering the server; the rest queue and drain naturally.
const MAX_IN_FLIGHT_ANALYZE = 3
const analyzeQueue: Array<() => void> = []
function pumpAnalyzeQueue(): void {
  while (inFlightAnalyzeUrls.size < MAX_IN_FLIGHT_ANALYZE && analyzeQueue.length > 0) {
    const next = analyzeQueue.shift()
    if (next) next()
  }
}

function getCardKey(card: HTMLElement): string {
  let key = card.getAttribute(CARD_KEY_ATTR)
  if (key) return key
  key = `card-${nextCardKey++}`
  card.setAttribute(CARD_KEY_ATTR, key)
  return key
}

function readCardExtract(card: HTMLElement): JobCardExtract | null {
  const key = card.getAttribute(CARD_KEY_ATTR)
  if (!key) return null
  return cardKeyToExtract.get(key) ?? null
}

function getSaveState(card: HTMLElement): "idle" | "saving" | "saved" | "error" {
  const key = card.getAttribute(CARD_KEY_ATTR)
  return (key && cardKeyToSaveState.get(key)) || "idle"
}

function setSaveState(card: HTMLElement, state: "idle" | "saving" | "saved" | "error"): void {
  const key = getCardKey(card)
  cardKeyToSaveState.set(key, state)
}

function getAnalyzeState(card: HTMLElement): "idle" | "pending" | "done" | "error" {
  const key = card.getAttribute(CARD_KEY_ATTR)
  return (key && cardKeyToAnalyzeState.get(key)) || "idle"
}

function setAnalyzeState(card: HTMLElement, state: "idle" | "pending" | "done" | "error"): void {
  const key = getCardKey(card)
  cardKeyToAnalyzeState.set(key, state)
}

// ── Badge HTML ───────────────────────────────────────────────────────────────

function renderBadgeHtml(
  extract: JobCardExtract | null,
  facts: JobCardFacts | null,
  analysis: ExtensionJobAnalysis | undefined,
  saveState: "idle" | "saving" | "saved" | "error",
  analyzeState: "idle" | "pending" | "done" | "error",
): string {
  const pills: string[] = []
  pills.push(`<span class="ho-pill ho-pill-brand">Hireoven</span>`)

  if (analysis) {
    // Priority: match → H1B → E-Verify → Ghost → Salary → Remote → top skill.
    // Cards intentionally hide "unknown" sponsorship/ghost so the row stays
    // clean — those are surfaced (with explanation) in the Detail Scout panel
    // instead. No fake values.

    // 1. Match score (real number only)
    if (typeof analysis.matchScore === "number") {
      const pct = Math.max(0, Math.min(100, Math.round(analysis.matchScore)))
      pills.push(`<span class="ho-pill ho-pill-match" title="Match score">${pct}%</span>`)
    }

    // 2. Sponsorship — only when conclusive
    const spons = analysis.sponsorship?.status
    if (spons === "likely")         pills.push(`<span class="ho-pill ho-pill-spons-likely" title="Sponsorship likely">H1B Likely</span>`)
    else if (spons === "no_sponsorship") pills.push(`<span class="ho-pill ho-pill-spons-no" title="No sponsorship">No Sponsor</span>`)
    else if (spons === "unclear")        pills.push(`<span class="ho-pill ho-pill-spons-unclear" title="Sponsorship unclear">H1B Unclear</span>`)
    // status === "unknown" or undefined → hide on cards.

    // 3. E-Verify — not yet a structured backend field; intentionally omitted
    //    so we never render fake values.

    // 4. Ghost risk — only when conclusive
    const lvl = analysis.ghostRisk?.level
    if (lvl === "low")    pills.push(`<span class="ho-pill ho-pill-ghost-low" title="Low ghost-job risk">Ghost: low</span>`)
    else if (lvl === "medium") pills.push(`<span class="ho-pill ho-pill-ghost-medium" title="Medium ghost-job risk">Ghost: med</span>`)
    else if (lvl === "high")   pills.push(`<span class="ho-pill ho-pill-ghost-high" title="High ghost-job risk">Ghost: high</span>`)
    // level === "unknown" or undefined → hide on cards.

    // 5. Salary
    if (facts?.hasSalary || analysis.signals?.find((s) => s.type === "salary")) {
      pills.push(`<span class="ho-pill ho-pill-salary" title="${escapeAttr(extract?.salaryText ?? "Salary listed")}">Salary</span>`)
    }

    // 6. Work mode
    const workMode = extract?.workModeText ?? analysis.signals?.find((s) => s.type === "work_mode")?.label
    if (workMode) {
      pills.push(`<span class="ho-pill ho-pill-work" title="Work mode">${escapeText(workMode)}</span>`)
    }

    // 7. Top matched skill
    const skill = (analysis.signals ?? []).find((s) => s.type === "matched_skill" && s.label)
    if (skill) {
      pills.push(`<span class="ho-pill ho-pill-skill" title="${escapeAttr(skill.evidence ?? skill.label)}">${escapeText(skill.label)}</span>`)
    }
  } else {
    // ── Pre-analysis row ─────────────────────────────────────────────────
    // Show only deterministic, visible facts. No "Analyzing…", no "?" pills.
    if (facts?.isRemote || extract?.workModeText) {
      const label = extract?.workModeText ?? "Remote"
      pills.push(`<span class="ho-pill ho-pill-work" title="Work mode">${escapeText(label)}</span>`)
    }
    if (facts?.hasSalary && extract?.salaryText) {
      pills.push(`<span class="ho-pill ho-pill-salary" title="${escapeAttr(extract.salaryText)}">Salary</span>`)
    }
    if (facts?.isEasyApply) {
      pills.push(`<span class="ho-pill ho-pill-info" title="Easy Apply">Easy Apply</span>`)
    }
    if (facts?.isPromoted) {
      pills.push(`<span class="ho-pill ho-pill-muted" title="Promoted listing">Promoted</span>`)
    }
  }

  // Action buttons sit in the same row — Analyze (pre-analysis only) + Save.
  if (!analysis) {
    if (analyzeState === "pending") {
      pills.push(`<button class="ho-pill ho-pill-action" disabled>Analyzing…</button>`)
    } else if (analyzeState === "error") {
      pills.push(`<button class="ho-pill ho-pill-action" ${ACTION_ATTR}="analyze" title="${escapeAttr("Retry analyze")}">Retry</button>`)
    } else {
      const analyzeDisabled = !extract?.jobUrl || extract.confidence === "low"
      pills.push(
        `<button class="ho-pill ho-pill-action" ${ACTION_ATTR}="analyze" ${analyzeDisabled ? "disabled" : ""}>Analyze</button>`,
      )
    }
  }

  if (saveState === "saved") {
    pills.push(`<span class="ho-pill ho-pill-saved">✓ Saved</span>`)
  } else if (saveState === "saving") {
    pills.push(`<button class="ho-pill ho-pill-action" disabled>Saving…</button>`)
  } else if (saveState === "error") {
    pills.push(`<button class="ho-pill ho-pill-action ho-pill-error" ${ACTION_ATTR}="save">Retry save</button>`)
  } else {
    const saveDisabled = !extract || !extract.jobUrl
    pills.push(
      `<button class="ho-pill ho-pill-action ho-pill-primary" ${ACTION_ATTR}="save" ${saveDisabled ? "disabled" : ""}>Save</button>`,
    )
  }

  return pills.join("")
}

// Legacy renderSponsorshipPill / renderGhostPill helpers were inlined into
// renderBadgeHtml so the priority order and "hide unknown on cards" rules
// stay co-located. Type imports kept above for documentation.

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))
}
function escapeAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  )
}

// ── Engine: scan + observe + click delegation ────────────────────────────────

/**
 * Scans the page for job cards on the given site, injects badges, and
 * observes for new cards (SPA, infinite scroll). Single instance per page
 * lifetime — call `stop()` to dispose.
 */
export class JobCardBadgeEngine {
  private site: SupportedSite
  private observer: MutationObserver | null = null
  private scanScheduled = false
  private clickHandler: ((event: Event) => void) | null = null
  private boundDoc: Document

  constructor(site: SupportedSite, doc: Document = document) {
    this.site = site
    this.boundDoc = doc
  }

  start(): void {
    if (this.observer) return
    ensureStylesInjected(this.boundDoc)
    this.scheduleScan()

    this.observer = new MutationObserver(() => this.scheduleScan())
    this.observer.observe(this.boundDoc.body, { childList: true, subtree: true })

    this.clickHandler = (event) => this.onClick(event)
    this.boundDoc.addEventListener("click", this.clickHandler, true)
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = null
    if (this.clickHandler) {
      this.boundDoc.removeEventListener("click", this.clickHandler, true)
      this.clickHandler = null
    }
    // Drop screener registrations for cards we owned. The screener clears its
    // own bar separately when the page mode changes.
    const processed = this.boundDoc.querySelectorAll<HTMLElement>(`[${PROCESSED_ATTR}="true"]`)
    processed.forEach((card) => unregisterCard(card))
  }

  private scheduleScan(): void {
    if (this.scanScheduled) return
    this.scanScheduled = true
    // Coalesce bursts of mutations (LinkedIn sometimes fires hundreds within
    // a single layout pass). Queue a scan on the next animation frame.
    requestAnimationFrame(() => {
      this.scanScheduled = false
      this.scan()
    })
  }

  private scan(): void {
    const cards = findJobCards(this.site, this.boundDoc)
    let injected = 0
    let skipped = 0
    for (const card of cards) {
      if (card.getAttribute(PROCESSED_ATTR) === "true") continue
      const extract = extractJobCard(card, this.site)
      // Skip cards we couldn't extract enough from to do anything useful.
      if (!extract.jobUrl && !extract.title) {
        skipped += 1
        continue
      }
      const key = getCardKey(card)
      cardKeyToExtract.set(key, extract)
      card.setAttribute(PROCESSED_ATTR, "true")
      // Register for filtering — the screener bar reads facts deterministically
      // from the card itself, plus whatever the analysis adds later.
      const facts = extractJobCardFacts(card, extract)
      cardKeyToFacts.set(key, facts)
      registerCardForFiltering(card, extract, facts)
      const cached = extract.jobUrl ? analysisByJobUrl.get(extract.jobUrl) : undefined
      if (cached) updateCardAnalysis(card, cached)
      // Analyze is now a per-card click action — we no longer auto-fire on
      // every render. The user clicks "Analyze" to trigger when they want
      // real signals; until then the row shows only deterministic facts.
      injectJobCardBadges(card, cached)
      injected += 1
    }
    void injected
    void skipped
  }

  /**
   * Schedule background analysis for a card. Idempotent across rescans:
   *   - skip if already done / pending for this card
   *   - skip if we already cached an analysis for the same jobUrl
   * Throttles via the shared in-flight cap (`MAX_IN_FLIGHT_ANALYZE`).
   */
  private queueAutoAnalyze(card: HTMLElement): void {
    const extract = readCardExtract(card)
    if (!extract?.jobUrl) return
    if (analysisByJobUrl.has(extract.jobUrl)) return
    const state = getAnalyzeState(card)
    if (state === "pending" || state === "done") return
    if (inFlightAnalyzeUrls.has(extract.jobUrl)) return

    setAnalyzeState(card, "pending")
    injectJobCardBadges(card, undefined)

    const run = async () => {
      if (!extract.jobUrl) return
      inFlightAnalyzeUrls.add(extract.jobUrl)
      try {
        const job = toExtractedJob(extract)
        const analysis = await analyzeExtractedJob(job)
        analysisByJobUrl.set(extract.jobUrl, analysis)
        setAnalyzeState(card, "done")
        if (card.isConnected) updateCardAnalysis(card, analysis)
        // The card may have been re-rendered by LinkedIn between request and
        // response; re-query for it before refreshing badges.
        if (card.isConnected) injectJobCardBadges(card, analysis)
      } catch {
        setAnalyzeState(card, "error")
        if (card.isConnected) injectJobCardBadges(card, undefined)
      } finally {
        inFlightAnalyzeUrls.delete(extract.jobUrl)
        pumpAnalyzeQueue()
      }
    }

    if (inFlightAnalyzeUrls.size < MAX_IN_FLIGHT_ANALYZE) {
      void run()
    } else {
      analyzeQueue.push(() => void run())
    }
  }

  private onClick(event: Event): void {
    const target = event.target as Element | null
    const actionEl = target?.closest?.(`[${ACTION_ATTR}]`) as HTMLElement | null
    if (!actionEl) return
    const card = actionEl.closest<HTMLElement>(`[${PROCESSED_ATTR}="true"]`)
    if (!card) return
    const action = actionEl.getAttribute(ACTION_ATTR)
    event.preventDefault()
    event.stopPropagation()
    if (action === "save") void this.handleSave(card)
    else if (action === "analyze") void this.queueAutoAnalyze(card)
  }

  private async handleSave(card: HTMLElement): Promise<void> {
    const extract = readCardExtract(card)
    if (!extract?.jobUrl) return
    setSaveState(card, "saving")
    injectJobCardBadges(card, extract.jobUrl ? analysisByJobUrl.get(extract.jobUrl) : undefined)
    try {
      const job = toExtractedJob(extract)
      await saveExtractedJob(job)
      setSaveState(card, "saved")
    } catch {
      setSaveState(card, "error")
    }
    injectJobCardBadges(card, extract.jobUrl ? analysisByJobUrl.get(extract.jobUrl) : undefined)
  }
}

/**
 * Adapt the lightweight card extract to the richer `ExtractedJob` shape the
 * existing analyze / save endpoints expect. Missing fields stay undefined —
 * the server already tolerates partial extracts (mirrors the JD-page path).
 */
function toExtractedJob(extract: JobCardExtract): ExtractedJob {
  return {
    source: extract.source,
    url: extract.jobUrl ?? "",
    title: extract.title,
    company: extract.company,
    location: extract.location,
    descriptionText: extract.snippet,
    salaryText: extract.salaryText,
    applyUrl: extract.jobUrl,
    confidence: extract.confidence,
    extractedAt: new Date().toISOString(),
    postedAt: extract.postedAgeText,
  }
}

/**
 * Hireoven Job-Board Screener
 *
 * Top-of-page overlay shown on LinkedIn / Indeed / Glassdoor / Handshake
 * SEARCH pages (mode === "job_board_search"). Adds a row of filter pills
 * the user toggles to hide cards that don't match their criteria.
 *
 * Hard rules:
 *   - Filters only act on data we actually have (deterministic facts pulled
 *     off the card OR backend-returned analysis values). Unknown fields
 *     leave a card visible — we never falsely include or exclude.
 *   - No backend call is initiated by toggling a filter; the engine reads
 *     the per-card analysis cache that auto-analyze already populated.
 *   - State persists in chrome.storage.local so the user's selection
 *     survives reloads + SPA navigation.
 *
 * Lifecycle:
 *   - mountScreenerBar(site) attaches a fixed shadow-rooted bar at the
 *     top of the page. Idempotent.
 *   - applyJobBoardFilters(filters) hides/shows cards. Called when
 *     filters change OR when new cards/analyses arrive (via callback in
 *     job-card-badges.ts).
 */

import type { JobCardExtract, JobCardFacts } from "./job-card-badges"
import type { ExtensionJobAnalysis } from "../api-types"
import type { SupportedSite } from "../detectors/site"

// ── Public types ─────────────────────────────────────────────────────────────

export type JobBoardFilters = {
  h1bSponsor: boolean
  eVerify: boolean
  remote: boolean
  salaryListed: boolean
  lowGhostRisk: boolean
  match70: boolean
  hideViewed: boolean
  hideStaffing: boolean
  hidePromoted: boolean
}

export const DEFAULT_FILTERS: JobBoardFilters = {
  h1bSponsor: false,
  eVerify: false,
  remote: false,
  salaryListed: false,
  lowGhostRisk: false,
  match70: false,
  hideViewed: false,
  hideStaffing: false,
  hidePromoted: false,
}

const STORAGE_KEY = "hireovenJobBoardFilters"
const HOST_ID = "hireoven-screener-bar"
const HIDDEN_ATTR = "data-hireoven-hidden"

// ── Module state ─────────────────────────────────────────────────────────────

let filters: JobBoardFilters = { ...DEFAULT_FILTERS }
let collapsed = false
let mountedSite: SupportedSite | null = null
let host: HTMLElement | null = null
let shadow: ShadowRoot | null = null

/**
 * Per-card data the filter engine reads. Populated by job-card-badges.ts
 * via registerCardData() — kept module-level so applyJobBoardFilters() can
 * iterate without re-extracting.
 */
type CardRecord = {
  card: HTMLElement
  extract: JobCardExtract
  facts: JobCardFacts
  analysis?: ExtensionJobAnalysis
}
const records = new Map<HTMLElement, CardRecord>()

// ── Storage ──────────────────────────────────────────────────────────────────

async function loadFilters(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY)
    const v = stored[STORAGE_KEY]
    if (v && typeof v === "object") {
      filters = { ...DEFAULT_FILTERS, ...(v as Partial<JobBoardFilters>) }
    }
  } catch {
    // Storage unavailable — keep defaults.
  }
}

function saveFilters(): void {
  try {
    void chrome.storage.local.set({ [STORAGE_KEY]: filters })
  } catch {
    // ignore
  }
}

// ── Filter logic ─────────────────────────────────────────────────────────────

/**
 * Decide whether a card should be visible under the current filters.
 * Returns true → show, false → hide.
 *
 * The "only act on known data" rule:
 *   - For "Match 70%+", we hide a card only when matchScore is a number AND
 *     it's < 70. If matchScore is undefined we leave the card visible (we
 *     don't have data to exclude on).
 *   - For "Low Ghost Risk", we hide only when ghostRisk.level is explicitly
 *     "medium" or "high". "unknown" or missing → visible.
 *   - For "H1B Sponsor", we hide only when sponsorship.status === "no_sponsorship".
 *     "unclear" / "unknown" / "likely" stay visible.
 *   - "Remote" / "Salary Listed" use deterministic facts read off the card.
 *   - "Hide Viewed / Promoted / Staffing" are explicit excludes; if the
 *     fact is unknown they stay visible (the user opted in with "hide", not
 *     "show only").
 */
export function shouldShowCard(rec: CardRecord, f: JobBoardFilters): boolean {
  const a = rec.analysis
  const facts = rec.facts

  if (f.h1bSponsor && a?.sponsorship?.status === "no_sponsorship") return false
  if (f.eVerify) {
    // E-Verify isn't yet a structured field on the analysis payload — when the
    // backend learns to return it, plug it in here. For now we leave the
    // filter active as a no-op so the UI stays consistent and we don't lie.
  }
  if (f.remote && !facts.isRemote && a?.signals?.find((s) => s.type === "work_mode" && /remote/i.test(s.label)) === undefined) {
    return false
  }
  if (f.salaryListed && !facts.hasSalary && a?.signals?.find((s) => s.type === "salary") === undefined) {
    return false
  }
  if (f.lowGhostRisk) {
    const lvl = a?.ghostRisk?.level
    if (lvl === "medium" || lvl === "high") return false
  }
  if (f.match70) {
    const m = a?.matchScore
    if (typeof m === "number" && m < 70) return false
  }
  if (f.hideViewed   && facts.isViewed)         return false
  if (f.hidePromoted && facts.isPromoted)       return false
  if (f.hideStaffing && facts.isStaffingAgency) return false

  return true
}

/** Public: re-evaluate every registered card under current filters. */
export function applyJobBoardFilters(next?: JobBoardFilters): void {
  if (next) filters = next
  for (const rec of records.values()) {
    if (!rec.card.isConnected) continue
    const show = shouldShowCard(rec, filters)
    setCardHidden(rec.card, !show)
  }
  refreshMatchCount()
}

function setCardHidden(card: HTMLElement, hidden: boolean): void {
  if (hidden) {
    card.setAttribute(HIDDEN_ATTR, "true")
    // Use display:none directly so we don't lose the card's natural width
    // when it re-shows (avoids layout flicker on host CSS).
    card.style.display = "none"
  } else if (card.getAttribute(HIDDEN_ATTR) === "true") {
    card.removeAttribute(HIDDEN_ATTR)
    card.style.removeProperty("display")
  }
}

// ── Card registry (called by the badge engine) ───────────────────────────────

export function registerCardForFiltering(
  card: HTMLElement,
  extract: JobCardExtract,
  facts: JobCardFacts,
): void {
  records.set(card, { card, extract, facts })
  // Apply right away so a freshly injected card respects "hide promoted" etc.
  if (host) {
    const rec = records.get(card)
    if (rec) setCardHidden(card, !shouldShowCard(rec, filters))
  }
  refreshMatchCount()
}

export function updateCardAnalysis(card: HTMLElement, analysis: ExtensionJobAnalysis): void {
  const rec = records.get(card)
  if (!rec) return
  rec.analysis = analysis
  if (host) setCardHidden(card, !shouldShowCard(rec, filters))
  refreshMatchCount()
}

export function unregisterCard(card: HTMLElement): void {
  records.delete(card)
}

// ── Bar UI ───────────────────────────────────────────────────────────────────

const STYLES = `
  :host { all: initial; }
  .bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2147483646;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    background: #ffffff;
    border-bottom: 1px solid rgba(15, 23, 42, 0.10);
    box-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 12px;
    color: #0a0a0a;
  }
  .bar.collapsed { gap: 8px; }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    font-size: 12px;
    color: #0a0a0a;
    flex-shrink: 0;
  }
  .brand-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #FF5C18;
  }
  .count {
    font-size: 11px;
    color: #52525b;
    flex-shrink: 0;
  }
  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .bar.collapsed .pills { display: none; }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 10px;
    border-radius: 11px;
    border: 1px solid rgba(15, 23, 42, 0.14);
    background: #ffffff;
    color: #0a0a0a;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    font-family: inherit;
  }
  .pill:hover { background: rgba(15, 23, 42, 0.04); }
  .pill[aria-pressed="true"] {
    background: #0a0a0a;
    color: #ffffff;
    border-color: #0a0a0a;
  }
  .pill.primary[aria-pressed="true"] {
    background: #FF5C18;
    color: #ffffff;
    border-color: #FF5C18;
  }
  .icon-btn {
    background: transparent;
    border: 0;
    color: #71717a;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    flex-shrink: 0;
    font-family: inherit;
  }
  .icon-btn:hover { color: #0a0a0a; background: rgba(15, 23, 42, 0.05); }
`

const PILL_DEFS: Array<{
  key: keyof JobBoardFilters
  label: string
  primary?: boolean
}> = [
  { key: "match70",       label: "Match 70%+", primary: true },
  { key: "h1bSponsor",    label: "H1B Sponsor" },
  { key: "eVerify",       label: "E-Verify" },
  { key: "remote",        label: "Remote" },
  { key: "salaryListed",  label: "Salary listed" },
  { key: "lowGhostRisk",  label: "Low Ghost Risk" },
  { key: "hideViewed",    label: "Hide Viewed" },
  { key: "hideStaffing",  label: "Hide Staffing" },
  { key: "hidePromoted",  label: "Hide Promoted" },
]

export async function mountScreenerBar(site: SupportedSite): Promise<void> {
  if (mountedSite === site && host) return
  unmountScreenerBar()
  await loadFilters()

  host = document.createElement("div")
  host.id = HOST_ID
  host.style.position = "fixed"
  host.style.top = "0"
  host.style.left = "0"
  host.style.right = "0"
  host.style.zIndex = "2147483646"
  document.documentElement.appendChild(host)

  shadow = host.attachShadow({ mode: "open" })

  const style = document.createElement("style")
  style.textContent = STYLES
  shadow.appendChild(style)

  render()
  shadow.addEventListener("click", onClick)

  mountedSite = site
  applyJobBoardFilters()
}

export function unmountScreenerBar(): void {
  if (host) {
    host.remove()
    host = null
    shadow = null
  }
  mountedSite = null
}

function render(): void {
  if (!shadow) return
  // Preserve the style element (first child) and re-render the bar.
  const style = shadow.querySelector("style")
  shadow.innerHTML = ""
  if (style) shadow.appendChild(style)

  const bar = document.createElement("div")
  bar.className = `bar ${collapsed ? "collapsed" : ""}`

  bar.innerHTML = `
    <div class="brand"><span class="brand-dot"></span>Hireoven Screener</div>
    <div class="count" data-count>${countMatchingText()}</div>
    <div class="pills">
      ${PILL_DEFS.map((p) =>
        `<button class="pill ${p.primary ? "primary" : ""}" data-toggle="${p.key}" aria-pressed="${filters[p.key]}">${p.label}</button>`,
      ).join("")}
    </div>
    <button class="icon-btn" data-action="collapse" title="${collapsed ? "Expand" : "Collapse"}">${collapsed ? "▾" : "▴"}</button>
  `
  shadow.appendChild(bar)
}

function refreshMatchCount(): void {
  if (!shadow) return
  const el = shadow.querySelector<HTMLElement>("[data-count]")
  if (el) el.textContent = countMatchingText()
}

function countMatchingText(): string {
  const total = records.size
  if (total === 0) return ""
  const visible = [...records.values()].filter((r) => shouldShowCard(r, filters)).length
  return `${visible} of ${total} cards`
}

function onClick(event: Event): void {
  const target = event.target as Element | null
  const toggleBtn = target?.closest?.<HTMLElement>("[data-toggle]")
  if (toggleBtn) {
    const key = toggleBtn.getAttribute("data-toggle") as keyof JobBoardFilters | null
    if (!key) return
    filters = { ...filters, [key]: !filters[key] }
    saveFilters()
    render()
    applyJobBoardFilters()
    return
  }
  const actionBtn = target?.closest?.<HTMLElement>("[data-action]")
  if (actionBtn) {
    const action = actionBtn.getAttribute("data-action")
    if (action === "collapse") {
      collapsed = !collapsed
      render()
    }
  }
}

export function getFilters(): JobBoardFilters {
  return { ...filters }
}

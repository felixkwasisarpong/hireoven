/**
 * Hireoven Job-Detail Scout Panel — for job-board sites only
 * (LinkedIn / Indeed / Glassdoor / Handshake) on `job_board_detail` pages.
 *
 * Dedicated panel because the existing Scout Bar is denylisted on these
 * sites (extraction reliability + apply-URL hygiene). Renders intelligence
 * read off the extracted job + the analyze backend response. No autofill
 * action — this surface is intentionally read-only intelligence + handoff
 * actions (Save, Tailor Resume, Open in Hireoven, Apply on Site).
 *
 * Hard rules:
 *   - No invented values: if a field isn't present, hide the row or render
 *     "Unknown".
 *   - No autofill UI here. (Autofill is gated separately on ATS forms.)
 */

import { extractJob, type ExtractedJob } from "../extractors/scout-extractor"
import {
  analyzeExtractedJob,
  saveExtractedJob,
  checkExtractedJob,
} from "../api-client"
import type { ExtensionJobAnalysis, ExtensionSaveResult } from "../api-types"
import type { SupportedSite } from "../detectors/site"
import {
  detectApplicationForm,
  detectLinkedInEasyApplyModal,
} from "../detectors/application-form"

const HOST_ID = "hireoven-detail-scout"
const COLLAPSED_KEY = "hireovenDetailScoutCollapsed"

let host: HTMLElement | null = null
let shadow: ShadowRoot | null = null
let mountedUrl: string | null = null

let job: ExtractedJob | null = null
let analysis: ExtensionJobAnalysis | null = null
let analyzeStatus: "idle" | "loading" | "done" | "error" = "idle"
let analyzeError: string | null = null
let saveStatus: "idle" | "saving" | "saved" | "error" = "idle"
let saveResult: ExtensionSaveResult | null = null
let alreadySaved = false
let dashboardUrlForExisting: string | null = null
let collapsed = false
let evidenceOpen = false

const STYLES = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  .panel {
    position: fixed;
    right: 16px;
    top: 80px;
    z-index: 2147483645;
    width: 320px;
    max-height: calc(100vh - 100px);
    overflow-y: auto;
    background: #ffffff;
    border: 1px solid rgba(15, 23, 42, 0.12);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    color: #0a0a0a;
  }
  .panel.collapsed { width: 200px; }
  .panel.collapsed .body { display: none; }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    font-size: 12px;
  }
  .brand-dot { width: 8px; height: 8px; border-radius: 50%; background: #FF5C18; }
  .icon-btn {
    background: transparent;
    border: 0;
    color: #71717a;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    font-family: inherit;
  }
  .icon-btn:hover { color: #0a0a0a; background: rgba(15, 23, 42, 0.05); }

  .body { padding: 12px; display: flex; flex-direction: column; gap: 12px; }

  .title { font-weight: 700; font-size: 13px; color: #0a0a0a; }
  .sub   { font-size: 11px; color: #52525b; }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 10px;
    border: 1px solid rgba(15, 23, 42, 0.10);
    color: #4a4a4a;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }
  .pill-match { color: #c2410c; background: rgba(255, 92, 24, 0.06); border-color: rgba(255, 92, 24, 0.22); font-weight: 600; }
  .pill-spons-likely { color: #15803d; border-color: rgba(34, 197, 94, 0.30); }
  .pill-spons-no     { color: #52525b; }
  .pill-spons-unknown { color: #71717a; }
  .pill-ghost-low    { color: #15803d; border-color: rgba(34, 197, 94, 0.30); }
  .pill-ghost-med    { color: #a16207; border-color: rgba(250, 204, 21, 0.30); }
  .pill-ghost-high   { color: #b91c1c; border-color: rgba(220, 38, 38, 0.28); }
  .pill-saved        { color: #FF5C18; border-color: rgba(255, 92, 24, 0.35); font-weight: 600; }

  .meta { display: grid; grid-template-columns: max-content 1fr; column-gap: 8px; row-gap: 4px; font-size: 12px; }
  .meta dt { color: #71717a; }
  .meta dd { color: #0a0a0a; }
  .meta .hint { color: #a1a1aa; font-size: 11px; font-style: italic; display: block; }

  .skills { display: flex; flex-wrap: wrap; gap: 4px; }
  .skill {
    display: inline-flex;
    height: 20px;
    align-items: center;
    padding: 0 8px;
    border-radius: 10px;
    background: rgba(15, 23, 42, 0.05);
    color: #0a0a0a;
    font-size: 11px;
    font-weight: 500;
  }
  .skill-missing { background: rgba(220, 38, 38, 0.05); color: #b91c1c; }
  .none { font-size: 11px; color: #a1a1aa; font-style: italic; }

  .section-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #71717a;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .btn {
    background: #ffffff;
    color: #0a0a0a;
    border: 1px solid rgba(15, 23, 42, 0.14);
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    text-align: center;
  }
  .btn:hover:not([disabled]) { background: rgba(15, 23, 42, 0.04); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-primary {
    background: #FF5C18;
    color: #ffffff;
    border-color: #FF5C18;
    font-weight: 600;
  }
  .btn-primary:hover:not([disabled]) { background: #ff7032; border-color: #ff7032; }

  .evidence {
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 11px;
    color: #4a4a4a;
    background: rgba(15, 23, 42, 0.02);
  }
  .evidence-empty { color: #a1a1aa; font-style: italic; }
  .link-btn {
    background: transparent;
    border: 0;
    color: #FF5C18;
    font-size: 11px;
    cursor: pointer;
    padding: 0;
    font-family: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link-btn:hover { color: #ff7032; }
`

// ── Lifecycle ────────────────────────────────────────────────────────────────

export async function mountDetailScoutPanel(_site: SupportedSite): Promise<void> {
  const url = window.location.href
  if (host && mountedUrl === url) {
    // Already mounted for this URL — refresh in case DOM changed.
    void runAnalysis()
    render()
    return
  }
  unmountDetailScoutPanel()

  try {
    const stored = await chrome.storage.local.get(COLLAPSED_KEY)
    collapsed = Boolean(stored[COLLAPSED_KEY])
  } catch {
    collapsed = false
  }

  host = document.createElement("div")
  host.id = HOST_ID
  document.documentElement.appendChild(host)
  shadow = host.attachShadow({ mode: "open" })

  const styleEl = document.createElement("style")
  styleEl.textContent = STYLES
  shadow.appendChild(styleEl)

  // Read job from page
  try {
    job = extractJob(document, url)
  } catch {
    job = null
  }
  if (!job?.title && !job?.url) {
    // Page didn't extract enough — don't show an empty panel
    unmountDetailScoutPanel()
    return
  }

  analysis = null
  analyzeStatus = "idle"
  analyzeError = null
  saveStatus = "idle"
  saveResult = null
  alreadySaved = false
  dashboardUrlForExisting = null
  evidenceOpen = false
  mountedUrl = url

  shadow.addEventListener("click", onClick)

  render()
  void runCheck()
  void runAnalysis()
}

export function unmountDetailScoutPanel(): void {
  if (host) {
    host.remove()
    host = null
    shadow = null
  }
  mountedUrl = null
}

// ── Backend calls ────────────────────────────────────────────────────────────

async function runCheck(): Promise<void> {
  if (!job) return
  try {
    const res = await checkExtractedJob({
      url: job.url,
      canonicalUrl: job.canonicalUrl,
      applyUrl: job.applyUrl,
    })
    alreadySaved = res.saved
    dashboardUrlForExisting = res.dashboardUrl ?? null
    render()
  } catch {
    // ignore — Save button still works as fallback
  }
}

async function runAnalysis(): Promise<void> {
  if (!job || analyzeStatus === "loading") return
  analyzeStatus = "loading"
  analyzeError = null
  render()
  try {
    analysis = await analyzeExtractedJob(job)
    analyzeStatus = "done"
  } catch (err) {
    analyzeStatus = "error"
    analyzeError = err instanceof Error ? err.message : "Analyze failed"
  }
  render()
}

async function onSave(): Promise<void> {
  if (!job || saveStatus === "saving" || saveStatus === "saved") return
  saveStatus = "saving"
  render()
  try {
    saveResult = await saveExtractedJob(job)
    saveStatus = "saved"
    alreadySaved = true
    if (saveResult.dashboardUrl) dashboardUrlForExisting = saveResult.dashboardUrl
  } catch (err) {
    saveStatus = "error"
    analyzeError = err instanceof Error ? err.message : "Save failed"
  }
  render()
}

function onTailor(): void {
  // Open Hireoven's resume tailor flow in a new tab. Server handles
  // job-context injection via querystring.
  if (!job) return
  const params = new URLSearchParams()
  if (job.url) params.set("jobUrl", job.url)
  if (job.title) params.set("title", job.title)
  if (job.company) params.set("company", job.company)
  const target = `https://hireoven.com/dashboard/resume/tailor?${params.toString()}`
  window.open(target, "_blank", "noopener")
}

function onOpenHireoven(): void {
  const url = saveResult?.dashboardUrl ?? dashboardUrlForExisting
  window.open(url ?? "https://hireoven.com/dashboard/jobs", "_blank", "noopener")
}

function onApplyOnSite(): void {
  if (job?.applyUrl) {
    window.open(job.applyUrl, "_blank", "noopener")
  } else if (job?.url) {
    window.open(job.url, "_blank", "noopener")
  }
}

/**
 * Easy Apply autofill handoff. The modal lives in LinkedIn's DOM; the
 * existing autofill-form flow handles the actual fill on supported ATS
 * sites. For Easy Apply we open the Hireoven dashboard's autofill helper
 * with the job context so the user can review safe-fields before injecting.
 *
 * No fields are filled here — strictly a UI handoff.
 */
function onAutofillHandoff(): void {
  if (!job) return
  const params = new URLSearchParams()
  if (job.url) params.set("jobUrl", job.url)
  if (job.title) params.set("title", job.title)
  if (job.company) params.set("company", job.company)
  const target = `https://hireoven.com/dashboard/autofill/easy-apply?${params.toString()}`
  window.open(target, "_blank", "noopener")
}

// Highlight Skills — best-effort visual highlight of matched skills inside the
// host page's job description body. Pure DOM read of text nodes; no mutation
// of structure beyond wrapping matched substrings in <mark>.
function onHighlightSkills(): void {
  if (!analysis) return
  const skills = (analysis.signals ?? [])
    .filter((s) => s.type === "matched_skill" && s.label)
    .map((s) => s.label.trim())
    .filter((s) => s.length > 1)
  if (skills.length === 0) return

  // Restrict to a likely JD container; fall back to <main> or <body>.
  const root: HTMLElement =
    document.querySelector<HTMLElement>(
      "[class*='description'], [class*='Description'], [data-test*='description'], main",
    ) ?? document.body

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const parent = (n as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName.toLowerCase()
      if (tag === "script" || tag === "style" || tag === "mark") return NodeFilter.FILTER_REJECT
      return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const re = new RegExp(`\\b(${skills.map(escapeRegex).join("|")})\\b`, "gi")
  const targets: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as Text)
  for (const node of targets) {
    const text = node.nodeValue ?? ""
    if (!re.test(text)) continue
    re.lastIndex = 0
    const frag = document.createDocumentFragment()
    let lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)))
      const mark = document.createElement("mark")
      mark.style.background = "rgba(255, 92, 24, 0.20)"
      mark.style.color = "#0a0a0a"
      mark.style.borderRadius = "2px"
      mark.style.padding = "0 2px"
      mark.textContent = m[0]
      frag.appendChild(mark)
      lastIndex = m.index + m[0].length
    }
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)))
    node.parentNode?.replaceChild(frag, node)
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// ── Click handler ────────────────────────────────────────────────────────────

function onClick(event: Event): void {
  const target = event.target as Element | null
  const actionEl = target?.closest?.<HTMLElement>("[data-action]")
  if (!actionEl) return
  const action = actionEl.getAttribute("data-action")
  if (action === "save")          void onSave()
  else if (action === "tailor")   onTailor()
  else if (action === "open")     onOpenHireoven()
  else if (action === "apply")    onApplyOnSite()
  else if (action === "highlight") onHighlightSkills()
  else if (action === "autofill") onAutofillHandoff()
  else if (action === "analyze")  void runAnalysis()
  else if (action === "collapse") {
    collapsed = !collapsed
    try { void chrome.storage.local.set({ [COLLAPSED_KEY]: collapsed }) } catch { /* ignore */ }
    render()
  }
  else if (action === "evidence") {
    evidenceOpen = !evidenceOpen
    render()
  }
}

// ── Render ───────────────────────────────────────────────────────────────────

function render(): void {
  if (!shadow || !job) return
  const styleEl = shadow.querySelector("style")
  shadow.innerHTML = ""
  if (styleEl) shadow.appendChild(styleEl)

  const a = analysis
  const matchScore = typeof a?.matchScore === "number"
    ? `<span class="pill pill-match">${Math.round(a.matchScore)}% match</span>`
    : ""

  const sponsorshipPill = (() => {
    const s = a?.sponsorship?.status
    if (!s) return ""
    if (s === "likely")         return `<span class="pill pill-spons-likely">H1B Likely</span>`
    if (s === "no_sponsorship") return `<span class="pill pill-spons-no">No Sponsor</span>`
    if (s === "unclear")        return `<span class="pill">H1B Unclear</span>`
    return `<span class="pill pill-spons-unknown">H1B Unknown</span>`
  })()

  const ghostPill = (() => {
    const lvl = a?.ghostRisk?.level
    if (!lvl) return ""
    if (lvl === "low")  return `<span class="pill pill-ghost-low">Ghost: low</span>`
    if (lvl === "medium") return `<span class="pill pill-ghost-med">Ghost: med</span>`
    if (lvl === "high")   return `<span class="pill pill-ghost-high">Ghost: high</span>`
    return ""  // unknown shown in the detail rows below with helper text
  })()

  // Skills sections — explicit empty states vs "haven't analyzed yet".
  const matched = (a?.signals ?? []).filter((s) => s.type === "matched_skill" && s.label)
  const missing = (a?.signals ?? []).filter((s) => s.type === "missing_skill" && s.label)
  const skillsBlock = (() => {
    if (analyzeStatus !== "done") {
      return `<div class="none">Analyze this job to detect matched and missing skills.</div>`
    }
    if (matched.length === 0 && missing.length === 0) {
      return `<div class="none">No matched skills found from the current resume/profile yet.</div>`
    }
    let html = ""
    if (matched.length > 0) {
      html += `<div class="section-title">Matched skills</div>` +
              `<div class="skills">${matched.map((s) => `<span class="skill" title="${escAttr(s.evidence ?? "")}">${escText(s.label)}</span>`).join("")}</div>`
    }
    if (missing.length > 0) {
      html += `<div class="section-title" style="margin-top:8px">Missing skills</div>` +
              `<div class="skills">${missing.map((s) => `<span class="skill skill-missing" title="${escAttr(s.evidence ?? "")}">${escText(s.label)}</span>`).join("")}</div>`
    }
    return html
  })()

  // Detail rows for unknown sponsorship / ghost — surface them only here, not
  // on the cards, with helper text explaining *why* they're unknown.
  const sponsUnknown = a?.sponsorship?.status === "unknown" || (analyzeStatus === "done" && !a?.sponsorship?.status)
  const ghostUnknown = a?.ghostRisk?.level === "unknown" || (analyzeStatus === "done" && !a?.ghostRisk?.level)

  const meta: Array<[string, string | undefined]> = [
    ["Source",      job.source !== "unknown" ? job.source : undefined],
    ["Salary",      job.salaryText],
    ["Work mode",   job.workModeText ?? inferWorkModeFromJob(job)],
    ["Type",        job.employmentType],
    ["Location",    job.location],
    ["Posted",      job.postedAgeText ?? job.postedAt],
    ["Applicants",  job.applicantActivityText],
    ["Promoted",    job.promoted ? "Yes" : undefined],
    ["Off LinkedIn", job.managedOffLinkedIn ? "Responses managed off LinkedIn" : undefined],
  ]
  const metaRows = meta
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([k, v]) => `<dt>${escText(k)}</dt><dd>${escText(v ?? "")}</dd>`)
    .join("")

  // Save status pill
  const savePill = alreadySaved
    ? `<span class="pill pill-saved">✓ Saved</span>`
    : ""

  const evidenceBlock = evidenceOpen ? renderEvidence(a) : ""

  // Action labels react to current state
  const saveLabel =
    saveStatus === "saving" ? "Saving…" :
    saveStatus === "saved" || alreadySaved ? "✓ Saved" :
    saveStatus === "error" ? "Retry save" :
    "Save"
  const saveDisabled = saveStatus === "saving" || saveStatus === "saved" || alreadySaved

  const analyzeLabel =
    analyzeStatus === "loading" ? "Analyzing…" :
    analyzeStatus === "error"   ? "Retry analyze" :
                                   "Re-analyze"

  const root = document.createElement("div")
  root.className = `panel ${collapsed ? "collapsed" : ""}`
  root.innerHTML = `
    <div class="header">
      <span class="brand"><span class="brand-dot"></span>Hireoven Scout</span>
      <button class="icon-btn" data-action="collapse" title="${collapsed ? "Expand" : "Collapse"}">${collapsed ? "▾" : "▴"}</button>
    </div>
    <div class="body">
      <div>
        <div class="title">${escText(job.title ?? "(untitled role)")}</div>
        <div class="sub">${escText([job.company, job.location].filter(Boolean).join(" · "))}</div>
      </div>

      <div class="row">
        ${matchScore}
        ${sponsorshipPill}
        ${ghostPill}
        ${savePill}
      </div>

      <dl class="meta">${metaRows}</dl>

      <div>${skillsBlock}</div>

      ${sponsUnknown || ghostUnknown ? `
        <dl class="meta">
          ${sponsUnknown ? `<dt>H1B</dt><dd>Unknown <span class="hint">— No explicit sponsorship evidence found in the visible job text yet.</span></dd>` : ""}
          ${ghostUnknown ? `<dt>Ghost risk</dt><dd>Unknown <span class="hint">— Not enough posting history available yet.</span></dd>` : ""}
        </dl>
      ` : ""}

      ${analyzeStatus === "error" ? `<div class="evidence" style="color:#b91c1c;border-color:rgba(220,38,38,0.20)">${escText(analyzeError ?? "Analysis failed")}</div>` : ""}

      <div>
        <button class="link-btn" data-action="evidence">${evidenceOpen ? "Hide evidence" : "Show evidence"}</button>
        ${evidenceBlock}
      </div>

      <div class="actions">
        <button class="btn" data-action="analyze" ${analyzeStatus === "loading" ? "disabled" : ""}>${analyzeLabel}</button>
        <button class="btn ${alreadySaved ? "" : "btn-primary"}" data-action="save" ${saveDisabled ? "disabled" : ""}>${saveLabel}</button>
        <button class="btn" data-action="tailor">Tailor Resume</button>
        <button class="btn" data-action="highlight" ${matched.length === 0 ? "disabled" : ""} title="${matched.length === 0 ? "Run Analyze first to detect matched skills." : ""}">Highlight Skills</button>
        <button class="btn" data-action="open">Open in Hireoven</button>
        <button class="btn" data-action="apply" ${!job.applyUrl && !job.url ? "disabled" : ""}>Apply on Site</button>
        ${shouldShowAutofillAction() ? `<button class="btn btn-primary" data-action="autofill" title="Easy Apply modal detected — open the Hireoven autofill flow">Autofill</button>` : ""}
      </div>
    </div>
  `
  shadow.appendChild(root)
}

/**
 * Autofill action is gated: only show when a real Easy Apply modal is open
 * OR a generic application form is present on the page. Normal LinkedIn
 * job-detail pages (with the inert "Easy Apply" button) explicitly do NOT
 * qualify — that's a discovery surface, not an apply surface.
 */
function shouldShowAutofillAction(): boolean {
  try {
    if (detectLinkedInEasyApplyModal(document)) return true
    const form = detectApplicationForm(document)
    return form.hasForm && form.supportsAutofill
  } catch {
    return false
  }
}

function renderEvidence(a: ExtensionJobAnalysis | null): string {
  if (!a) return `<div class="evidence evidence-empty">No evidence found yet</div>`
  const bits: string[] = []
  for (const s of a.signals ?? []) {
    if (!s.evidence) continue
    bits.push(`<div><strong>${escText(s.label)}:</strong> ${escText(s.evidence)}</div>`)
  }
  for (const e of a.sponsorship?.evidence ?? []) {
    bits.push(`<div><strong>Sponsorship:</strong> ${escText(e)}</div>`)
  }
  for (const r of a.ghostRisk?.reasons ?? []) {
    bits.push(`<div><strong>Ghost risk:</strong> ${escText(r)}</div>`)
  }
  if (bits.length === 0) return `<div class="evidence evidence-empty">No evidence found yet</div>`
  return `<div class="evidence">${bits.join("")}</div>`
}

function inferWorkModeFromJob(job: ExtractedJob): string | undefined {
  const hay = `${job.location ?? ""} ${job.descriptionText ?? ""}`.toLowerCase()
  if (/\bremote\b|\bwork from home\b|\bwfh\b/.test(hay)) return "Remote"
  if (/\bhybrid\b/.test(hay)) return "Hybrid"
  if (/\bon[-\s]?site\b|\bin[-\s]?office\b/.test(hay)) return "On-site"
  return undefined
}

function escText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))
}
function escAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  )
}

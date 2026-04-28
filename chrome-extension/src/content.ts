/**
 * Hireoven Scout Bridge — Content Script
 *
 * Automatically injects a floating bottom bar into job pages.
 * Uses Shadow DOM so page styles never bleed in or out.
 * No auto-apply. No auto-submit. User must click Save.
 */

import { detectPage } from "./detectors/ats"
import { extractJob } from "./extractors/job"
import { detectFormFields } from "./autofill/form-detector"
import type {
  BackgroundMessage,
  BackgroundResponse,
  ContentMessage,
  ContentResponse,
  ExtractedJob,
  SaveResult,
  SessionResult,
} from "./types"

// ── Constants ──────────────────────────────────────────────────────────────────

const BAR_ID = "hireoven-scout-bar-host"
const APP_URL = "http://localhost:3000"

const ATS_LABELS: Record<string, string> = {
  workday: "Workday",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  icims: "iCIMS",
  smartrecruiters: "SmartRecruiters",
  bamboohr: "BambooHR",
  generic: "",
}

// ── Background messaging ───────────────────────────────────────────────────────

function sendToBackground(msg: BackgroundMessage): Promise<BackgroundResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res: BackgroundResponse | undefined) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return }
      if (!res) { reject(new Error("No response")); return }
      resolve(res)
    })
  })
}

// ── Shadow DOM bar ─────────────────────────────────────────────────────────────

const BAR_CSS = `
  :host { all: initial; }

  * { box-sizing: border-box; margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

  /* Wrapper — centers the pill */
  .wrap {
    position: fixed;
    bottom: 20px;
    left: 0;
    right: 0;
    z-index: 2147483647;
    display: flex;
    justify-content: center;
    pointer-events: none;
    padding: 0 16px;
  }

  /* The floating pill */
  .bar {
    pointer-events: all;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: #0f172a;
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 999px;
    padding: 8px 12px 8px 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.25);
    max-width: 520px;
    animation: slideUp 0.22s cubic-bezier(0.34,1.4,0.64,1) both;
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0);    }
  }

  /* Logo */
  .logo {
    width: 32px; height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, #f97316, #fb923c);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .logo svg { width: 14px; height: 14px; fill: #fff; }

  /* Divider */
  .divider {
    width: 1px; height: 22px;
    background: rgba(255,255,255,0.10);
    flex-shrink: 0;
  }

  /* Text */
  .text { min-width: 0; max-width: 220px; }
  .title {
    font-size: 13px; font-weight: 700;
    color: #f1f5f9;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    line-height: 1.3;
  }
  .sub {
    font-size: 11px; color: #64748b;
    margin-top: 1px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ats-pill {
    display: inline-block;
    font-size: 9.5px; font-weight: 700;
    letter-spacing: 0.05em; text-transform: uppercase;
    background: rgba(249,115,22,0.18); color: #fb923c;
    border-radius: 4px; padding: 1px 5px; margin-right: 4px;
  }

  /* Spinner */
  .spinner {
    width: 15px; height: 15px;
    border: 2px solid rgba(255,255,255,0.08);
    border-top-color: #f97316;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Salary badge */
  .salary {
    flex-shrink: 0;
    font-size: 11px; font-weight: 700;
    color: #4ade80;
    background: rgba(74,222,128,0.12);
    border-radius: 99px; padding: 3px 9px;
    white-space: nowrap;
  }

  /* Buttons */
  .btn {
    flex-shrink: 0;
    display: inline-flex; align-items: center; gap: 5px;
    padding: 7px 15px;
    border-radius: 999px;
    font-size: 12.5px; font-weight: 700;
    border: none; cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
    white-space: nowrap;
  }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn:active:not(:disabled) { transform: scale(0.96); }

  .btn-primary { background: #f97316; color: #fff; }
  .btn-primary:hover:not(:disabled) { background: #ea6c0a; }

  .btn-ghost {
    background: rgba(255,255,255,0.07);
    color: #cbd5e1;
    border: 1px solid rgba(255,255,255,0.09);
  }
  .btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.12); color: #f1f5f9; }

  /* Dismiss (icon button) */
  .dismiss {
    flex-shrink: 0;
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    border: none; background: transparent;
    color: #475569; cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .dismiss:hover { background: rgba(255,255,255,0.07); color: #94a3b8; }
  .dismiss svg { display: block; }
`

function logoSvg() {
  return `<svg viewBox="0 0 16 16"><path d="M8 1L2 5v9l6 1 6-1V5L8 1zm0 2.5L12 6v6.5L8 13.5 4 12.5V6l4-2.5z"/></svg>`
}

// ── Bar controller ─────────────────────────────────────────────────────────────

const DISMISS_BTN = `
  <button class="dismiss" id="ho-dismiss" aria-label="Dismiss">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  </button>`

const DIVIDER = `<div class="divider"></div>`

class ScoutBar {
  private host: HTMLElement
  private shadow: ShadowRoot
  private bar!: HTMLElement
  private currentJob: ExtractedJob | null = null
  private dismissed = false

  constructor() {
    this.host = document.createElement("div")
    this.host.id = BAR_ID
    this.host.style.cssText = "all:unset;"
    document.body.appendChild(this.host)

    this.shadow = this.host.attachShadow({ mode: "closed" })

    const style = document.createElement("style")
    style.textContent = BAR_CSS
    this.shadow.appendChild(style)

    // Centering wrapper
    const wrap = document.createElement("div")
    wrap.className = "wrap"
    this.shadow.appendChild(wrap)

    this.bar = document.createElement("div")
    this.bar.className = "bar"
    wrap.appendChild(this.bar)
  }

  private render(html: string) {
    this.bar.innerHTML = html
  }

  showLoading() {
    this.render(`
      <div class="logo">${logoSvg()}</div>
      <div class="spinner"></div>
      <div class="text">
        <div class="title" style="color:#475569;font-weight:500;">Hireoven Scout</div>
        <div class="sub">Checking page…</div>
      </div>
    `)
  }

  showSignIn() {
    this.render(`
      <div class="logo">${logoSvg()}</div>
      ${DIVIDER}
      <div class="text">
        <div class="title">Sign in to Hireoven</div>
        <div class="sub">Save jobs · Apply smarter with Scout AI</div>
      </div>
      ${DIVIDER}
      <button class="btn btn-primary" id="ho-signin">Sign in</button>
      ${DISMISS_BTN}
    `)
    this.shadow.getElementById("ho-signin")!.addEventListener("click", () => {
      window.open(`${APP_URL}/login`, "_blank")
      this.remove()
    })
    this.shadow.getElementById("ho-dismiss")!.addEventListener("click", () => this.remove())
  }

  showJob(job: ExtractedJob) {
    this.currentJob = job
    const atsLabel = ATS_LABELS[job.ats] ?? ""
    const metaParts = [job.company, job.location].filter(Boolean).join(" · ")

    this.render(`
      <div class="logo">${logoSvg()}</div>
      ${DIVIDER}
      <div class="text">
        <div class="title">${escHtml(job.title ?? "Job detected")}</div>
        <div class="sub">
          ${atsLabel ? `<span class="ats-pill">${atsLabel}</span>` : ""}
          ${escHtml(metaParts || "")}
        </div>
      </div>
      ${job.salary ? `${DIVIDER}<div class="salary">${escHtml(job.salary)}</div>` : ""}
      ${DIVIDER}
      <button class="btn btn-primary" id="ho-save">Save job</button>
      ${DISMISS_BTN}
    `)
    this.shadow.getElementById("ho-save")!.addEventListener("click", () => void this.handleSave())
    this.shadow.getElementById("ho-dismiss")!.addEventListener("click", () => this.remove())
  }

  showNoJob() {
    this.remove()
  }

  showSaving() {
    const btn = this.shadow.getElementById("ho-save") as HTMLButtonElement | null
    if (btn) { btn.disabled = true; btn.textContent = "Saving…" }
  }

  showSaved(jobId: string | undefined) {
    const atsLabel = this.currentJob ? (ATS_LABELS[this.currentJob.ats] ?? "") : ""
    const metaParts = this.currentJob
      ? [this.currentJob.company, this.currentJob.location].filter(Boolean).join(" · ")
      : ""

    this.render(`
      <div class="logo">${logoSvg()}</div>
      ${DIVIDER}
      <div class="text">
        <div class="title" style="color:#4ade80;">✓ Saved to Hireoven</div>
        <div class="sub">
          ${atsLabel ? `<span class="ats-pill">${atsLabel}</span>` : ""}
          ${escHtml(this.currentJob?.title ?? "")}${metaParts ? ` · ${escHtml(metaParts)}` : ""}
        </div>
      </div>
      ${DIVIDER}
      <button class="btn btn-ghost" id="ho-open">Open ↗</button>
      ${DISMISS_BTN}
    `)

    const dest = jobId ? `${APP_URL}/dashboard/jobs/${jobId}` : `${APP_URL}/dashboard/applications`
    this.shadow.getElementById("ho-open")!.addEventListener("click", () => window.open(dest, "_blank"))
    this.shadow.getElementById("ho-dismiss")!.addEventListener("click", () => this.remove())

    setTimeout(() => this.remove(), 12_000)
  }

  private async handleSave() {
    if (!this.currentJob) return
    this.showSaving()
    try {
      const res = await sendToBackground({ type: "SAVE_JOB", job: this.currentJob })
      const result = res as SaveResult
      if (result.saved) {
        this.showSaved(result.jobId)
      } else {
        const btn = this.shadow.getElementById("ho-save") as HTMLButtonElement | null
        if (btn) { btn.disabled = false; btn.textContent = "Retry" }
      }
    } catch {
      const btn = this.shadow.getElementById("ho-save") as HTMLButtonElement | null
      if (btn) { btn.disabled = false; btn.textContent = "Retry" }
    }
  }

  remove() {
    this.dismissed = true
    this.host.remove()
  }

  get isDismissed() { return this.dismissed }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function init() {
  // Don't inject if already present (e.g. SPA navigation re-running the script)
  if (document.getElementById(BAR_ID)) return

  // Detect page type first — skip non-job pages immediately
  const page = detectPage()
  if (page.pageType === "unknown" && page.ats === "generic") {
    // Could still be a job page on a generic domain — check URL signals
    const url = window.location.href.toLowerCase()
    const looksLikeJob = /\/job[s]?\/|\/careers?\/|\/opening|\/position|\/role\b|\/apply/.test(url)
    if (!looksLikeJob) return
  }

  const bar = new ScoutBar()
  bar.showLoading()

  // Check session
  let authenticated = false
  try {
    const sessionRes = await sendToBackground({ type: "GET_SESSION" })
    authenticated = (sessionRes as SessionResult).authenticated
  } catch {
    authenticated = false
  }

  if (!authenticated) {
    bar.showSignIn()
    return
  }

  // Extract job
  const job = extractJob(page.ats)
  if (!job.title && !job.company) {
    bar.showNoJob()
    return
  }

  bar.showJob(job)
}

// ── Field filler ───────────────────────────────────────────────────────────────

/** Native setter trick for React/Vue/Angular controlled inputs */
const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set

/** Normalize a string for fuzzy matching: lowercase, strip punctuation, collapse whitespace */
function normStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

/**
 * Synonym groups for values that appear in many different wordings across ATS.
 * Each entry is [canonicalKeywords[], synonymsToSearchInOptionText[]].
 * canonicalKeywords: words that appear in the profile value
 * synonyms: words/phrases to search for in an option's text
 */
const VALUE_SYNONYM_MAP: Array<[string[], string[]]> = [
  // Gender
  [["male", "man"],                     ["male", "man", "he him", "mr"]],
  [["female", "woman"],                 ["female", "woman", "she her", "ms", "mrs"]],
  [["non binary", "nonbinary", "non-binary", "gender non"], ["non binary", "nonbinary", "genderqueer", "they them", "gender non", "agender"]],

  // Decline / prefer not to say (applies to all EEO fields)
  [["prefer not", "decline", "don t wish", "do not wish", "choose not", "no answer", "not wish"],
   ["prefer not", "decline", "don t wish", "do not wish", "choose not", "not to answer", "no response", "i d rather not", "not disclose"]],

  // Race / Ethnicity
  [["hispanic", "latino", "latina", "latinx"],   ["hispanic", "latino", "latina", "latinx", "spanish"]],
  [["white", "caucasian"],                        ["white", "caucasian"]],
  [["black", "african american"],                 ["black", "african american", "african-american"]],
  [["asian"],                                     ["asian"]],
  [["american indian", "alaska native", "native american"], ["american indian", "alaska native", "native american", "indigenous"]],
  [["pacific islander", "native hawaiian"],       ["pacific islander", "native hawaiian", "pacific"]],
  [["two or more", "multiracial", "biracial", "mixed"], ["two or more", "multiracial", "biracial", "mixed race", "more than one"]],

  // Veteran status
  [["not a protected veteran", "not a veteran", "not veteran", "i am not"],
   ["not a protected", "not a veteran", "no veteran", "i am not", "non veteran"]],
  [["protected veteran", "i identify", "i am a veteran", "i identify as"],
   ["protected veteran", "i identify", "i am a veteran", "veteran who"]],

  // Disability
  [["no disability", "i do not have", "not disabled", "no i do not"],
   ["no disability", "do not have a disability", "i do not have", "not disabled", "no i do not", "no, i"]],
  [["yes disability", "i have a disability", "yes i have", "i have a"],
   ["yes i have", "i have a disability", "yes, i", "yes disability", "disabled"]],
]

/** Find the best matching option in a <select> for a given profile value. */
function findSelectOption(select: HTMLSelectElement, targetValue: string): HTMLOptionElement | null {
  const targetNorm = normStr(targetValue)
  if (!targetNorm) return null

  const opts = Array.from(select.options).filter((o) => o.value !== "" && o.index !== 0)

  // 1. Exact match on value or text
  for (const opt of opts) {
    if (normStr(opt.value) === targetNorm || normStr(opt.text) === targetNorm) return opt
  }

  // 2. Target starts with option text or vice versa
  for (const opt of opts) {
    const optNorm = normStr(opt.text)
    if (optNorm && (targetNorm.startsWith(optNorm) || optNorm.startsWith(targetNorm))) return opt
  }

  // 3. Contains relationship
  for (const opt of opts) {
    const optNorm = normStr(opt.text)
    if (optNorm && (targetNorm.includes(optNorm) || optNorm.includes(targetNorm))) return opt
  }

  // 4. Synonym map — search for the first synonym group whose canonical keywords
  //    appear in the target value, then look for option text containing synonym phrases
  for (const [canonicals, synonyms] of VALUE_SYNONYM_MAP) {
    const targetMatchesGroup = canonicals.some((c) => targetNorm.includes(normStr(c)))
    if (!targetMatchesGroup) continue

    for (const opt of opts) {
      const optNorm = normStr(opt.text)
      if (synonyms.some((s) => optNorm.includes(normStr(s)))) return opt
    }
  }

  return null
}

function fillField(elementRef: string, value: string): boolean {
  let el: HTMLElement | null = null
  try {
    el = document.querySelector<HTMLElement>(elementRef)
  } catch {
    return false
  }
  if (!el) return false

  const tag = el.tagName.toLowerCase()
  const type = ((el as HTMLInputElement).type ?? "").toLowerCase()

  // Never touch file inputs, submit, or hidden
  if (type === "file" || type === "submit" || type === "hidden") return false

  if (tag === "select") {
    const select = el as HTMLSelectElement
    const option = findSelectOption(select, value)
    if (option) {
      select.value = option.value
      select.dispatchEvent(new Event("change", { bubbles: true }))
      return true
    }
    return false
  }

  if (type === "checkbox" || type === "radio") {
    // For yes/no radio groups, we look for the sibling radio with matching label
    const check = /^(true|yes|1)$/i.test(value)
    const input = el as HTMLInputElement
    if (input.type === "radio") {
      // Try to find a radio in the same group that matches the value text
      const name = input.name
      if (name) {
        const siblings = Array.from(
          document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)
        )
        const targetNorm = normStr(value)
        for (const sibling of siblings) {
          const sibLabel =
            (sibling.id ? document.querySelector(`label[for="${sibling.id}"]`)?.textContent?.trim() : "") ??
            sibling.value
          const sibNorm = normStr(sibLabel)
          if (sibNorm && (sibNorm === targetNorm || targetNorm.includes(sibNorm) || sibNorm.includes(targetNorm))) {
            if (!sibling.checked) {
              sibling.checked = true
              sibling.dispatchEvent(new Event("change", { bubbles: true }))
            }
            return true
          }
        }
      }
    }
    // Fallback: boolean toggle
    if (input.checked !== check) {
      input.checked = check
      input.dispatchEvent(new Event("change", { bubbles: true }))
    }
    return true
  }

  if (tag === "textarea") {
    const ta = el as HTMLTextAreaElement
    nativeTextareaSetter?.call(ta, value)
    ta.dispatchEvent(new Event("input", { bubbles: true }))
    ta.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }

  // text / email / tel / url / number / date
  const input = el as HTMLInputElement
  nativeInputSetter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
  input.dispatchEvent(new Event("blur", { bubbles: true }))
  return true
}

// ── Message listener (fixes background → content bridge) ──────────────────────

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse: (r: ContentResponse) => void) => {
    switch (message.type) {
      case "DETECT_PAGE": {
        const page = detectPage()
        sendResponse({ type: "PAGE_DETECTED", page })
        break
      }

      case "EXTRACT_JOB": {
        const page = detectPage()
        const job = extractJob(page.ats)
        sendResponse({ type: "JOB_EXTRACTED", job })
        break
      }

      case "DETECT_FORM_FIELDS": {
        const page = detectPage()
        const result = detectFormFields(message.profile, page.ats)
        sendResponse({
          type: "FORM_FIELDS_DETECTED",
          formFound: result.formFound,
          fields: result.fields,
        })
        break
      }

      case "FILL_FORM_FIELDS": {
        let filledCount = 0
        let skippedCount = 0
        for (const { elementRef, value } of message.fields) {
          const filled = fillField(elementRef, value)
          if (filled) filledCount++
          else skippedCount++
        }
        sendResponse({ type: "FORM_FILLED", filledCount, skippedCount })
        break
      }

      default:
        sendResponse({ type: "ERROR", message: "Unknown message type" })
    }
    return true // keep channel open for async (synchronous here but required for MV3 compat)
  }
)

// ── Run immediately (content scripts load at document_idle) ──────────────────
void init()

// Also handle SPA navigations (pushState / hashchange)
let lastUrl = window.location.href
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href
    // Give the SPA time to render the new page
    setTimeout(() => void init(), 800)
  }
})
observer.observe(document.body, { childList: true, subtree: true })

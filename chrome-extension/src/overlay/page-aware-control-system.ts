import { sendToBackground } from "../bridge"
import { detectExtensionPageMode, detectPage, isLikelySearchResultsPage } from "../detectors/ats"
import { extractJobWithMeta } from "../extractors/job"
import type {
  AutofillExecuteResult,
  AutofillPreviewResult,
  CoverLetterResult,
  DetectedField,
  ExtensionCommand,
  ExtensionJobFingerprint,
  ExtensionPageMode,
  ExtractedJob,
  ResolveJobResult,
  SaveResult,
  ScoutOverlayResult,
  SessionResult,
  TailorApproveResult,
  TailorPreviewResult,
} from "../types"

interface PageAwareOptions {
  resolveAppOrigin: () => Promise<string>
}

type DrawerMode = "none" | "autofill" | "tailor" | "cover" | "match"

const COMMANDS_BY_MODE: Record<ExtensionPageMode, ExtensionCommand[]> = {
  job_detail: [
    "RESOLVE_JOB",
    "SAVE_JOB",
    "CHECK_MATCH",
    "TAILOR_RESUME",
    "GENERATE_COVER_LETTER",
    "OPEN_AUTOFILL_DRAWER",
    "OPEN_PROFILE_MENU",
    "OPEN_HIREOVEN",
  ],
  application_form: [
    "RESOLVE_JOB",
    "CHECK_MATCH",
    "TAILOR_RESUME",
    "GENERATE_COVER_LETTER",
    "OPEN_AUTOFILL_DRAWER",
    "FILL_SAFE_FIELDS",
    "OPEN_PROFILE_MENU",
    "OPEN_HIREOVEN",
  ],
  search_results: ["SAVE_JOB", "OPEN_PROFILE_MENU", "OPEN_HIREOVEN"],
  unknown: ["OPEN_PROFILE_MENU", "OPEN_HIREOVEN"],
}

const STYLE = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  .root {
    position: fixed;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    z-index: 2147483646;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    width: min(920px, calc(100vw - 24px));
    color: #f8fafc;
    pointer-events: none;
  }

  .surface {
    pointer-events: auto;
    background: #020617;
    border: 1px solid rgba(249, 115, 22, 0.45);
    border-radius: 18px;
    box-shadow: 0 10px 30px rgba(2, 6, 23, 0.45);
    padding: 7px;
  }

  .collapsed {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }

  .expand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(30, 41, 59, 0.65);
    color: #cbd5e1;
    cursor: pointer;
    font-size: 12px;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: #f97316;
    color: #111827;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.02em;
  }

  .summary {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    font-size: 12px;
    font-weight: 680;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    font-size: 10px;
    color: #cbd5e1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pill {
    font-size: 10px;
    font-weight: 700;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.4);
    padding: 3px 8px;
    white-space: nowrap;
  }

  .pill.found {
    border-color: rgba(34, 197, 94, 0.65);
    color: #86efac;
    background: rgba(20, 83, 45, 0.45);
  }

  .pill.new {
    border-color: rgba(249, 115, 22, 0.65);
    color: #fdba74;
    background: rgba(124, 45, 18, 0.35);
  }

  .pill.info {
    color: #cbd5e1;
    background: rgba(30, 41, 59, 0.5);
  }

  .primary {
    border: 1px solid #f97316;
    background: #f97316;
    color: #111827;
    min-height: 30px;
    border-radius: 10px;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 750;
    cursor: pointer;
    white-space: nowrap;
  }

  .primary:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .expanded {
    margin-top: 7px;
    border-top: 1px solid rgba(148, 163, 184, 0.28);
    padding-top: 7px;
    display: none;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }

  .expanded[data-open="true"] { display: flex; }

  .action {
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(30, 41, 59, 0.62);
    color: #e2e8f0;
    min-height: 30px;
    border-radius: 10px;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .action.orange {
    border-color: rgba(249, 115, 22, 0.62);
    color: #fdba74;
  }

  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .spacer { flex: 1; }

  .avatar-btn {
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(15, 23, 42, 0.9);
    color: #f1f5f9;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 780;
    cursor: pointer;
    overflow: hidden;
  }

  .avatar-btn img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .menu {
    position: absolute;
    right: 6px;
    bottom: 58px;
    min-width: 250px;
    background: #0b1120;
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 14px;
    box-shadow: 0 14px 28px rgba(2, 6, 23, 0.5);
    padding: 8px;
    display: none;
    pointer-events: auto;
  }

  .menu[data-open="true"] { display: block; }

  .menu-head {
    padding: 6px 8px 8px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.22);
    margin-bottom: 6px;
  }

  .menu-name {
    font-size: 12px;
    font-weight: 720;
    color: #f8fafc;
    line-height: 1.25;
  }

  .menu-email {
    font-size: 10px;
    color: #cbd5e1;
    margin-top: 2px;
  }

  .menu-btn {
    width: 100%;
    text-align: left;
    border: 1px solid transparent;
    background: transparent;
    color: #e2e8f0;
    border-radius: 9px;
    padding: 7px 8px;
    font-size: 11px;
    font-weight: 640;
    cursor: pointer;
  }

  .menu-btn:hover {
    border-color: rgba(148, 163, 184, 0.28);
    background: rgba(30, 41, 59, 0.45);
  }

  .drawer {
    margin-top: 8px;
    background: #0b1120;
    border: 1px solid rgba(148, 163, 184, 0.32);
    border-radius: 14px;
    box-shadow: 0 14px 28px rgba(2, 6, 23, 0.5);
    padding: 10px;
    display: none;
    pointer-events: auto;
    max-height: 58vh;
    overflow: auto;
  }

  .drawer[data-open="true"] { display: block; }

  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }

  .drawer-title {
    font-size: 12px;
    font-weight: 760;
    color: #f8fafc;
  }

  .drawer-sub {
    font-size: 10px;
    color: #cbd5e1;
    margin-top: 1px;
  }

  .close {
    border: 1px solid rgba(148, 163, 184, 0.32);
    background: rgba(30, 41, 59, 0.6);
    color: #e2e8f0;
    border-radius: 8px;
    min-height: 26px;
    padding: 0 8px;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .stat {
    font-size: 10px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    padding: 2px 7px;
    color: #cbd5e1;
    background: rgba(15, 23, 42, 0.5);
  }

  .row-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }

  .field-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
    border: 1px solid rgba(148, 163, 184, 0.26);
    border-radius: 10px;
    padding: 7px;
    background: rgba(15, 23, 42, 0.52);
  }

  .field-row.ready {
    border-color: rgba(34, 197, 94, 0.55);
    background: rgba(20, 83, 45, 0.35);
  }

  .field-row.review {
    border-color: rgba(234, 179, 8, 0.55);
    background: rgba(113, 63, 18, 0.28);
  }

  .field-row.missing {
    border-color: rgba(148, 163, 184, 0.38);
  }

  .field-title {
    font-size: 11px;
    font-weight: 680;
    color: #f8fafc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .field-meta {
    font-size: 10px;
    color: #cbd5e1;
    margin-top: 1px;
  }

  .field-value {
    font-size: 10px;
    color: #e2e8f0;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .field-status {
    font-size: 10px;
    font-weight: 700;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.38);
    padding: 2px 7px;
    align-self: start;
    white-space: nowrap;
  }

  .field-status.ready { border-color: rgba(34, 197, 94, 0.68); color: #86efac; }
  .field-status.review { border-color: rgba(251, 191, 36, 0.68); color: #fde68a; }
  .field-status.missing { color: #cbd5e1; }

  .drawer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }

  .btn {
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(30, 41, 59, 0.62);
    color: #e2e8f0;
    min-height: 29px;
    border-radius: 9px;
    padding: 0 9px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn.orange {
    border-color: rgba(249, 115, 22, 0.62);
    background: #f97316;
    color: #111827;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .muted {
    font-size: 10px;
    color: #cbd5e1;
    line-height: 1.45;
  }

  .changes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 7px 0;
  }

  .change {
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 9px;
    padding: 7px;
    background: rgba(15, 23, 42, 0.48);
  }

  .change-sec {
    font-size: 10px;
    color: #fdba74;
    font-weight: 720;
    margin-bottom: 2px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .change-text {
    font-size: 10px;
    color: #e2e8f0;
    line-height: 1.42;
  }

  .cover-text {
    width: 100%;
    min-height: 180px;
    border-radius: 9px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(15, 23, 42, 0.62);
    color: #f8fafc;
    padding: 8px;
    font-size: 10px;
    line-height: 1.45;
    resize: vertical;
  }

  .warn {
    border: 1px solid rgba(251, 191, 36, 0.45);
    background: rgba(113, 63, 18, 0.35);
    border-radius: 9px;
    padding: 6px 7px;
    font-size: 10px;
    color: #fde68a;
    line-height: 1.4;
    margin-top: 7px;
  }

  @media (max-width: 720px) {
    .root { width: calc(100vw - 10px); bottom: 8px; }
    .surface { border-radius: 14px; }
    .menu { right: 0; left: 0; min-width: 0; }
    .drawer { max-height: 52vh; }
  }
`

function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
}

function trimText(value: string | null | undefined, max = 72): string {
  const raw = (value ?? "").trim()
  if (!raw) return ""
  if (raw.length <= max) return raw
  return `${raw.slice(0, max - 1)}…`
}

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const base = (name ?? "").trim() || (email?.split("@")[0] ?? "")
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
  if (parts.length === 1 && parts[0]) return parts[0].slice(0, 2).toUpperCase()
  return "HO"
}

function externalJobIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    for (const key of ["gh_jid", "jobId", "job_id", "reqId", "req_id", "opening_id", "posting_id"]) {
      const v = parsed.searchParams.get(key)
      if (v?.trim()) return v.trim()
    }
    const linkedin = parsed.pathname.match(/\/jobs\/view\/(\d+)/)
    if (linkedin?.[1]) return linkedin[1]
    const glassdoor = parsed.pathname.match(/_JK([A-Za-z0-9]+)\./)
    if (glassdoor?.[1]) return glassdoor[1]
    const icims = parsed.pathname.match(/\/job\/([^/?#]+)/i)
    if (icims?.[1]) return icims[1]
  } catch {
    // ignore invalid URLs
  }
  return null
}

function hasReachableApplySurface(): boolean {
  const formSelectors = [
    "form[action*='apply']",
    "form[id*='apply']",
    "form[class*='apply']",
    "[id*='application-form']",
    "[class*='application-form']",
  ]
  for (const selector of formSelectors) {
    if (document.querySelector(selector)) return true
  }

  const actions = Array.from(document.querySelectorAll<HTMLElement>("a,button")).slice(0, 120)
  return actions.some((node) => /apply|easy apply|start application|continue application/i.test(node.textContent ?? ""))
}

export class PageAwareControlSystem {
  private readonly options: PageAwareOptions
  private readonly host: HTMLElement
  private readonly shadow: ShadowRoot
  private readonly root: HTMLElement

  private appOrigin = "http://localhost:3000"
  private authenticated = false
  private user: SessionResult["user"] = null

  private mode: ExtensionPageMode = "unknown"
  private pageTitle: string | null = null
  private atsLabel = "Generic"
  private hasReachableForm = false
  private job: ExtractedJob | null = null
  private resolved: ResolveJobResult | null = null
  private jobId: string | null = null

  private expanded = false
  private profileOpen = false
  private drawer: DrawerMode = "none"
  private statusLine = ""

  private autofill: AutofillPreviewResult | null = null
  private tailor: TailorPreviewResult | null = null
  private coverLetterText = ""
  private coverLetterFieldRef: string | null = null
  private approvedTailoredVersion: string | null = null
  private currentTailorResumeId: string | null = null

  private matchSummary = ""
  private matchVisa = ""

  private urlPollTimer: number | null = null
  private lastUrl = window.location.href
  private busy = new Set<ExtensionCommand>()

  constructor(options: PageAwareOptions) {
    this.options = options

    this.host = document.createElement("div")
    this.host.id = "hireoven-page-aware-controls"
    document.body.appendChild(this.host)

    this.shadow = this.host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = STYLE
    this.shadow.appendChild(style)

    this.root = document.createElement("div")
    this.root.className = "root"
    this.shadow.appendChild(this.root)
  }

  async mount(): Promise<void> {
    this.appOrigin = await this.options.resolveAppOrigin()
    await this.refreshContext(true)
    this.urlPollTimer = window.setInterval(() => {
      if (window.location.href === this.lastUrl) return
      this.lastUrl = window.location.href
      this.expanded = false
      this.drawer = "none"
      this.profileOpen = false
      this.autofill = null
      this.tailor = null
      this.coverLetterText = ""
      this.coverLetterFieldRef = null
      this.matchSummary = ""
      this.matchVisa = ""
      void this.refreshContext(true)
    }, 520)
  }

  destroy(): void {
    if (this.urlPollTimer) window.clearInterval(this.urlPollTimer)
    this.host.remove()
  }

  private modeLabel(): string {
    if (this.mode === "job_detail") return "Job detail"
    if (this.mode === "application_form") return "Application form"
    if (this.mode === "search_results") return "Search results"
    return "Unknown page"
  }

  private resolveAvatarUrl(raw: string | null | undefined): string | null {
    if (!raw?.trim()) return null
    const value = raw.trim()
    if (/^https?:\/\//i.test(value)) return value
    if (value.startsWith("/")) return `${this.appOrigin}${value}`
    return `${this.appOrigin}/${value}`
  }

  private statusPill(): { label: string; cls: string } {
    if (!this.authenticated) return { label: "Sign in", cls: "info" }
    if (this.mode === "unknown") return { label: "Detection only", cls: "info" }
    if (this.resolved?.exists && this.resolved.jobId) return { label: "Found in Hireoven", cls: "found" }
    if (this.mode === "search_results") return { label: "Search page", cls: "info" }
    return { label: "Not saved", cls: "new" }
  }

  private currentTitle(): string {
    if (this.job?.title?.trim()) return this.job.title.trim()
    if (this.pageTitle?.trim()) return this.pageTitle.trim()
    return "Hireoven Scout"
  }

  private currentCompany(): string {
    if (this.job?.company?.trim()) return this.job.company.trim()
    if (this.mode === "unknown") return "Page not identified"
    return `${this.modeLabel()} · ${this.atsLabel}`
  }

  private primaryActionLabel(): string {
    if (!this.authenticated) return "Sign in"
    if (this.mode === "application_form") return "Autofill"
    if (this.mode === "job_detail") {
      if (this.resolved?.exists) return "Tailor"
      return "Save"
    }
    if (this.mode === "search_results") return "Save"
    return "Open Hireoven"
  }

  private primaryAction(): ExtensionCommand | "SIGN_IN" | "NOOP" {
    if (!this.authenticated) return "SIGN_IN"
    if (this.mode === "application_form") return "OPEN_AUTOFILL_DRAWER"
    if (this.mode === "job_detail") {
      if (this.resolved?.exists) return "TAILOR_RESUME"
      return "SAVE_JOB"
    }
    if (this.mode === "search_results") return "SAVE_JOB"
    return "OPEN_HIREOVEN"
  }

  private commandInMode(command: ExtensionCommand): boolean {
    return COMMANDS_BY_MODE[this.mode].includes(command)
  }

  private canRun(command: ExtensionCommand): boolean {
    if (!this.commandInMode(command)) return false

    if (command === "OPEN_PROFILE_MENU") return true
    if (command === "OPEN_HIREOVEN") return true

    if (!this.authenticated) return false

    if (command === "OPEN_AUTOFILL_DRAWER") {
      return this.mode === "application_form" || this.hasReachableForm
    }

    if (command === "FILL_SAFE_FIELDS") return this.mode === "application_form"

    if (command === "SAVE_JOB") return Boolean(this.job)
    if (command === "RESOLVE_JOB") return Boolean(this.job)
    if (command === "CHECK_MATCH") return this.mode === "job_detail" || this.mode === "application_form"
    if (command === "TAILOR_RESUME") return this.mode === "job_detail" || this.mode === "application_form"
    if (command === "GENERATE_COVER_LETTER") return this.mode === "job_detail" || this.mode === "application_form"

    return true
  }

  private isBusy(command: ExtensionCommand): boolean {
    return this.busy.has(command)
  }

  private runWithBusy<T>(command: ExtensionCommand, task: () => Promise<T>): Promise<T> {
    this.busy.add(command)
    this.render()
    return task().finally(() => {
      this.busy.delete(command)
      this.render()
    })
  }

  private async refreshContext(refreshSession: boolean): Promise<void> {
    this.mode = detectExtensionPageMode()
    const page = detectPage()
    this.pageTitle = page.title
    this.atsLabel = page.ats === "generic" ? "Generic" : page.ats
    this.hasReachableForm = page.pageType === "application_form" || hasReachableApplySurface()

    const extracted = extractJobWithMeta(page.ats).job
    if (this.mode === "unknown" && isLikelySearchResultsPage()) {
      this.mode = "search_results"
    }

    if (
      this.mode === "job_detail" ||
      this.mode === "application_form" ||
      this.mode === "search_results"
    ) {
      this.job = extracted
    } else {
      this.job = null
    }

    if (refreshSession) {
      try {
        const raw = await sendToBackground({ type: "GET_SESSION" })
        const session = raw as SessionResult
        this.authenticated = Boolean(session.authenticated)
        this.user = session.user ?? null
      } catch {
        this.authenticated = false
        this.user = null
      }
    }

    if (!this.authenticated) {
      this.resolved = null
      this.jobId = null
      this.statusLine = this.mode === "unknown"
        ? "Sign in to enable actions. Page detection is still active."
        : `${this.modeLabel()} detected · sign in to use controls.`
      this.render()
      return
    }

    if (this.job && (this.mode === "job_detail" || this.mode === "application_form")) {
      await this.resolveJobIfPossible(false)
    } else {
      this.resolved = null
      this.jobId = null
    }

    this.statusLine = this.resolved?.exists
      ? "Job context linked. Actions run directly on this page."
      : this.mode === "application_form"
      ? "Application form detected. Autofill requires explicit click."
      : this.mode === "search_results"
      ? "Search page detected. Open a job detail for full actions."
      : "Job context ready. Save to enable matching and tailoring."

    this.render()
  }

  private buildFingerprint(): ExtensionJobFingerprint | null {
    if (!this.job) return null
    const sourceUrl = window.location.href
    const applyUrl = this.job.url || sourceUrl
    return {
      sourceUrl,
      applyUrl,
      atsProvider: this.job.ats,
      externalJobId: externalJobIdFromUrl(applyUrl) ?? externalJobIdFromUrl(sourceUrl),
      title: this.job.title,
      company: this.job.company,
    }
  }

  private async resolveJobIfPossible(force: boolean): Promise<void> {
    if (!this.canRun("RESOLVE_JOB")) return
    if (!force && this.resolved?.exists) return

    const fingerprint = this.buildFingerprint()
    if (!fingerprint) return

    await this.runWithBusy("RESOLVE_JOB", async () => {
      try {
        const raw = await sendToBackground({
          type: "RESOLVE_JOB",
          fingerprint,
        })
        const result = raw as ResolveJobResult
        this.resolved = result
        this.jobId = result.jobId ?? this.jobId
        if (result.jobId) {
          void chrome.storage.local.set({ lastJobId: result.jobId })
        }
      } catch {
        this.resolved = {
          type: "RESOLVE_JOB_RESULT",
          exists: false,
          status: "needs_import",
        }
      }
    })
  }

  private async saveCurrentJob(): Promise<boolean> {
    if (!this.canRun("SAVE_JOB") || !this.job) return false
    if (this.resolved?.exists && this.jobId) {
      this.statusLine = "Found in Hireoven. Using existing job context."
      this.render()
      return true
    }

    const fingerprint = this.buildFingerprint()
    const payload = {
      ...this.job,
      sourceUrl: fingerprint?.sourceUrl,
      applyUrl: fingerprint?.applyUrl,
      externalJobId: fingerprint?.externalJobId,
      ats: this.job.ats,
      url: fingerprint?.applyUrl ?? this.job.url,
    }

    const ok = await this.runWithBusy("SAVE_JOB", async () => {
      try {
        const raw = await sendToBackground({
          type: "SAVE_JOB",
          job: payload,
        })
        const result = raw as SaveResult
        if (result.saved) {
          this.jobId = result.jobId ?? this.jobId
          this.resolved = {
            type: "RESOLVE_JOB_RESULT",
            exists: true,
            jobId: this.jobId ?? undefined,
            status: "created",
          }
          if (this.jobId) {
            void chrome.storage.local.set({ lastJobId: this.jobId })
          }
          this.statusLine = "Saved to Hireoven. You can now match, tailor, and generate cover letters here."
          return true
        }
      } catch {
        // ignore
      }
      this.statusLine = "Could not save this job yet."
      return false
    })

    return ok
  }

  private async ensureJobId(): Promise<string | null> {
    if (this.jobId) return this.jobId
    await this.resolveJobIfPossible(false)
    if (this.jobId) return this.jobId
    const saved = await this.saveCurrentJob()
    if (!saved) return null
    return this.jobId
  }

  private async openAutofillDrawer(): Promise<void> {
    if (!this.canRun("OPEN_AUTOFILL_DRAWER")) return
    this.drawer = "autofill"
    this.statusLine = "Autofill preview is review-first and never submits automatically."
    this.render()
    await this.loadAutofillPreview()
  }

  private async loadAutofillPreview(): Promise<void> {
    await this.runWithBusy("OPEN_AUTOFILL_DRAWER", async () => {
      try {
        const raw = await sendToBackground({ type: "GET_AUTOFILL_PREVIEW" })
        this.autofill = raw as AutofillPreviewResult

        const coverField = this.autofill.fields.find((f) => f.suggestedProfileKey === "cover_letter_text")
        this.coverLetterFieldRef = coverField?.elementRef ?? null
      } catch {
        this.autofill = {
          type: "AUTOFILL_PREVIEW_RESULT",
          formFound: false,
          ats: "generic",
          totalFields: 0,
          matchedFields: 0,
          reviewFields: 0,
          fields: [],
          profileMissing: false,
        }
      }
    })
  }

  private safeFieldsToFill(fields: DetectedField[]): Array<{ elementRef: string; value: string }> {
    return fields
      .filter((f) => {
        if (!f.elementRef || !f.detectedValue) return false
        if (f.type === "file") return false
        if (f.needsReview) return false
        if (f.confidence < 0.65) return false
        if (f.suggestedProfileKey === "cover_letter" || f.suggestedProfileKey === "cover_letter_text") return false
        return true
      })
      .map((f) => ({ elementRef: f.elementRef, value: f.detectedValue }))
  }

  private async fillSafeFields(): Promise<void> {
    if (!this.canRun("FILL_SAFE_FIELDS") || !this.autofill) return
    const safe = this.safeFieldsToFill(this.autofill.fields)
    if (safe.length === 0) {
      this.statusLine = "No safe high-confidence fields to fill. Review fields manually."
      this.render()
      return
    }

    await this.runWithBusy("FILL_SAFE_FIELDS", async () => {
      try {
        const raw = await sendToBackground({ type: "EXECUTE_AUTOFILL", fields: safe })
        const result = raw as AutofillExecuteResult
        this.statusLine = `${result.filledCount} safe field${result.filledCount === 1 ? "" : "s"} filled. Review before submit.`
      } catch {
        this.statusLine = "Autofill failed. Please retry."
      }
    })
  }

  private async checkMatch(): Promise<void> {
    if (!this.canRun("CHECK_MATCH")) return
    const jobId = await this.ensureJobId()
    if (!jobId) {
      this.statusLine = "Save this job first to run match intelligence."
      this.render()
      return
    }

    this.drawer = "match"
    this.matchSummary = "Loading match insights..."
    this.matchVisa = ""
    this.render()

    await this.runWithBusy("CHECK_MATCH", async () => {
      try {
        const raw = await sendToBackground({ type: "GET_SCOUT_OVERLAY", jobId })
        const result = raw as ScoutOverlayResult
        if (result.type === "SCOUT_OVERLAY_RESULT" && result.ok) {
          const pct = result.matchPercent == null ? "--" : `${Math.round(result.matchPercent)}%`
          this.matchSummary = `Match ${pct} · missing ${result.missingSkills.length} skill${result.missingSkills.length === 1 ? "" : "s"}`
          this.matchVisa = result.sponsorshipLabel ?? (result.sponsorshipLikely ? "Visa likely" : "No visa signal")
          this.statusLine = "Match check complete."
        } else {
          this.matchSummary = "Match is not ready yet."
          this.matchVisa = !result.ok ? (result.message ?? "Run again after save/import finishes.") : "Run again after save/import finishes."
        }
      } catch {
        this.matchSummary = "Could not run match right now."
        this.matchVisa = "Try again."
      }
    })
  }

  private async openTailorDrawer(): Promise<void> {
    if (!this.canRun("TAILOR_RESUME")) return
    const jobId = await this.ensureJobId()
    if (!jobId) {
      this.statusLine = "Could not resolve this job. Save it first."
      this.render()
      return
    }

    this.drawer = "tailor"
    this.statusLine = "Tailor preview is read-only until you approve a tailored version."
    this.render()

    await this.runWithBusy("TAILOR_RESUME", async () => {
      try {
        const raw = await sendToBackground({
          type: "GET_TAILOR_PREVIEW",
          jobId,
          resumeId: this.currentTailorResumeId ?? undefined,
          ats: this.job?.ats,
        })
        this.tailor = raw as TailorPreviewResult
        this.currentTailorResumeId = this.tailor.resumeId ?? this.currentTailorResumeId
      } catch {
        this.tailor = {
          type: "TAILOR_PREVIEW_RESULT",
          status: "missing_job_context",
          summary: "Could not load tailor preview.",
          atsTip: null,
          atsName: null,
          resumeId: null,
          resumeName: null,
          jobTitle: null,
          company: null,
          matchScore: null,
          changesPreview: [],
        }
      }
    })
  }

  private async approveTailoredResume(): Promise<void> {
    if (!this.tailor || !this.jobId) return

    await this.runWithBusy("TAILOR_RESUME", async () => {
      try {
        const raw = await sendToBackground({
          type: "APPROVE_TAILORED_RESUME",
          jobId: this.jobId!,
          resumeId: this.currentTailorResumeId ?? undefined,
          ats: this.job?.ats,
        })
        const result = raw as TailorApproveResult
        if (result.success) {
          this.approvedTailoredVersion = result.versionName ?? "Tailored resume ready"
          this.statusLine = "Tailored version approved. Original resume was not modified."
          this.currentTailorResumeId = result.resumeId ?? this.currentTailorResumeId
        } else {
          this.statusLine = result.error ?? "Could not approve tailored resume."
        }
      } catch {
        this.statusLine = "Could not approve tailored resume."
      }
    })
  }

  private async openCoverDrawer(): Promise<void> {
    if (!this.canRun("GENERATE_COVER_LETTER")) return
    const jobId = await this.ensureJobId()
    if (!jobId) {
      this.statusLine = "Save this job first to generate a cover letter."
      this.render()
      return
    }

    this.drawer = "cover"
    this.coverLetterText = ""
    this.statusLine = "Generate a draft, review it, then insert manually or click insert."
    this.render()
    await this.generateCoverLetter(jobId)
  }

  private async generateCoverLetter(jobId: string): Promise<void> {
    await this.runWithBusy("GENERATE_COVER_LETTER", async () => {
      try {
        const raw = await sendToBackground({
          type: "GENERATE_COVER_LETTER",
          jobId,
          resumeId: this.currentTailorResumeId ?? undefined,
          ats: this.job?.ats,
        })
        const result = raw as CoverLetterResult
        if (result.success && result.coverLetter) {
          this.coverLetterText = result.coverLetter
          this.statusLine = "Cover letter generated. Review before inserting."
        } else {
          this.coverLetterText = result.error ?? "Could not generate cover letter."
        }
      } catch {
        this.coverLetterText = "Could not generate cover letter."
      }
    })
  }

  private async insertCoverLetter(): Promise<void> {
    if (!this.coverLetterText.trim()) return

    if (!this.coverLetterFieldRef) {
      if (!this.autofill) await this.loadAutofillPreview()
      const coverField = this.autofill?.fields.find((f) => f.suggestedProfileKey === "cover_letter_text")
      this.coverLetterFieldRef = coverField?.elementRef ?? null
    }

    if (!this.coverLetterFieldRef) {
      this.statusLine = "No cover letter text field detected on this page."
      this.render()
      return
    }

    await this.runWithBusy("GENERATE_COVER_LETTER", async () => {
      try {
        await sendToBackground({
          type: "FILL_COVER_LETTER",
          elementRef: this.coverLetterFieldRef!,
          text: this.coverLetterText,
        })
        this.statusLine = "Cover letter inserted. Review before submit."
      } catch {
        this.statusLine = "Could not insert cover letter field."
      }
    })
  }

  private navigate(path: string): void {
    chrome.tabs.create({ url: `${this.appOrigin}${path}` })
  }

  private openHireovenJob(): void {
    if (this.jobId) {
      this.navigate(`/dashboard/jobs/${encodeURIComponent(this.jobId)}`)
      return
    }
    this.navigate("/dashboard")
  }

  private async onAction(action: string): Promise<void> {
    switch (action) {
      case "toggle-expand":
        this.expanded = !this.expanded
        if (!this.expanded) {
          this.drawer = "none"
          this.profileOpen = false
        }
        this.render()
        return

      case "primary": {
        const primary = this.primaryAction()
        if (primary === "SIGN_IN") {
          this.navigate("/login")
          return
        }
        if (primary === "SAVE_JOB") {
          await this.saveCurrentJob()
          return
        }
        if (primary === "OPEN_AUTOFILL_DRAWER") {
          await this.openAutofillDrawer()
          return
        }
        if (primary === "TAILOR_RESUME") {
          await this.openTailorDrawer()
          return
        }
        if (primary === "OPEN_HIREOVEN") {
          this.navigate("/dashboard")
          return
        }
        return
      }

      case "save":
        await this.saveCurrentJob()
        return

      case "match":
        await this.checkMatch()
        return

      case "tailor":
        await this.openTailorDrawer()
        return

      case "cover":
        await this.openCoverDrawer()
        return

      case "autofill":
        await this.openAutofillDrawer()
        return

      case "review-fields":
        this.drawer = "autofill"
        this.render()
        this.root.querySelector(".row-list")?.scrollIntoView({ behavior: "smooth", block: "nearest" })
        return

      case "compare":
        this.statusLine = "Compare is available in Hireoven."
        this.render()
        return

      case "queue-apply":
        this.statusLine = "Queue apply is tracked only; no submission is performed."
        this.render()
        return

      case "open-hireoven":
        this.openHireovenJob()
        return

      case "profile-toggle":
        this.profileOpen = !this.profileOpen
        this.render()
        return

      case "menu-open-hireoven":
        this.navigate("/dashboard")
        return

      case "menu-autofill-profile":
        this.navigate("/dashboard/autofill")
        return

      case "menu-resume":
        this.navigate("/dashboard/resumes")
        return

      case "menu-settings":
        this.navigate("/dashboard/settings")
        return

      case "menu-logout":
        this.navigate("/logout")
        return

      case "close-drawer":
        this.drawer = "none"
        this.render()
        return

      case "fill-safe":
        await this.fillSafeFields()
        return

      case "reload-autofill":
        await this.loadAutofillPreview()
        return

      case "approve-tailor":
        await this.approveTailoredResume()
        return

      case "open-tailor-editor":
        if (this.jobId) {
          this.navigate(`/dashboard/resume/studio?mode=tailor&jobId=${encodeURIComponent(this.jobId)}`)
        }
        return

      case "generate-cover": {
        const jobId = await this.ensureJobId()
        if (jobId) await this.generateCoverLetter(jobId)
        return
      }

      case "copy-cover":
        if (this.coverLetterText.trim()) {
          try {
            await navigator.clipboard.writeText(this.coverLetterText)
            this.statusLine = "Cover letter copied to clipboard."
          } catch {
            this.statusLine = "Clipboard copy failed. Select text and copy manually."
          }
          this.render()
        }
        return

      case "insert-cover":
        await this.insertCoverLetter()
        return

      case "signin":
        this.navigate("/login")
        return

      default:
        return
    }
  }

  private fieldStatus(field: DetectedField): "ready" | "review" | "missing" {
    if (!field.detectedValue) return "missing"
    if (field.type === "file") return "review"
    if (field.needsReview) return "review"
    if (field.confidence < 0.65) return "review"
    return "ready"
  }

  private renderAutofillDrawer(): string {
    if (this.drawer !== "autofill") return ""

    const preview = this.autofill
    if (!preview) {
      return `
        <section class="drawer" data-open="true">
          <div class="drawer-head">
            <div>
              <div class="drawer-title">Autofill</div>
              <div class="drawer-sub">Loading detected fields...</div>
            </div>
            <button class="close" data-action="close-drawer">Close</button>
          </div>
        </section>
      `
    }

    if (preview.profileMissing) {
      return `
        <section class="drawer" data-open="true">
          <div class="drawer-head">
            <div>
              <div class="drawer-title">Autofill</div>
              <div class="drawer-sub">No autofill profile found.</div>
            </div>
            <button class="close" data-action="close-drawer">Close</button>
          </div>
          <div class="drawer-actions">
            <button class="btn orange" data-action="menu-autofill-profile">Open Autofill Profile</button>
          </div>
        </section>
      `
    }

    const rows = preview.fields
      .map((field) => {
        const status = this.fieldStatus(field)
        const statusText =
          status === "ready" ? "ready" : status === "review" ? "review needed" : "missing profile data"
        const displayValue = field.detectedValue || "No profile value"
        return `
          <div class="field-row ${status}">
            <div>
              <div class="field-title">${esc(field.label || "Field")}</div>
              <div class="field-meta">${esc(field.type)} · ${Math.round(field.confidence * 100)}% confidence</div>
              <div class="field-value">${esc(trimText(displayValue, 90))}</div>
            </div>
            <span class="field-status ${status}">${esc(statusText)}</span>
          </div>
        `
      })
      .join("")

    const safeFillCount = this.safeFieldsToFill(preview.fields).length

    return `
      <section class="drawer" data-open="true">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">Autofill</div>
            <div class="drawer-sub">Detected ATS: ${esc(preview.ats || "generic")}</div>
          </div>
          <button class="close" data-action="close-drawer">Close</button>
        </div>
        <div class="stats">
          <span class="stat">${preview.totalFields} detected</span>
          <span class="stat">${preview.matchedFields} matched</span>
          <span class="stat">${preview.reviewFields} need review</span>
        </div>
        <div class="row-list">${rows}</div>
        <div class="warn">Never auto-submit. Resume upload/attachment always requires explicit user action.</div>
        <div class="drawer-actions">
          <button class="btn orange" data-action="fill-safe" ${safeFillCount === 0 || this.isBusy("FILL_SAFE_FIELDS") ? "disabled" : ""}>${this.isBusy("FILL_SAFE_FIELDS") ? "Filling..." : `Fill safe fields (${safeFillCount})`}</button>
          <button class="btn" data-action="review-fields">Review unmapped fields</button>
          <button class="btn" data-action="reload-autofill" ${this.isBusy("OPEN_AUTOFILL_DRAWER") ? "disabled" : ""}>Refresh</button>
        </div>
      </section>
    `
  }

  private renderTailorDrawer(): string {
    if (this.drawer !== "tailor") return ""

    const preview = this.tailor
    if (!preview) {
      return `
        <section class="drawer" data-open="true">
          <div class="drawer-head">
            <div>
              <div class="drawer-title">Tailor Resume</div>
              <div class="drawer-sub">Loading preview...</div>
            </div>
            <button class="close" data-action="close-drawer">Close</button>
          </div>
        </section>
      `
    }

    const changes = preview.changesPreview
      .slice(0, 8)
      .map((change) => `
        <div class="change">
          <div class="change-sec">${esc(change.section)}</div>
          <div class="change-text">${esc(trimText(change.after ?? change.reason ?? "", 220))}</div>
        </div>
      `)
      .join("")

    return `
      <section class="drawer" data-open="true">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">Tailor Resume</div>
            <div class="drawer-sub">${esc(preview.atsName ?? "ATS-aware preview")}</div>
          </div>
          <button class="close" data-action="close-drawer">Close</button>
        </div>
        <div class="muted">${esc(preview.summary)}</div>
        ${preview.matchScore != null ? `<div class="stats"><span class="stat">${preview.matchScore}% match</span></div>` : ""}
        ${changes ? `<div class="changes">${changes}</div>` : ""}
        ${this.approvedTailoredVersion ? `<div class="warn">Using tailored version: ${esc(this.approvedTailoredVersion)}. Original resume remains unchanged.</div>` : ""}
        <div class="drawer-actions">
          <button class="btn orange" data-action="approve-tailor" ${this.isBusy("TAILOR_RESUME") || preview.status !== "ready" ? "disabled" : ""}>${this.isBusy("TAILOR_RESUME") ? "Saving..." : "Use tailored resume for this application"}</button>
          <button class="btn" data-action="tailor" ${this.isBusy("TAILOR_RESUME") ? "disabled" : ""}>Preview changes</button>
          <button class="btn" data-action="open-tailor-editor">Open full editor in Hireoven</button>
        </div>
      </section>
    `
  }

  private renderCoverDrawer(): string {
    if (this.drawer !== "cover") return ""

    return `
      <section class="drawer" data-open="true">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">Cover Letter</div>
            <div class="drawer-sub">Generated using current job context</div>
          </div>
          <button class="close" data-action="close-drawer">Close</button>
        </div>
        <textarea class="cover-text" data-role="cover-text">${esc(this.coverLetterText)}</textarea>
        <div class="drawer-actions">
          <button class="btn orange" data-action="generate-cover" ${this.isBusy("GENERATE_COVER_LETTER") ? "disabled" : ""}>${this.isBusy("GENERATE_COVER_LETTER") ? "Generating..." : "Generate / Refresh"}</button>
          <button class="btn" data-action="copy-cover" ${!this.coverLetterText.trim() ? "disabled" : ""}>Copy</button>
          <button class="btn" data-action="insert-cover" ${!this.coverLetterText.trim() ? "disabled" : ""}>Insert into field</button>
        </div>
        <div class="warn">No auto-submit. Insertion requires explicit click and only targets detected cover-letter fields.</div>
      </section>
    `
  }

  private renderMatchDrawer(): string {
    if (this.drawer !== "match") return ""

    return `
      <section class="drawer" data-open="true">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">Match Check</div>
            <div class="drawer-sub">Job intelligence</div>
          </div>
          <button class="close" data-action="close-drawer">Close</button>
        </div>
        <div class="stats">
          <span class="stat">${esc(this.matchSummary || "Not computed yet")}</span>
          <span class="stat">${esc(this.matchVisa || "No visa signal")}</span>
        </div>
        <div class="drawer-actions">
          <button class="btn orange" data-action="match" ${this.isBusy("CHECK_MATCH") ? "disabled" : ""}>${this.isBusy("CHECK_MATCH") ? "Checking..." : "Refresh match"}</button>
        </div>
      </section>
    `
  }

  private renderExpandedActions(): string {
    const jobMode = this.mode === "job_detail"
    const appMode = this.mode === "application_form"

    const saveDisabled = !this.canRun("SAVE_JOB") || this.isBusy("SAVE_JOB") || Boolean(this.resolved?.exists)
    const matchDisabled = !this.canRun("CHECK_MATCH") || this.isBusy("CHECK_MATCH")
    const tailorDisabled = !this.canRun("TAILOR_RESUME") || this.isBusy("TAILOR_RESUME")
    const coverDisabled = !this.canRun("GENERATE_COVER_LETTER") || this.isBusy("GENERATE_COVER_LETTER")
    const autofillDisabled = !this.canRun("OPEN_AUTOFILL_DRAWER") || this.isBusy("OPEN_AUTOFILL_DRAWER")

    const jobActions = `
      <button class="action" data-action="save" ${saveDisabled ? "disabled" : ""}>${this.resolved?.exists ? "Saved" : this.isBusy("SAVE_JOB") ? "Saving..." : "Save"}</button>
      <button class="action" data-action="match" ${matchDisabled ? "disabled" : ""}>${this.isBusy("CHECK_MATCH") ? "Checking..." : "Match"}</button>
      <button class="action" data-action="tailor" ${tailorDisabled ? "disabled" : ""}>Tailor</button>
      <button class="action" data-action="cover" ${coverDisabled ? "disabled" : ""}>Cover Letter</button>
      <button class="action" data-action="compare">Compare</button>
      <button class="action" data-action="queue-apply">Queue apply</button>
      ${this.hasReachableForm ? `<button class="action orange" data-action="autofill" ${autofillDisabled ? "disabled" : ""}>Autofill</button>` : ""}
    `

    const appActions = `
      <button class="action orange" data-action="autofill" ${autofillDisabled ? "disabled" : ""}>Autofill</button>
      <button class="action" data-action="tailor" ${tailorDisabled ? "disabled" : ""}>Tailor</button>
      <button class="action" data-action="cover" ${coverDisabled ? "disabled" : ""}>Cover Letter</button>
      <button class="action" data-action="review-fields">Review fields</button>
      <button class="action" data-action="save" ${saveDisabled ? "disabled" : ""}>${this.resolved?.exists ? "Saved" : "Save"}</button>
    `

    const searchActions = `
      <button class="action" data-action="save" ${saveDisabled ? "disabled" : ""}>${this.resolved?.exists ? "Saved" : this.isBusy("SAVE_JOB") ? "Saving..." : "Save"}</button>
      <button class="action" data-action="open-hireoven">Open Hireoven</button>
    `

    const unknownActions = `
      <button class="action" data-action="open-hireoven">Open Hireoven</button>
    `

    if (jobMode) return jobActions
    if (appMode) return appActions
    if (this.mode === "search_results") return searchActions
    return unknownActions
  }

  private renderMenu(): string {
    const name = this.user?.fullName ?? "Hireoven User"
    const email = this.user?.email ?? ""
    return `
      <div class="menu" data-open="${this.profileOpen ? "true" : "false"}">
        <div class="menu-head">
          <div class="menu-name">${esc(name)}</div>
          <div class="menu-email">${esc(email)}</div>
        </div>
        <button class="menu-btn" data-action="menu-open-hireoven">Open Hireoven</button>
        <button class="menu-btn" data-action="menu-autofill-profile">Autofill profile</button>
        <button class="menu-btn" data-action="menu-resume">Resume library</button>
        <button class="menu-btn" data-action="menu-settings">Settings</button>
        <button class="menu-btn" data-action="menu-logout">Logout / disconnect extension</button>
      </div>
    `
  }

  private render(): void {
    const pill = this.statusPill()
    const mainTitle = trimText(this.currentTitle(), 66)
    const subTitle = trimText(this.currentCompany(), 74)
    const primary = this.primaryAction()
    const primaryDisabled =
      primary === "NOOP"
        ? true
        : primary === "SIGN_IN"
        ? false
        : (primary as ExtensionCommand) === "SAVE_JOB"
        ? !this.canRun("SAVE_JOB") || this.isBusy("SAVE_JOB")
        : (primary as ExtensionCommand) === "OPEN_AUTOFILL_DRAWER"
        ? !this.canRun("OPEN_AUTOFILL_DRAWER") || this.isBusy("OPEN_AUTOFILL_DRAWER")
        : (primary as ExtensionCommand) === "TAILOR_RESUME"
        ? !this.canRun("TAILOR_RESUME") || this.isBusy("TAILOR_RESUME")
        : false

    const avatarUrl = this.resolveAvatarUrl(this.user?.avatarUrl)
    const avatar = avatarUrl
      ? `<img src="${esc(avatarUrl)}" alt="Profile" />`
      : esc(initials(this.user?.fullName, this.user?.email))

    this.root.innerHTML = `
      <div class="surface">
        <div class="collapsed">
          <button class="expand" data-action="toggle-expand" aria-label="Toggle controls">${this.expanded ? "▾" : "▸"}</button>
          <span class="brand">HO</span>
          <div class="summary">
            <div class="title">${esc(mainTitle)}</div>
            <div class="meta">${esc(subTitle)}</div>
          </div>
          <span class="pill ${pill.cls}">${esc(pill.label)}</span>
          <button class="primary" data-action="primary" ${primaryDisabled ? "disabled" : ""}>${esc(this.primaryActionLabel())}</button>
        </div>
        <div class="expanded" data-open="${this.expanded ? "true" : "false"}">
          ${this.renderExpandedActions()}
          <span class="spacer"></span>
          <button class="action" data-action="open-hireoven">View in Hireoven</button>
          <button class="avatar-btn" data-action="profile-toggle" aria-label="Profile menu">${avatar}</button>
        </div>
        ${this.statusLine ? `<div class="meta" style="margin:6px 2px 1px;">${esc(trimText(this.statusLine, 180))}</div>` : ""}
      </div>
      ${this.renderMenu()}
      ${this.renderAutofillDrawer()}
      ${this.renderTailorDrawer()}
      ${this.renderCoverDrawer()}
      ${this.renderMatchDrawer()}
    `

    const coverTextarea = this.root.querySelector<HTMLTextAreaElement>("[data-role='cover-text']")
    if (coverTextarea) {
      coverTextarea.addEventListener("input", () => {
        this.coverLetterText = coverTextarea.value
      })
    }

    this.root.querySelectorAll<HTMLElement>("[data-action]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        const action = node.dataset.action
        if (!action) return
        void this.onAction(action)
      })
    })
  }
}

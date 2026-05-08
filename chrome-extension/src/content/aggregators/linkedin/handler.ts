import {
  AggregatorHandler,
  bootstrapAggregator,
  type ApplyMode,
  type PostedAtPrecision,
  type ScrapedJob,
  type WorkMode,
} from "../base"
import { driveLinkedInEasyApply, type LinkedInEasyApplyPrefs } from "./easyapply-driver"

const JOB_PAGE_RE = /\/jobs\/(view|collections|search)\//

export class LinkedInHandler extends AggregatorHandler {
  readonly site = "linkedin" as const

  isJobPage(): boolean {
    return JOB_PAGE_RE.test(window.location.pathname)
  }

  scrapeJob(): ScrapedJob | null {
    const sourceId = this.extractJobId()
    if (!sourceId) return null

    const title = this.text([
      "h1.t-24",
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title",
    ])
    if (!title) return null

    const companyAnchor = document.querySelector<HTMLAnchorElement>(
      ".job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a",
    )
    const company =
      companyAnchor?.textContent?.trim() ??
      this.text([".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name"]) ??
      ""
    if (!company) return null

    const companyUrl = companyAnchor?.href

    const primaryDescContainer = document.querySelector<HTMLElement>(
      ".job-details-jobs-unified-top-card__primary-description-container, .jobs-unified-top-card__primary-description",
    )
    const primaryDescText = primaryDescContainer?.innerText ?? ""
    const location = parseLocation(primaryDescText)
    const workMode = parseWorkMode(primaryDescText)

    const { postedAt, postedAtPrecision } = parsePostedAt()
    const description =
      document.querySelector<HTMLElement>(".jobs-description__content, .jobs-description-content")?.innerText?.trim() ??
      ""

    const applyMode = this.detectApplyMode()

    const promoted = !!document.querySelector("[aria-label*='Promoted' i]") ||
      /\bPromoted\b/.test(primaryDescText)

    return {
      site: this.site,
      sourceId,
      title,
      company,
      companyUrl,
      location,
      workMode,
      postedAt,
      postedAtPrecision,
      description,
      applyMode,
      metadata: {
        promoted,
      },
    }
  }

  detectApplyMode(): ApplyMode {
    const applyBtn = document.querySelector<HTMLElement>(".jobs-apply-button")
    const text = (applyBtn?.textContent ?? "").trim().toLowerCase()
    if (!applyBtn) return { kind: "unknown" }
    if (text.includes("no longer accepting")) return { kind: "closed" }
    if (text.includes("easy apply")) return { kind: "internal_easyapply", driver: "linkedin" }
    if (text.startsWith("apply")) return { kind: "external_redirect" }
    return { kind: "unknown" }
  }

  injectPill(_target: Element, job: ScrapedJob): void {
    void job
    // Product requirement: never render extension overlay UI on LinkedIn.
    // Keep scraping + driver plumbing, but block visual pill injection.
    return
  }

  protected findPillTarget(): Element | null {
    return document.querySelector(".jobs-apply-button")
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private extractJobId(): string | null {
    const m = window.location.pathname.match(/\/jobs\/view\/(\d+)/)
    if (m?.[1]) return m[1]
    try {
      const id = new URL(window.location.href).searchParams.get("currentJobId")
      if (id) return id
    } catch {
      // ignore URL parse failures
    }
    const active = document.querySelector<HTMLElement>(
      ".jobs-search-results-list [data-job-id].jobs-search-results__list-item--active, " +
        ".jobs-search-results-list [data-job-id][aria-selected='true']",
    )
    const dataId = active?.getAttribute("data-job-id")
    return dataId && /^\d+$/.test(dataId) ? dataId : null
  }

  private text(selectors: string[]): string | null {
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel)
      const value = el?.textContent?.trim()
      if (value) return value
    }
    return null
  }
}

// ── Free helpers ──────────────────────────────────────────────────────────────

function parseLocation(primaryDescText: string): string {
  // LinkedIn typically reads: "Mountain View, CA · 2 weeks ago · 87 applicants"
  const head = primaryDescText.split("·")[0]?.trim()
  return head ?? ""
}

function parseWorkMode(source: string): WorkMode | undefined {
  const t = source.toLowerCase()
  if (/\bhybrid\b/.test(t)) return "hybrid"
  if (/\bremote\b/.test(t)) return "remote"
  if (/\bon[\s-]?site\b/.test(t)) return "onsite"
  return undefined
}

function parsePostedAt(): { postedAt: string; postedAtPrecision: PostedAtPrecision } {
  const timeEl = document.querySelector<HTMLTimeElement>(
    ".jobs-unified-top-card__posted-date time[datetime], time[datetime]",
  )
  const exact = timeEl?.getAttribute("datetime")
  if (exact) return { postedAt: exact, postedAtPrecision: "exact" }

  const relText =
    document.querySelector<HTMLElement>(".jobs-unified-top-card__posted-date")?.textContent?.trim() ?? ""
  if (!relText) {
    return { postedAt: new Date().toISOString(), postedAtPrecision: "day" }
  }

  return parseRelative(relText)
}

function parseRelative(rel: string): { postedAt: string; postedAtPrecision: PostedAtPrecision } {
  const now = Date.now()
  const text = rel.toLowerCase()
  const m = text.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/)
  if (!m) {
    if (/just posted|today|new/.test(text)) {
      return { postedAt: new Date(now).toISOString(), postedAtPrecision: "exact" }
    }
    if (/yesterday/.test(text)) {
      return { postedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(), postedAtPrecision: "day" }
    }
    return { postedAt: new Date(now).toISOString(), postedAtPrecision: "day" }
  }
  const n = Number(m[1])
  const unit = m[2]
  const ms =
    unit === "minute"
      ? n * 60_000
      : unit === "hour"
      ? n * 60 * 60_000
      : unit === "day"
      ? n * 24 * 60 * 60_000
      : unit === "week"
      ? n * 7 * 24 * 60 * 60_000
      : unit === "month"
      ? n * 30 * 24 * 60 * 60_000
      : n * 365 * 24 * 60 * 60_000

  // Brief: under 24h → exact (1h resolution), otherwise precision: 'day'
  if (ms < 24 * 60 * 60_000) {
    return { postedAt: new Date(now - ms).toISOString(), postedAtPrecision: "exact" }
  }
  return { postedAt: new Date(now - ms).toISOString(), postedAtPrecision: "day" }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

const handler = new LinkedInHandler()
bootstrapAggregator(handler)

// Listen for dispatcher-triggered driver runs.
chrome.runtime?.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (typeof msg !== "object" || msg === null) return false
  const m = msg as Record<string, unknown>
  if (m.type !== "SCOUT_RUN_DRIVER" || m.driver !== "linkedin") return false

  const job = m.job as ScrapedJob | undefined
  const prefs = m.prefs as LinkedInEasyApplyPrefs | undefined
  if (!job || !prefs) {
    sendResponse({ ok: false, error: "missing job or prefs" })
    return false
  }
  void driveLinkedInEasyApply(job, prefs).then((result) => {
    sendResponse({ ok: true, result })
  })
  return true
})

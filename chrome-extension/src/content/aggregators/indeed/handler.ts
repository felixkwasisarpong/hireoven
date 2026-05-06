import {
  AggregatorHandler,
  bootstrapAggregator,
  type ApplyMode,
  type PostedAtPrecision,
  type ScrapedJob,
  type WorkMode,
} from "../base"
import { isSuppressed, recordDismiss } from "../cta-suppression"
import { createPill, injectPillAfter } from "../pill"
import { driveIndeedApply, type IndeedApplyPrefs } from "./easyapply-driver"

const INDEED_HOST_RE = /(^|\.)indeed\.[a-z.]+$/

export class IndeedHandler extends AggregatorHandler {
  readonly site = "indeed" as const

  isJobPage(): boolean {
    if (!INDEED_HOST_RE.test(window.location.hostname)) return false
    const path = window.location.pathname
    if (path === "/viewjob") return true
    if (path === "/jobs") {
      const params = new URLSearchParams(window.location.search)
      return params.has("jk") || params.has("vjk")
    }
    return false
  }

  scrapeJob(): ScrapedJob | null {
    const sourceId = this.extractJobId()
    if (!sourceId) return null

    const title = this.text([
      "[data-testid='jobsearch-JobInfoHeader-title']",
      ".jobsearch-JobInfoHeader-title",
      "h1.jobTitle",
      "h1",
    ])
    if (!title) return null

    const companyAnchor = document.querySelector<HTMLAnchorElement>(
      ".jobsearch-CompanyInfoContainer a, [data-company-name] a",
    )
    const company =
      companyAnchor?.textContent?.trim() ??
      this.text([
        "[data-testid='inlineHeader-companyName']",
        "[data-company-name]",
        ".jobsearch-CompanyInfoContainer a",
      ])
    if (!company) return null

    const location =
      this.text([
        "[data-testid='inlineHeader-companyLocation']",
        "[data-testid='job-location']",
        ".companyLocation",
      ]) ?? ""

    const headerText =
      document.querySelector<HTMLElement>(".jobsearch-JobInfoHeader-subtitle, .jobsearch-CompanyInfoContainer")
        ?.innerText ?? ""
    const workMode = parseWorkMode(`${location} ${headerText}`)

    const description =
      document.querySelector<HTMLElement>("#jobDescriptionText, [data-testid='jobDescriptionText']")?.innerText?.trim() ??
      ""

    const salary =
      this.text([
        ".jobsearch-JobMetadataHeader-item",
        "[data-testid='attribute_snippet_testid']",
      ]) ?? undefined
    const salaryConfirmed = !!salary

    const { postedAt, postedAtPrecision } = parsePostedAt()

    const applyMode = this.detectApplyMode()

    return {
      site: this.site,
      sourceId,
      title,
      company,
      companyUrl: companyAnchor?.href,
      location,
      workMode,
      postedAt,
      postedAtPrecision,
      description,
      salary,
      salaryConfirmed,
      applyMode,
      metadata: {},
    }
  }

  detectApplyMode(): ApplyMode {
    const easyApply =
      document.querySelector("[data-testid='indeedApplyButton'], button.indeedApplyButton") ||
      hasTextMatching("Easily apply") ||
      hasTextMatching("Apply now")
    if (easyApply) return { kind: "internal_easyapply", driver: "indeed" }

    if (hasTextMatching("Apply on company site") || hasTextMatching("Apply on company website")) {
      return { kind: "external_redirect" }
    }
    return { kind: "unknown" }
  }

  injectPill(_target: Element, job: ScrapedJob): void {
    if (job.applyMode.kind === "closed") return
    const target = this.findPillTarget()
    if (!target) return

    // Brief: do not inject into left-side search result cards. We anchor only to
    // the right-pane / detail apply button row.
    const inListCard = target.closest(".jobsearch-RightPane, .jobsearch-ViewJobLayout, main") === null
    if (inListCard) return

    void isSuppressed(this.site).then((suppressed) => {
      if (suppressed) return
      const path = window.location.pathname
      const compact = path === "/jobs" // search page right pane is tighter than /viewjob

      const pill = createPill({
        variant: "green",
        size: compact ? "compact" : "default",
        copy: "Apply with Scout",
        testId: "scout-pill-indeed",
        dismissible: true,
        onDismiss: () => void recordDismiss(this.site),
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          chrome.runtime.sendMessage(
            { type: "SCOUT_OPEN_APPLY_FLOW", site: this.site, jobId: job.sourceId, scrapedJob: job },
            () => {
              void chrome.runtime.lastError
            },
          )
        },
      })
      injectPillAfter(target, pill)
    })
  }

  protected findPillTarget(): Element | null {
    return document.querySelector(
      "[data-testid='indeedApplyButton'], button.indeedApplyButton, " +
        ".jobsearch-IndeedApplyButton-newDesign, " +
        ".jobsearch-ApplyButton-buttonContainer button",
    )
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private extractJobId(): string | null {
    try {
      const params = new URLSearchParams(window.location.search)
      const jk = params.get("jk") ?? params.get("vjk")
      if (jk) return jk
    } catch {
      // ignore URL parse failures
    }
    const dataJk = document.querySelector<HTMLElement>("[data-jk]")?.getAttribute("data-jk")
    return dataJk && dataJk.length > 0 ? dataJk : null
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

function parseWorkMode(source: string): WorkMode | undefined {
  const t = source.toLowerCase()
  if (/\bhybrid\b/.test(t)) return "hybrid"
  if (/\bremote\b/.test(t)) return "remote"
  if (/\bon[\s-]?site\b/.test(t)) return "onsite"
  return undefined
}

function parsePostedAt(): { postedAt: string; postedAtPrecision: PostedAtPrecision } {
  const footer =
    document.querySelector<HTMLElement>(
      ".jobsearch-JobMetadataFooter, [data-testid='myJobsStateDate'], " +
        "[data-testid='job-age'], .date",
    )?.textContent?.trim() ?? ""

  const now = Date.now()
  if (!footer) {
    return { postedAt: new Date(now).toISOString(), postedAtPrecision: "day" }
  }
  const text = footer.toLowerCase()
  if (/just posted|today/.test(text)) {
    return { postedAt: new Date(now).toISOString(), postedAtPrecision: "exact" }
  }
  const m = text.match(/posted\s+(\d+)\+?\s*(hour|day|week|month)s?\s*ago/)
  if (!m) {
    const m2 = text.match(/(\d+)\+?\s*(hour|day|week|month)s?\s*ago/)
    if (!m2) return { postedAt: new Date(now).toISOString(), postedAtPrecision: "day" }
    return relativeAgo(now, Number(m2[1]), m2[2])
  }
  return relativeAgo(now, Number(m[1]), m[2])
}

function relativeAgo(now: number, n: number, unit: string): { postedAt: string; postedAtPrecision: PostedAtPrecision } {
  const ms =
    unit === "hour"
      ? n * 60 * 60_000
      : unit === "day"
      ? n * 24 * 60 * 60_000
      : unit === "week"
      ? n * 7 * 24 * 60 * 60_000
      : n * 30 * 24 * 60 * 60_000
  // Brief: precision 'exact' for hours, 'day' for days+
  const precision: PostedAtPrecision = unit === "hour" ? "exact" : "day"
  return { postedAt: new Date(now - ms).toISOString(), postedAtPrecision: precision }
}

function hasTextMatching(needle: string): boolean {
  const re = new RegExp(needle.replace(/\s+/g, "\\s+"), "i")
  const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, a"))
  return buttons.some((el) => re.test(el.textContent ?? ""))
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

const handler = new IndeedHandler()
bootstrapAggregator(handler)

chrome.runtime?.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (typeof msg !== "object" || msg === null) return false
  const m = msg as Record<string, unknown>
  if (m.type !== "SCOUT_RUN_DRIVER" || m.driver !== "indeed") return false

  const job = m.job as ScrapedJob | undefined
  const prefs = m.prefs as IndeedApplyPrefs | undefined
  if (!job || !prefs) {
    sendResponse({ ok: false, error: "missing job or prefs" })
    return false
  }
  void driveIndeedApply(job, prefs).then((result) => {
    sendResponse({ ok: true, result })
  })
  return true
})

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
import { driveHandshakeApply, type HandshakeApplyPrefs } from "./easyapply-driver"

const JOB_PATH_RE = /^\/(jobs|stu\/jobs)\/(\d+)/

export class HandshakeHandler extends AggregatorHandler {
  readonly site = "handshake" as const

  /** Cached on first request from dispatcher; used to personalize the pill. */
  private userMajor: string | null = null
  private majorRequested = false

  isJobPage(): boolean {
    if (this.isLoggedOut()) return false
    return JOB_PATH_RE.test(window.location.pathname)
  }

  scrapeJob(): ScrapedJob | null {
    const m = window.location.pathname.match(JOB_PATH_RE)
    const sourceId = m?.[2]
    if (!sourceId) return null

    const title = this.text(["[data-hook='job-title']", "[class*='job-title']", "h1"])
    if (!title) return null

    const company = this.text([
      "[data-hook='employer-name']",
      "[class*='employer-name']",
      "[class*='company-name']",
    ])
    if (!company) return null

    const companyAnchor = document.querySelector<HTMLAnchorElement>(
      "[data-hook='employer-name'] a, [class*='employer-name'] a",
    )
    const location = this.text(["[data-hook='location']", "[class*='location']"]) ?? ""

    const description =
      document.querySelector<HTMLElement>(
        "[data-hook='job-description'], [class*='job-description'], [class*='description']",
      )?.innerText?.trim() ?? ""

    const detailText = `${location} ${description}`
    const workMode = parseWorkMode(detailText)
    const employmentType = parseEmploymentType(detailText) ?? this.detectJobType()

    const { postedAt, postedAtPrecision } = parsePostedAt(description)
    const applyMode = this.detectApplyMode()
    const requirements = this.extractRequirements()
    const deadline = this.extractDeadline()
    const schoolVerifiedEmployer = !!document.querySelector(
      "[data-hook='trusted-employer'], [class*='verified-employer'], [class*='trusted']",
    )

    return {
      site: this.site,
      sourceId,
      title,
      company,
      companyUrl: companyAnchor?.href,
      location,
      workMode,
      employmentType,
      postedAt,
      postedAtPrecision,
      description,
      applyMode,
      metadata: {
        // Brief: Handshake is exclusively early-career. Surfaced here so
        // ApplyAgentFlow can switch to early-career cover-letter tone.
        earlyCareer: true,
        jobType: employmentType,
        requirements: { ...requirements, schoolVerifiedEmployer },
        deadline,
      },
    }
  }

  detectApplyMode(): ApplyMode {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, a"))
    for (const btn of buttons) {
      const txt = (btn.textContent ?? "").trim().toLowerCase()
      if (txt === "apply externally" || txt === "apply on company website") {
        return { kind: "external_redirect" }
      }
      if (txt === "express interest" || txt === "track interest") {
        return { kind: "express_interest" }
      }
    }
    for (const btn of buttons) {
      const txt = (btn.textContent ?? "").trim().toLowerCase()
      if (txt === "apply" || txt === "apply now") {
        return { kind: "internal_easyapply", driver: "handshake" }
      }
    }
    return { kind: "unknown" }
  }

  injectPill(_target: Element, job: ScrapedJob): void {
    const target = this.findPillTarget()
    if (!target) return
    if (job.applyMode.kind === "closed") return

    this.requestUserMajor()

    void isSuppressed(this.site).then((suppressed) => {
      if (suppressed) return
      const isInterest = job.applyMode.kind === "express_interest"
      const copy = isInterest
        ? "Track interest in Apex"
        : this.userMajor
        ? `Apply with Apex — tailored for ${this.userMajor}`
        : "Apply with Apex"

      const pill = createPill({
        variant: "green",
        copy,
        testId: "apex-pill-handshake",
        dismissible: true,
        onDismiss: () => void recordDismiss(this.site),
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (isInterest) {
            chrome.runtime.sendMessage(
              {
                type: "APEX_TRACK_INTEREST",
                site: this.site,
                jobId: job.sourceId,
                scrapedJob: job,
                applyMethod: "express_interest",
              },
              () => {
                void chrome.runtime.lastError
              },
            )
            return
          }
          chrome.runtime.sendMessage(
            { type: "APEX_OPEN_APPLY_FLOW", site: this.site, jobId: job.sourceId, scrapedJob: job },
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
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, a"))
    for (const btn of buttons) {
      const txt = (btn.textContent ?? "").trim().toLowerCase()
      if (
        txt === "apply" ||
        txt === "apply now" ||
        txt === "apply externally" ||
        txt === "express interest"
      ) {
        return btn
      }
    }
    return null
  }

  // ── Handshake-specific helpers ─────────────────────────────────────────────

  private isLoggedOut(): boolean {
    return !!document.querySelector(
      ".login-form, form[action*='login' i], [data-hook='login-form']",
    )
  }

  private detectJobType(): string | undefined {
    const badges = Array.from(
      document.querySelectorAll<HTMLElement>("[data-hook*='job-type' i], [class*='job-type' i], .badge, .pill"),
    )
    for (const b of badges) {
      const t = (b.textContent ?? "").trim().toLowerCase()
      if (t === "full-time" || t === "full time") return "Full-time"
      if (t === "part-time" || t === "part time") return "Part-time"
      if (t === "internship" || t === "intern") return "Internship"
    }
    return undefined
  }

  private extractRequirements(): {
    graduationYearRange?: [number, number]
    eligibleMajors?: string[]
    gpaCutoff?: number
  } {
    const reqRoot = document.querySelector<HTMLElement>(
      "[data-hook='qualifications'], [class*='qualifications' i], [data-hook='requirements'], section",
    )
    const text = reqRoot?.innerText ?? document.body.innerText ?? ""

    const out: { graduationYearRange?: [number, number]; eligibleMajors?: string[]; gpaCutoff?: number } = {}
    const gradMatch = text.match(/grad(?:uation)?\s+(?:year)?\s*[:\-]?\s*((?:19|20)\d{2})\s*(?:[-–]\s*((?:19|20)\d{2}))?/i)
    if (gradMatch) {
      const a = Number(gradMatch[1])
      const b = gradMatch[2] ? Number(gradMatch[2]) : a
      out.graduationYearRange = [Math.min(a, b), Math.max(a, b)]
    }
    const gpaMatch = text.match(/gpa\s*(?:of|at least|>=|≥)?\s*(\d+(?:\.\d+)?)/i)
    if (gpaMatch) out.gpaCutoff = Number(gpaMatch[1])
    const majorsLine = text.match(/(?:eligible\s+majors?|majors?\s*(?:include|accepted))\s*[:\-]\s*([^\n]+)/i)
    if (majorsLine?.[1]) {
      out.eligibleMajors = majorsLine[1]
        .split(/[,;]\s*|\sand\s/)
        .map((s) => s.trim())
        .filter((s) => s.length > 1 && s.length < 80)
    }
    return out
  }

  private extractDeadline(): string | undefined {
    const explicit = document.querySelector<HTMLElement>(
      "[data-hook='application-deadline'], [class*='deadline' i], time[datetime][data-hook*='deadline' i]",
    )
    const datetimeAttr = explicit?.querySelector<HTMLTimeElement>("time[datetime]")?.getAttribute("datetime")
    if (datetimeAttr) {
      const t = Date.parse(datetimeAttr)
      if (!Number.isNaN(t)) return new Date(t).toISOString()
    }
    const text = explicit?.textContent ?? document.body.innerText ?? ""
    const match = text.match(
      /(?:applications?\s+(?:close|due)|deadline)[:\s]+([A-Z][a-z]{2,9}\s+\d{1,2}(?:,\s*\d{4})?)/,
    )
    if (match?.[1]) {
      const t = Date.parse(match[1])
      if (!Number.isNaN(t)) return new Date(t).toISOString()
    }
    return undefined
  }

  private requestUserMajor(): void {
    if (this.majorRequested || !chrome.runtime?.id) return
    this.majorRequested = true
    chrome.runtime.sendMessage({ type: "APEX_GET_USER_MAJOR" }, (response) => {
      if (chrome.runtime.lastError) return
      const data = response as { major?: string | null } | undefined
      if (data?.major && this.userMajor !== data.major) {
        this.userMajor = data.major
        // Re-inject pill so the personalized copy lands once the major resolves.
        if (this.isJobPage()) this.run()
      }
    })
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

function parseEmploymentType(source: string): string | undefined {
  const t = source.toLowerCase()
  if (/\bfull[-\s]?time\b/.test(t)) return "Full-time"
  if (/\bpart[-\s]?time\b/.test(t)) return "Part-time"
  if (/\bintern(ship)?\b/.test(t)) return "Internship"
  return undefined
}

function parsePostedAt(source: string): { postedAt: string; postedAtPrecision: PostedAtPrecision } {
  const now = Date.now()
  const text = source.toLowerCase()
  const m = text.match(/(?:posted\s+)?(\d+)\+?\s*(hour|day|week|month)s?\s+ago/)
  if (!m) return { postedAt: new Date(now).toISOString(), postedAtPrecision: "day" }
  const n = Number(m[1])
  const unit = m[2]
  const ms =
    unit === "hour"
      ? n * 60 * 60_000
      : unit === "day"
      ? n * 24 * 60 * 60_000
      : unit === "week"
      ? n * 7 * 24 * 60 * 60_000
      : n * 30 * 24 * 60 * 60_000
  const precision: PostedAtPrecision = unit === "hour" ? "exact" : "day"
  return { postedAt: new Date(now - ms).toISOString(), postedAtPrecision: precision }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

const handler = new HandshakeHandler()
bootstrapAggregator(handler)

// Brief edge case: Handshake refreshes the feed via fetch without changing the
// URL. Watch the main feed container so we re-run when new job content streams in.
function observeFeedMutations(): void {
  const feed = document.querySelector<HTMLElement>(
    "[data-hook='jobs-feed'], [data-hook='job-list'], main",
  )
  if (!feed) return
  let lastFiredAt = 0
  const observer = new MutationObserver(() => {
    const now = Date.now()
    if (now - lastFiredAt < 500) return
    lastFiredAt = now
    if (handler.isJobPage()) {
      handler.signalConnected()
      handler.run()
    }
  })
  observer.observe(feed, { childList: true, subtree: true })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", observeFeedMutations)
} else {
  observeFeedMutations()
}

chrome.runtime?.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (typeof msg !== "object" || msg === null) return false
  const m = msg as Record<string, unknown>
  if (m.type !== "APEX_RUN_DRIVER" || m.driver !== "handshake") return false

  const job = m.job as ScrapedJob | undefined
  const prefs = m.prefs as HandshakeApplyPrefs | undefined
  if (!job || !prefs) {
    sendResponse({ ok: false, error: "missing job or prefs" })
    return false
  }
  void driveHandshakeApply(job, prefs).then((result) => {
    sendResponse({ ok: true, result })
  })
  return true
})

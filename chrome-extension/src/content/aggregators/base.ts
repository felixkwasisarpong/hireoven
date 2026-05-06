/**
 * Abstract base for aggregator-site content scripts (LinkedIn, Glassdoor,
 * Indeed, Handshake). Each subclass owns one site's DOM detection, scraping,
 * apply-mode classification, and CTA pill injection.
 *
 * Lifecycle (per page load + every SPA route change):
 *   isJobPage()? → scrapeJob() → cache check → ingest() if new → injectPill()
 */

import { cacheKey, getCached, setCached } from "./scrape-cache"

export type AggregatorSite = "linkedin" | "glassdoor" | "indeed" | "handshake"

export type AtsType =
  | "workday"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "icims"
  | "smartrecruiters"
  | "bamboohr"
  | "generic"

export type ApplyMode =
  | { kind: "internal_easyapply"; driver: "linkedin" | "indeed" | "handshake" }
  | { kind: "external_redirect"; destinationGuess?: AtsType }
  | { kind: "express_interest" }
  | { kind: "closed" }
  | { kind: "unknown" }

export type WorkMode = "remote" | "hybrid" | "onsite"
export type PostedAtPrecision = "exact" | "day" | "bucket"

export interface ScrapedJob {
  site: AggregatorSite
  sourceId: string
  title: string
  company: string
  companyUrl?: string
  location: string
  workMode?: WorkMode
  employmentType?: string
  postedAt: string
  postedAtPrecision: PostedAtPrecision
  description: string
  salary?: string
  salaryConfirmed?: boolean
  applyMode: ApplyMode
  metadata: Record<string, unknown>
}

export abstract class AggregatorHandler {
  abstract readonly site: AggregatorSite

  abstract isJobPage(): boolean
  abstract scrapeJob(): ScrapedJob | null
  abstract detectApplyMode(): ApplyMode
  abstract injectPill(target: Element, job: ScrapedJob): void

  /** Override when the pill anchor isn't the page's primary apply button. */
  protected findPillTarget(): Element | null {
    return (
      document.querySelector<HTMLElement>(
        ".jobs-apply-button, [data-testid='indeedApplyButton'], button[type='button']",
      ) ?? null
    )
  }

  /**
   * Run one cycle: scrape → cache check → ingest if new → inject pill.
   * Safe to call multiple times — the cache prevents redundant ingest
   * traffic when a route change re-fires.
   */
  run(): void {
    if (!this.isJobPage()) return
    const job = this.scrapeJob()
    if (!job) return

    const key = cacheKey(this.site, job.sourceId)
    const seen = getCached<ScrapedJob>(key)
    if (!seen) {
      setCached(key, job)
      this.ingest(job)
    }

    const target = this.findPillTarget()
    if (target) this.injectPill(target, job)
  }

  /**
   * Patch history.pushState/replaceState and listen for popstate. The callback
   * fires at most once per 500ms per pathname — repeated identical-pathname
   * events (common during LinkedIn's currentJobId param swaps) get coalesced.
   */
  observeRouteChanges(callback: () => void): void {
    let lastPath = window.location.pathname
    let lastFiredAt = 0

    const fire = () => {
      const now = Date.now()
      const path = window.location.pathname
      if (path === lastPath && now - lastFiredAt < 500) return
      lastPath = path
      lastFiredAt = now
      try {
        callback()
      } catch (err) {
        console.warn(`[scout:${this.site}] route handler threw`, err)
      }
    }

    const wrap = (method: "pushState" | "replaceState") => {
      const original = history[method]
      history[method] = function patched(this: History, data: unknown, unused: string, url?: string | URL | null) {
        const result = original.call(this, data, unused, url)
        window.dispatchEvent(new Event(`scout:${method}`))
        return result
      }
    }
    wrap("pushState")
    wrap("replaceState")

    window.addEventListener("scout:pushState", fire)
    window.addEventListener("scout:replaceState", fire)
    window.addEventListener("popstate", fire)
  }

  /**
   * POSTs the scraped job to /api/scout/jobs/ingest, routed through the
   * background service worker (only context with cookie/JWT access).
   * Cache eviction is the caller's responsibility.
   */
  protected ingest(job: ScrapedJob): void {
    if (!chrome.runtime?.id) return
    chrome.runtime.sendMessage({ type: "SCOUT_INGEST_JOB", site: this.site, job }, () => {
      void chrome.runtime.lastError
    })
  }

  /** Tell the dispatcher this site has an active scraper so the web app can clear its "extension not connected" prompt. */
  signalConnected(): void {
    if (!chrome.runtime?.id) return
    chrome.runtime.sendMessage({ type: "SCOUT_CONNECTED", site: this.site }, () => {
      void chrome.runtime.lastError
    })
  }
}

/**
 * Common bootstrap for aggregator content scripts: initial run, route-change
 * subscription, and SCOUT_PING responder. Each handler module calls this once
 * after construction; driver runners are still registered per-handler since
 * they're driver-typed.
 */
export function bootstrapAggregator(handler: AggregatorHandler): void {
  const fire = () => {
    if (!handler.isJobPage()) return
    handler.signalConnected()
    handler.run()
  }
  fire()
  handler.observeRouteChanges(fire)
  registerPingResponder(handler)
}

function registerPingResponder(handler: AggregatorHandler): void {
  if (!chrome.runtime?.onMessage) return
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if (typeof msg !== "object" || msg === null) return false
    if ((msg as Record<string, unknown>).type !== "SCOUT_PING") return false
    // Only respond when this content script is on a real job page; otherwise
    // we don't claim "connected" to the dispatcher.
    if (!handler.isJobPage()) return false
    sendResponse({ alive: true, site: handler.site })
    return false
  })
}

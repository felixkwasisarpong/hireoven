/**
 * Apple (jobs.apple.com) headless-browser adapter.
 *
 * Apple's careers site is a fully client-side-rendered SPA backed by a CSRF-
 * gated `/api/v1/*` namespace. HTTP-only adapters can't reach the JD content
 * because the page is an empty JS shell with no JSON-LD or pre-rendered body.
 * We use Playwright + Chromium to render the listing page, scrape rendered
 * anchors, and emit list-level jobs (title + location + apply URL + req-id).
 *
 * Description bodies live behind per-job detail pages; that pass lives in
 * `scripts/backfill-apple-descriptions.ts` so the harvest tick stays bounded
 * (one browser context, page-by-page list crawl) — same phase-2 enrichment
 * pattern as Workday and Dice.
 *
 * Browser lifecycle: lazy singleton, kept alive for the worker's lifetime;
 * the worker process exit cleans up Chromium. Concurrency=1 so we don't run
 * multiple expensive renders in parallel from the same tick.
 */

import type { Browser, Page } from "playwright"
import {
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

const APPLE_HOST_RE = /^https?:\/\/jobs\.apple\.com\//i
const SEARCH_URL = "https://jobs.apple.com/en-us/search?location=united-states-USA"
const DEFAULT_TIMEOUT_MS = 30_000
const PAGE_RENDER_WAIT_MS = 20_000
const MAX_PAGES = 60 // generous upper bound — search returns ~25/page
const APPLE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

let browserInstance: Browser | null = null
let browserInitInflight: Promise<Browser> | null = null

export async function getAppleBrowser(): Promise<Browser> {
  if (browserInstance) return browserInstance
  if (browserInitInflight) return browserInitInflight
  browserInitInflight = (async () => {
    const { chromium } = await import("playwright")
    return chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    })
  })()
  browserInstance = await browserInitInflight
  browserInitInflight = null
  return browserInstance
}

export async function closeAppleBrowser(): Promise<void> {
  const b = browserInstance
  browserInstance = null
  if (b) await b.close().catch(() => {})
}

type ListEntry = {
  id: string
  title: string
  applyUrl: string
  location?: string
}

async function newConfiguredPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    userAgent: APPLE_UA,
    locale: "en-US",
    viewport: { width: 1280, height: 1800 },
  })
  await context.setExtraHTTPHeaders({
    "accept-language": "en-US,en;q=0.9",
  })
  const page = await context.newPage()
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS)
  return page
}

export async function extractAppleListPage(page: Page, pageNum: number): Promise<ListEntry[]> {
  const url = `${SEARCH_URL}&page=${pageNum}`
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS })
  // Wait for the job list to render. Some pages may render zero results legitimately
  // (we're past the last page); resolve gracefully so the caller can break out.
  await page
    .waitForSelector('a[href*="/details/"]', { timeout: PAGE_RENDER_WAIT_MS })
    .catch(() => null)
  return await page.evaluate(() => {
    const out: { id: string; title: string; applyUrl: string; location?: string }[] = []
    const seen = new Set<string>()
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/details/"]'))
    for (const anchor of anchors) {
      const href = anchor.href
      const m = href.match(/\/details\/(\d+(?:-\d+)?)/)
      if (!m) continue
      const id = m[1]
      if (seen.has(id)) continue
      const title = (anchor.textContent ?? "").trim().replace(/\s+/g, " ")
      if (!title) continue
      seen.add(id)
      // Look for a sibling/parent that carries the location text.
      let location: string | undefined
      const card = anchor.closest("li, tr, article, div")
      if (card) {
        const txt = (card.textContent ?? "").replace(/\s+/g, " ")
        const m2 = txt.match(/([A-Z][a-zA-Z .]+,\s*[A-Z]{2}(?:,\s*United States)?)/)
        if (m2) location = m2[1]
      }
      out.push({ id, title, applyUrl: href, location })
    }
    return out
  })
}

export const appleAdapter: AtsAdapter = {
  name: "apple",
  concurrency: 1,
  detectFromUrl(url) {
    if (!APPLE_HOST_RE.test(url)) return null
    return { slug: "apple" }
  },
  async fetchJobs({ ctx }): Promise<HarvestResult> {
    const startedAt = Date.now()
    const browser = await getAppleBrowser()
    const page = await newConfiguredPage(browser)
    const seen = new Set<string>()
    const collected: HarvestedJob[] = []

    try {
      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum += 1) {
        const entries = await extractAppleListPage(page, pageNum)
        let added = 0
        for (const entry of entries) {
          if (seen.has(entry.id)) continue
          seen.add(entry.id)
          collected.push({
            externalId: entry.id,
            title: entry.title,
            applyUrl: entry.applyUrl,
            location: entry.location,
            // Description left blank — phase-2 enrichment (Playwright detail
            // fetch) fills this in via scripts/backfill-apple-descriptions.ts.
            contentHash: hashContent([entry.title, entry.applyUrl, entry.location]),
          })
          added += 1
        }
        if (added === 0) break
      }
    } finally {
      await page.context().close().catch(() => {})
    }

    void ctx // ETag/Last-Modified not exposed by Apple; ignore the conditional inputs.
    return {
      jobs: collected,
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "apple",
      sourceAtsSlug: "apple",
      fetchedAt: new Date(),
      upstreamLatencyMs: Date.now() - startedAt,
    }
  },
}

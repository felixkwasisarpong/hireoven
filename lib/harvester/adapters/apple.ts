/**
 * Apple (jobs.apple.com) headless-browser adapter.
 *
 * Apple's careers site is a fully client-side-rendered SPA backed by a CSRF-
 * gated `/api/v1/*` namespace. HTTP-only adapters can't reach the JD content
 * because the page is an empty JS shell with no JSON-LD or pre-rendered body.
 * We use Playwright + Chromium to render the listing page, scrape rendered
 * anchors, then render a bounded subset of per-job detail pages for
 * descriptions during the same harvest tick. Jobs already described in the DB
 * are skipped so the detail budget goes to rows that still need JD text.
 *
 * Browser lifecycle: lazy singleton, kept alive for the worker's lifetime;
 * the worker process exit cleans up Chromium. Concurrency=1 so we don't run
 * multiple expensive renders in parallel from the same tick.
 */

import type { Browser, Page } from "playwright"
import pLimit from "p-limit"
import {
  envConcurrency,
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
// Search returns ~25/page. Env-tunable; default 60 (~1.5k). Raise to capture
// more of Apple's full board — but Apple is Playwright-rendered (slow), so raise
// the per-company timeout alongside or the crawl will time out and get demoted.
const MAX_PAGES = Math.max(1, Number.parseInt(process.env.HARVESTER_APPLE_MAX_PAGES ?? "60", 10))
const DETAIL_MAX_JOBS = Math.max(
  0,
  Number.parseInt(process.env.HARVESTER_APPLE_DETAIL_MAX_JOBS ?? "60", 10)
)
const DETAIL_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_APPLE_DETAIL_CONCURRENCY ?? "2", 10)
)
const MIN_USEFUL_DESCRIPTION = 200
const APPLE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

let browserInstance: Browser | null = null
let browserInitInflight: Promise<Browser> | null = null

export async function getAppleBrowser(): Promise<Browser> {
  // Health-check the cached singleton. If the chromium process died (OOM kill,
  // network sandbox eviction, manual restart), Playwright's `isConnected()`
  // returns false. In that state every newContext/newPage call rejects, so we
  // drop the dead reference and recreate. Without this the worker would log
  // "Apple harvest failed" for every subsequent claim until the container was
  // restarted manually.
  if (browserInstance) {
    if (browserInstance.isConnected()) return browserInstance
    const dead = browserInstance
    browserInstance = null
    void dead.close().catch(() => {})
  }
  if (browserInitInflight) return browserInitInflight
  browserInitInflight = (async () => {
    const { chromium } = await import("playwright")
    return chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    })
  })()
  try {
    browserInstance = await browserInitInflight
    return browserInstance
  } finally {
    browserInitInflight = null
  }
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

export function extractAppleDescriptionFromText(fullText: string): string | null {
  let body = fullText.replace(/\u00a0/g, " ")

  // Apple detail pages have a predictable header:
  // "...Back to search results <title> <location> Submit Resume Summary
  // Posted: <date>". The JD body begins after the "Posted:" line.
  const startPatterns = [
    /Posted:\s*[A-Z][a-z]+\s+\d{1,2},\s+\d{4}/,
    /Submit Resume\s*Summary\s+/i,
    /About the Role/i,
    /Job Summary/i,
  ]
  for (const re of startPatterns) {
    const match = body.match(re)
    if (match && match.index !== undefined && match.index > 0) {
      body = body.slice(match.index + match[0].length)
      break
    }
  }

  const footerMarkers = [
    "Apple is an equal opportunity employer",
    "Apple Footer",
    "Shopping Bag",
    "Privacy Policy",
    "Open Menu Close Menu",
  ]
  for (const marker of footerMarkers) {
    const idx = body.indexOf(marker)
    if (idx >= 0) body = body.slice(0, idx)
  }

  const cleaned = body.replace(/\n{3,}/g, "\n\n").trim().slice(0, 8_000)
  return cleaned.length >= MIN_USEFUL_DESCRIPTION ? cleaned : null
}

export async function renderAppleDetail(browser: Browser, url: string): Promise<string | null> {
  const page = await newConfiguredPage(browser)
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS })
    await page
      .waitForFunction(
        () => {
          const text = document.body?.innerText ?? ""
          return text.length > 1200 && /description|qualifications|minimum/i.test(text)
        },
        undefined,
        { timeout: PAGE_RENDER_WAIT_MS }
      )
      .catch(() => null)

    const fullText = await page.evaluate(() => document.body?.innerText ?? "")
    return extractAppleDescriptionFromText(fullText)
  } finally {
    await page.context().close().catch(() => {})
  }
}

async function enrichWithDetails(
  browser: Browser,
  jobs: HarvestedJob[],
  ctx: HarvestCtx
): Promise<void> {
  if (DETAIL_MAX_JOBS === 0) return
  const alreadyDescribed = ctx.alreadyDescribedIds
  const targets = jobs
    .filter((job) => !alreadyDescribed?.has(job.externalId))
    .slice(0, DETAIL_MAX_JOBS)
  if (targets.length === 0) return

  const limiter = pLimit(DETAIL_CONCURRENCY)
  await Promise.all(
    targets.map((job) =>
      limiter(async () => {
        const description = await renderAppleDetail(browser, job.applyUrl).catch(() => null)
        if (!description || description.length <= (job.description?.length ?? 0)) return
        job.description = description
        job.contentHash = hashContent([
          job.title,
          job.applyUrl,
          job.location,
          description.slice(0, 4_000),
        ])
      })
    )
  )
}

export const appleAdapter: AtsAdapter = {
  name: "apple",
  concurrency: envConcurrency("apple", 1),
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
            contentHash: hashContent([entry.title, entry.applyUrl, entry.location]),
          })
          added += 1
        }
        if (added === 0) break
      }
    } finally {
      await page.context().close().catch(() => {})
    }

    await enrichWithDetails(browser, collected, ctx)

    // ETag/Last-Modified not exposed by Apple; ignore the conditional inputs.
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

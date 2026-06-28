/**
 * Playwright-backed job-description fetcher — the heavy fallback for the
 * description-enrichment worker when the plain HTTP fetch comes back empty
 * (JS-rendered career pages, soft WAF challenges that pass with a real browser).
 *
 * Deliberately frugal so it can run on the shared 4-vCPU / 8 GB harvester box:
 *   • ONE shared browser + ONE shared context, reused across every fetch
 *     (launch cost paid once per batch, not per job).
 *   • Images / fonts / media / stylesheets are aborted at the context level —
 *     cuts outbound bandwidth ~5-10× (keeps us under the box's 3 TB/mo cap) and
 *     page time ~40%.
 *   • Hard per-page timeout; the page is always closed in `finally` so a stalled
 *     navigation can't leak a browser process (we have been bitten by a 25 h
 *     leaked chrome-headless before — never again).
 *   • Container-safe Chrome flags (`--disable-dev-shm-usage`, `--no-sandbox`).
 *
 * Concurrency is the CALLER's responsibility — gate calls through a small
 * p-limit so the box never has more than a handful of pages rendering at once.
 *
 * Lifecycle (one per batch):
 *   const fetcher = await createBrowserDescriptionFetcher()
 *   try { const desc = await fetcher.fetch(url) } finally { await fetcher.close() }
 */

import type { Browser, BrowserContext } from "playwright"
import {
  extractJobDescriptionFromHtml,
  detectProviderFromUrl,
  normalizeJobApplyUrl,
} from "@/lib/jobs/description"

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// Resource types we never need for reading a job description. Blocking these is
// the single biggest lever on both bandwidth and render time.
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font", "stylesheet"])

export type BrowserDescriptionFetcher = {
  fetch: (url: string, timeoutMs?: number) => Promise<string | null>
  close: () => Promise<void>
}

export async function createBrowserDescriptionFetcher(options?: {
  userAgent?: string
  /** ms to settle after domcontentloaded for client-rendered JD bodies. */
  settleMs?: number
}): Promise<BrowserDescriptionFetcher> {
  const userAgent = options?.userAgent ?? DEFAULT_USER_AGENT
  const settleMs = Math.max(0, options?.settleMs ?? 800)

  // Lazy import so unit tests / cold paths never pay the playwright cost.
  const { chromium } = await import("playwright")
  const browser: Browser = await chromium.launch({
    headless: true,
    // /dev/shm is tiny in containers — without this Chrome crashes under load.
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
  })

  let context: BrowserContext
  try {
    context = await browser.newContext({
      userAgent,
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
      serviceWorkers: "block",
    })
    // Block heavy assets for every page in this context.
    await context.route("**/*", (route) => {
      if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
        return route.abort()
      }
      return route.continue()
    })
  } catch (error) {
    await browser.close().catch(() => {})
    throw error
  }

  const fetch = async (url: string, timeoutMs = 10_000): Promise<string | null> => {
    const target = normalizeJobApplyUrl(url)
    let provider: string | undefined
    try {
      provider = detectProviderFromUrl(new URL(target))
    } catch {
      /* unparseable URL — extraction still works without a hint */
    }

    let page
    try {
      page = await context.newPage()
    } catch {
      return null
    }
    try {
      try {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: timeoutMs })
        if (settleMs > 0) await page.waitForTimeout(settleMs)
      } catch {
        // Nav timeout / DNS / soft-block — still try to read whatever rendered.
      }
      let html: string
      try {
        html = await page.content()
      } catch {
        return null
      }
      return extractJobDescriptionFromHtml(html, provider)
    } finally {
      // Always close the page — a stalled goto must never leak the process.
      await page.close().catch(() => {})
    }
  }

  return {
    fetch,
    close: async () => {
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
    },
  }
}

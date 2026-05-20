/**
 * Reusable Playwright-backed HTML renderer for the URL resolver.
 *
 * Different from `lib/crawler/playwright-fallback.ts` — that one is a
 * single-call utility gated for the live crawler's "blocked HTTP" failure
 * mode and capped at MAX_PER_RUN per process. This module is designed for
 * one-shot scripts (e.g. seed-enterprise-ats.ts) that need to render many
 * wrapper pages whose ATS link is JS-injected after `DOMContentLoaded`.
 *
 * Lifecycle:
 *   const renderer = await createPlaywrightRenderer()
 *   try {
 *     const html1 = await renderer.render("https://www.pfizer.com/about/careers")
 *     const html2 = await renderer.render("https://www.ibm.com/careers")
 *     // …
 *   } finally {
 *     await renderer.close()
 *   }
 *
 * The render function matches the `RenderHtml` type expected by
 * `resolveDirectAtsUrl`, so plugging this in is one line at the call site.
 */

import type { Browser } from "playwright"
import type { RenderHtml } from "@/lib/companies/ats-url-resolver"

export type PlaywrightRenderer = {
  render: RenderHtml
  close: () => Promise<void>
}

export type PlaywrightRenderOptions = {
  /** Per-page navigation timeout in ms. Default 25_000. */
  timeoutMs?: number
  /** networkidle / load / domcontentloaded. Default "load" — faster than
   *  networkidle (which is unreliable on careers wrappers that keep polling). */
  waitUntil?: "load" | "domcontentloaded" | "networkidle"
  /** Additional ms to sleep after `waitUntil` fires, to let JS finish injecting
   *  ATS links. Default 1_500. */
  extraDelayMs?: number
  userAgent?: string
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export async function createPlaywrightRenderer(
  options: PlaywrightRenderOptions = {}
): Promise<PlaywrightRenderer> {
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? 25_000)
  const waitUntil = options.waitUntil ?? "load"
  const extraDelayMs = Math.max(0, options.extraDelayMs ?? 1_500)
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT

  // Lazy import keeps the dependency cost out of unit tests that never call
  // this factory.
  const { chromium } = await import("playwright")
  const browser: Browser = await chromium.launch({ headless: true })

  const render: RenderHtml = async (url: string) => {
    let context
    try {
      context = await browser.newContext({
        userAgent,
        locale: "en-US",
        // Most wrapper pages don't need cookies/JS storage carried between
        // calls; a fresh context per request keeps memory bounded.
        viewport: { width: 1280, height: 800 },
      })
    } catch {
      return null
    }
    try {
      const page = await context.newPage()
      await page.setExtraHTTPHeaders({
        "accept-language": "en-US,en;q=0.9",
      })
      try {
        await page.goto(url, { waitUntil, timeout: timeoutMs })
      } catch {
        // Navigation timeout / DNS / etc. — still try to read whatever rendered.
      }
      if (extraDelayMs > 0) {
        await page.waitForTimeout(extraDelayMs)
      }
      try {
        return await page.content()
      } catch {
        return null
      }
    } finally {
      try {
        await context.close()
      } catch {
        // ignore
      }
    }
  }

  return {
    render,
    close: async () => {
      try {
        await browser.close()
      } catch {
        // ignore
      }
    },
  }
}

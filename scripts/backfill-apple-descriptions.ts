/**
 * One-shot Apple-description backfill: phase-2 enrichment using Playwright.
 *
 *   npx tsx scripts/backfill-apple-descriptions.ts                       # dry-run
 *   npx tsx scripts/backfill-apple-descriptions.ts --execute
 *   npx tsx scripts/backfill-apple-descriptions.ts --execute --limit=80 --concurrency=2
 *
 * Apple's careers site is a JS-rendered SPA — HTTP-only fetches return an
 * empty page chrome with no JD content. We render each detail page in a
 * headless Chromium and scrape the rendered DOM. Per fetch is ~2-5s; cap
 * `--limit` for bounded runs, and use `--min-length` to control which rows
 * count as stale (default: < 800 chars).
 *
 * Idempotent — re-runs only touch rows still under the threshold.
 *
 * Heads-up: requires `chromium` to be installed via `npx playwright install
 * chromium` (or the Dockerfile equivalent). Without the binary, the script
 * fails fast with an explanatory error.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import type { Browser } from "playwright"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "500", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "2", 10))
const minLength = Math.max(0, Number.parseInt(getArg("--min-length=") ?? "800", 10))

const APPLE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const PAGE_RENDER_WAIT_MS = 20_000
const NAV_TIMEOUT_MS = 30_000
const MIN_USEFUL_DESCRIPTION = 200

type CandidateRow = {
  job_id: string
  job_apply_url: string
  job_description: string | null
}

async function loadCandidates(): Promise<CandidateRow[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<CandidateRow>(
    `SELECT id          AS job_id,
            apply_url   AS job_apply_url,
            description AS job_description
       FROM jobs
      WHERE is_active = true
        AND apply_url ILIKE 'https://jobs.apple.com/%'
        AND (description IS NULL OR length(description) < $2)
      ORDER BY first_detected_at DESC NULLS LAST
      LIMIT $1`,
    [limit, minLength]
  )
  return rows
}

async function renderAppleDetail(browser: Browser, url: string): Promise<string | null> {
  const context = await browser.newContext({
    userAgent: APPLE_UA,
    locale: "en-US",
    viewport: { width: 1280, height: 1800 },
  })
  await context.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" })
  const page = await context.newPage()
  page.setDefaultTimeout(NAV_TIMEOUT_MS)
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
    // Apple renders the body shortly after first paint. Wait for either the
    // "Description" heading or the rendered article to appear, then read.
    await page
      .waitForFunction(
        () => {
          const text = document.body?.innerText ?? ""
          return (
            text.length > 1200 &&
            /description|qualifications|minimum/i.test(text)
          )
        },
        undefined,
        { timeout: PAGE_RENDER_WAIT_MS }
      )
      .catch(() => null)

    const text = await page.evaluate(() => {
      const full = (document.body?.innerText ?? "").replace(/ /g, " ")
      // Cut off the global footer / shop nav so we don't store apple.com
      // store directory text alongside the JD.
      const footerMarkers = [
        "Apple is an equal opportunity employer",
        "Apple Footer",
        "Shopping Bag",
        "Privacy Policy",
        "Open Menu Close Menu",
      ]
      let body = full
      for (const marker of footerMarkers) {
        const idx = body.indexOf(marker)
        if (idx >= 0) body = body.slice(0, idx)
      }
      // Apple detail pages have a predictable header: "...Back to search
      // results <title> <location> Submit Resume Summary Posted: <date>".
      // The JD body begins right after the "Posted:" line; fall back to the
      // raw text if no anchor matches.
      const startPatterns = [
        /Posted:\s*[A-Z][a-z]+\s+\d{1,2},\s+\d{4}/,
        /Submit Resume\s*Summary\s+/i,
        /About the Role/i,
        /Job Summary/i,
      ]
      for (const re of startPatterns) {
        const m = body.match(re)
        if (m && m.index !== undefined && m.index > 0) {
          body = body.slice(m.index + m[0].length)
          break
        }
      }
      return body.replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000)
    })
    return text && text.length >= MIN_USEFUL_DESCRIPTION ? text : null
  } finally {
    await context.close().catch(() => {})
  }
}

async function main() {
  console.log(
    `[backfill-apple-descriptions] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} concurrency=${concurrency} min-length=${minLength}`
  )

  const candidates = await loadCandidates()
  console.log(`[backfill-apple-descriptions] loaded ${candidates.length} candidates`)
  if (candidates.length === 0) return

  let chromium: typeof import("playwright").chromium
  try {
    ;({ chromium } = await import("playwright"))
  } catch (error) {
    console.error(
      "[backfill-apple-descriptions] failed to import playwright. Run `npx playwright install chromium` first."
    )
    throw error
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  })

  let enriched = 0
  let updated = 0
  let unchanged = 0
  let fetchFailed = 0
  let processed = 0
  const total = candidates.length
  const progressEvery = Math.max(20, Math.floor(total / 20))
  const pool = getPostgresPool()
  const limiter = pLimit(concurrency)

  try {
    await Promise.all(
      candidates.map((row) =>
        limiter(async () => {
          processed += 1
          if (processed % progressEvery === 0) {
            console.log(
              `[backfill-apple-descriptions] progress ${processed}/${total} enriched=${enriched} fetchFailed=${fetchFailed} unchanged=${unchanged}`
            )
          }
          let description: string | null = null
          try {
            description = await renderAppleDetail(browser, row.job_apply_url)
          } catch {
            fetchFailed += 1
            return
          }
          if (!description) {
            fetchFailed += 1
            return
          }
          if (description.length <= (row.job_description?.length ?? 0)) {
            unchanged += 1
            return
          }
          enriched += 1
          if (dryRun) return
          await pool.query(
            `UPDATE jobs SET description = $2, updated_at = now() WHERE id = $1`,
            [row.job_id, description]
          )
          updated += 1
        })
      )
    )
  } finally {
    await browser.close().catch(() => {})
  }

  console.log(
    `[backfill-apple-descriptions] done enriched=${enriched} updated=${updated} unchanged=${unchanged} fetchFailed=${fetchFailed}`
  )
  await pool.end()
}

main().catch((error) => {
  console.error("[backfill-apple-descriptions] fatal:", error)
  process.exit(1)
})

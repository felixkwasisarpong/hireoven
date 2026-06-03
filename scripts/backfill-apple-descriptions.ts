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
import { renderAppleDetail } from "@/lib/harvester/adapters/apple"
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

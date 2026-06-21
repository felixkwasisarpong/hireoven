/**
 * One-off: re-enrich Infosys job descriptions.
 *
 * Infosys detail pages previously got scraped as the whole <body>, leaving the
 * stored description polluted with the language selector + breadcrumb nav
 * ("English - Spanish - ... Infosys Careers Explore Opportunities Jobs in USA").
 * `lib/jobs/description.ts` now has a dedicated `.description-content` extractor,
 * but those rows are too long to be picked up by the normal short-description
 * backfill, so this script force-overwrites them.
 *
 *   npx tsx scripts/reenrich-infosys-descriptions.ts                # dry-run
 *   npx tsx scripts/reenrich-infosys-descriptions.ts --execute
 *   npx tsx scripts/reenrich-infosys-descriptions.ts --execute --concurrency=4
 *
 * Idempotent: only writes when the freshly-extracted description is valid
 * (>= MIN_LEN, no nav-junk signature) and differs from what's stored.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { fetchJobDescription } from "@/lib/jobs/description"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const execute = args.includes("--execute")
const getArg = (p: string) => args.find((a) => a.startsWith(p))?.split("=")[1]
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "4", 10))
const timeoutMs = Math.max(2000, Number.parseInt(getArg("--timeout-ms=") ?? "20000", 10))
const limit = Number.parseInt(getArg("--limit=") ?? "0", 10) || null

const MIN_LEN = 300
// Signature of the old whole-page scrape we are replacing.
const NAV_JUNK_RE = /Explore Opportunities|Infosys Careers Explore/i

type Row = { id: string; apply_url: string; description: string | null }

async function main() {
  console.log(
    `[reenrich-infosys] mode=${execute ? "execute" : "dry-run"} concurrency=${concurrency}${limit ? ` limit=${limit}` : ""}`
  )

  const pool = getPostgresPool()
  const { rows } = await pool.query<Row>(
    `SELECT id, apply_url, description
       FROM jobs
      WHERE source_ats = 'infosys'
        AND is_active = true
        AND apply_url IS NOT NULL
      ORDER BY first_detected_at DESC NULLS LAST
      ${limit ? `LIMIT ${limit}` : ""}`
  )
  console.log(`[reenrich-infosys] loaded ${rows.length} candidates`)
  if (rows.length === 0) return

  const limiter = pLimit(concurrency)
  let updated = 0
  let fetchFailed = 0
  let tooShort = 0
  let unchanged = 0
  let stillJunk = 0
  let processed = 0

  await Promise.all(
    rows.map((row) =>
      limiter(async () => {
        processed += 1
        const desc = await fetchJobDescription(row.apply_url, timeoutMs)
        if (!desc) {
          fetchFailed += 1
        } else if (desc.length < MIN_LEN) {
          tooShort += 1
        } else if (NAV_JUNK_RE.test(desc)) {
          // Extractor still returned chrome — don't write it.
          stillJunk += 1
        } else if (desc === row.description) {
          unchanged += 1
        } else {
          if (execute) {
            await pool.query(
              `UPDATE jobs SET description = $1, updated_at = now() WHERE id = $2`,
              [desc, row.id]
            )
          }
          updated += 1
        }
        if (processed % 100 === 0) {
          console.log(
            `[reenrich-infosys] progress=${processed}/${rows.length} updated=${updated} fetchFailed=${fetchFailed} tooShort=${tooShort} stillJunk=${stillJunk} unchanged=${unchanged}`
          )
        }
      })
    )
  )

  console.log(
    `[reenrich-infosys] done updated=${updated} fetchFailed=${fetchFailed} tooShort=${tooShort} stillJunk=${stillJunk} unchanged=${unchanged} processed=${processed}`
  )
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

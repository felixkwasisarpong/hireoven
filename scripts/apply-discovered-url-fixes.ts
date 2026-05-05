/**
 * Apply discovery proposals (confidence=high) from
 *   data/zero-jobs-dead-url-proposals.csv
 * to the companies table, then re-crawl each affected row and report
 * how many flipped from zero to non-zero jobs.
 *
 * Usage:
 *   npx tsx scripts/apply-discovered-url-fixes.ts             # dry-run
 *   npx tsx scripts/apply-discovered-url-fixes.ts --execute   # write + crawl
 *   npx tsx scripts/apply-discovered-url-fixes.ts --execute --confidence=high,medium
 */

import fs from "node:fs"
import { parse } from "csv-parse/sync"
import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { detectAtsFromUrl } from "@/lib/companies/detect-ats"
import { crawlCareersPage } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"

loadEnvConfig(process.cwd())

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  if (msg.includes("Controller is already closed")) return
  console.error("unhandledRejection:", reason)
  process.exit(1)
})

const execute = process.argv.includes("--execute")
const inputArg = process.argv.find((a) => a.startsWith("--input="))?.split("=")[1] ??
  "data/zero-jobs-dead-url-proposals.csv"
const confArg = process.argv.find((a) => a.startsWith("--confidence="))?.split("=")[1] ?? "high"
const allowed = new Set(confArg.split(",").map((c) => c.trim().toLowerCase()))

type ProposalRow = {
  id: string
  name: string
  domain: string
  old_url: string
  old_ats: string
  new_url: string
  new_ats: string
  confidence: string
  reason: string
}

function getPool() {
  const conn = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!conn) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString: conn,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
}

function rootDomain(host: string): string {
  // Drop "www." and take the last 2 labels (good enough for skipping cross-company redirects).
  const cleaned = host.replace(/^www\./, "")
  const parts = cleaned.split(".")
  return parts.length >= 2 ? parts.slice(-2).join(".") : cleaned
}

function sameRootDomain(a: string, b: string): boolean {
  try {
    return rootDomain(new URL(a).hostname.toLowerCase()) ===
      rootDomain(new URL(b).hostname.toLowerCase())
  } catch {
    return false
  }
}

const KNOWN_ATS_HOST_RE =
  /(myworkdayjobs\.com|greenhouse\.io|lever\.co|ashbyhq\.com|icims\.com|smartrecruiters\.com|bamboohr\.com|successfactors\.com|sapsf\.com|taleo\.net|workable\.com|csod\.com|jobvite\.com|jobs\.jobvite\.com)/i

async function main() {
  const csv = fs.readFileSync(inputArg, "utf-8")
  const rows = parse(csv, { columns: true, skip_empty_lines: true }) as ProposalRow[]
  const targets = rows.filter((r) => {
    if (!allowed.has(r.confidence.toLowerCase())) return false
    if (!r.new_url) return false
    // For high confidence rows we require a detected ATS. Medium-confidence rows are
    // "URL works as careers page, no ATS detected" — we'll apply them as ats_type=custom
    // but only if the new URL stays on the same root domain OR points at a known ATS host
    // (so we never silently flip a company's careers URL to a totally unrelated company).
    if (r.confidence.toLowerCase() === "medium") {
      const onSameDomain = sameRootDomain(r.old_url, r.new_url) ||
        sameRootDomain(`https://${r.domain}`, r.new_url)
      const onAtsHost = KNOWN_ATS_HOST_RE.test(r.new_url)
      if (!onSameDomain && !onAtsHost) return false
      return true
    }
    // High confidence requires both new_url and new_ats.
    return Boolean(r.new_ats)
  })

  console.log(`[apply] mode=${execute ? "EXECUTE" : "DRY-RUN"} | confidence=${[...allowed].join(",")} | targets=${targets.length}`)

  if (targets.length === 0) {
    console.log("Nothing to apply.")
    return
  }

  const pool = getPool()
  let recovered = 0
  let stillEmpty = 0
  let errors = 0

  try {
    for (const row of targets) {
      const detection = detectAtsFromUrl(row.new_url)
      // Prefer URL-based detection. Fallback: proposal's new_ats. For medium rows with
      // no ATS detected, mark as "custom" so the crawler picks a generic extractor.
      const atsType = detection?.atsType ?? (row.new_ats || "custom")
      const atsIdentifier = detection?.atsIdentifier ?? null

      console.log(`\n${row.name}`)
      console.log(`  old: [${row.old_ats || "null"}] ${row.old_url}`)
      console.log(`  new: [${atsType}] ${row.new_url}${atsIdentifier ? ` (id=${atsIdentifier})` : ""}`)

      if (!execute) continue

      try {
        await pool.query(
          `UPDATE companies
           SET careers_url = $1,
               ats_type = $2,
               ats_identifier = COALESCE($3, ats_identifier)
           WHERE id = $4`,
          [row.new_url, atsType, atsIdentifier, row.id]
        )

        const CRAWL_TIMEOUT_MS = 60_000
        const crawled = await Promise.race([
          crawlCareersPage({
            id: row.id,
            companyName: row.name,
            careersUrl: row.new_url,
            lastCrawledAt: null,
            atsType,
            atsIdentifier,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`crawl timeout after ${CRAWL_TIMEOUT_MS}ms`)),
              CRAWL_TIMEOUT_MS
            )
          ),
        ])

        const persisted = await persistCrawlJobs({
          companyId: row.id,
          crawledAt: crawled.crawledAt,
          jobs: crawled.jobs,
          sourceUrl: crawled.url,
          normalizedUrl: crawled.normalizedUrl,
          diagnostics: crawled.diagnostics,
        })

        console.log(
          `  crawl: found=${crawled.jobs.length} inserted=${persisted.inserted} active=${persisted.activeCount}`
        )
        if (crawled.jobs.length > 0) recovered += 1
        else stillEmpty += 1
      } catch (err) {
        errors += 1
        console.log(`  ERROR: ${err instanceof Error ? err.message.slice(0, 140) : String(err)}`)
      }
    }

    if (execute) {
      console.log(
        `\nResults: ${recovered} recovered (jobs found), ${stillEmpty} still empty, ${errors} errors`
      )
    } else {
      console.log("\nDry-run complete. Re-run with --execute to write + crawl.")
    }
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

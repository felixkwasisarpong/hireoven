/**
 * Generic backfill for ANY job with a missing/short description.
 *
 * Uses `fetchJobDescription` from lib/jobs/description.ts which knows how to
 * read Workday/Lever/Greenhouse + falls back to generic HTML scraping
 * (JSON-LD JobPosting → OpenGraph → article/main text). No AI required.
 *
 *   npx tsx scripts/backfill-descriptions-generic.ts                              # dry-run, all sources
 *   npx tsx scripts/backfill-descriptions-generic.ts --execute --limit=20000      # run 20K
 *   npx tsx scripts/backfill-descriptions-generic.ts --execute --source=crawler   # only crawler-tagged
 *   npx tsx scripts/backfill-descriptions-generic.ts --execute --ats=icims        # only iCIMS adapter (source_ats)
 *   npx tsx scripts/backfill-descriptions-generic.ts --execute --company-ats=workday  # crawler jobs for workday companies
 *
 * --company-ats filters by companies.ats_type (useful for crawler jobs where source_ats IS NULL
 * but the company has a known ATS). Unlike --ats which filters source_ats.
 *
 * Idempotent — only touches rows whose description is < min-length.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { fetchJobDescription } from "@/lib/jobs/description"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const execute = args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "10000", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "8", 10))
const minLength = Math.max(0, Number.parseInt(getArg("--min-length=") ?? "300", 10))
const sourceFilter = getArg("--source=") ?? null      // 'crawler' | 'harvester' | 'dice' | ...
const atsFilter = getArg("--ats=") ?? null            // 'icims' | 'smartrecruiters' | 'workday' | ...
const companyAtsFilter = getArg("--company-ats=") ?? null  // filter by companies.ats_type for crawler jobs
const timeoutMs = Math.max(2000, Number.parseInt(getArg("--timeout-ms=") ?? "12000", 10))

type Row = {
  id: string
  apply_url: string
  description: string | null
}

async function loadCandidates(): Promise<Row[]> {
  const pool = getPostgresPool()

  if (companyAtsFilter) {
    // For crawler jobs (source_ats IS NULL) from companies with a known ats_type.
    const { rows } = await pool.query<Row>(
      `SELECT j.id, j.apply_url, j.description
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
        WHERE j.is_active = true
          AND j.closed_at IS NULL
          AND j.apply_url IS NOT NULL
          AND (j.description IS NULL OR length(j.description) < $1)
          AND j.source_ats IS NULL
          AND c.ats_type = $2
        ORDER BY j.first_detected_at DESC NULLS LAST
        LIMIT $3`,
      [minLength, companyAtsFilter, limit]
    )
    return rows
  }

  const where: string[] = [
    "is_active = true",
    "closed_at IS NULL",
    "apply_url IS NOT NULL",
    "(description IS NULL OR length(description) < $1)",
  ]
  const params: Array<string | number> = [minLength]
  if (sourceFilter) {
    params.push(sourceFilter)
    where.push(`raw_data->>'source' = $${params.length}`)
  }
  if (atsFilter) {
    params.push(atsFilter)
    where.push(`source_ats = $${params.length}`)
  }
  params.push(limit)
  const { rows } = await pool.query<Row>(
    `SELECT id, apply_url, description
       FROM jobs
      WHERE ${where.join(" AND ")}
      ORDER BY first_detected_at DESC NULLS LAST
      LIMIT $${params.length}`,
    params
  )
  return rows
}

function isTransientPgError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes("administrator command") ||
    msg.includes("Connection terminated") ||
    msg.includes("connection terminated") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("Client has encountered a connection error") ||
    msg.includes("server closed the connection") ||
    msg.includes("read ECONNRESET")
  )
}

async function updateWithRetry(
  id: string,
  description: string,
  maxAttempts = 5
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const pool = getPostgresPool()
      await pool.query(
        `UPDATE jobs SET description = $1, updated_at = now() WHERE id = $2`,
        [description, id]
      )
      return
    } catch (err) {
      if (attempt === maxAttempts || !isTransientPgError(err)) {
        console.error(`[backfill-descriptions] update failed for ${id}:`, err)
        return
      }
      const backoff = 500 * 2 ** (attempt - 1)
      console.warn(
        `[backfill-descriptions] transient pg error on ${id} (attempt ${attempt}), retrying in ${backoff}ms`
      )
      await new Promise((resolve) => setTimeout(resolve, backoff))
    }
  }
}

async function main() {
  console.log(
    `[backfill-descriptions] mode=${execute ? "execute" : "dry-run"} limit=${limit} concurrency=${concurrency} min-length=${minLength}` +
      (sourceFilter ? ` source=${sourceFilter}` : "") +
      (atsFilter ? ` ats=${atsFilter}` : "") +
      (companyAtsFilter ? ` company-ats=${companyAtsFilter}` : "")
  )

  process.on("unhandledRejection", (reason) => {
    if (isTransientPgError(reason)) {
      console.warn("[backfill-descriptions] swallowed transient pg error:", reason)
      return
    }
    console.error("[backfill-descriptions] unhandledRejection:", reason)
  })
  getPostgresPool().on("error", (err) => {
    console.warn("[backfill-descriptions] idle pg client error (recoverable):", err.message)
  })

  const candidates = await loadCandidates()
  console.log(`[backfill-descriptions] loaded ${candidates.length} candidates`)
  if (candidates.length === 0) return

  const pool = getPostgresPool()
  const limiter = pLimit(concurrency)

  let enriched = 0
  let fetchFailed = 0
  let tooShort = 0
  let processed = 0

  await Promise.all(
    candidates.map((row) =>
      limiter(async () => {
        processed += 1
        const description = await fetchJobDescription(row.apply_url, timeoutMs)
        if (!description) {
          fetchFailed += 1
        } else if (description.length < minLength) {
          tooShort += 1
        } else if (description.length > (row.description?.length ?? 0)) {
          if (execute) {
            await updateWithRetry(row.id, description)
          }
          enriched += 1
        }
        if (processed % 500 === 0) {
          console.log(
            `[backfill-descriptions] progress=${processed}/${candidates.length} enriched=${enriched} fetchFailed=${fetchFailed} tooShort=${tooShort}`
          )
        }
      })
    )
  )

  console.log(
    `[backfill-descriptions] done enriched=${enriched} fetchFailed=${fetchFailed} tooShort=${tooShort} processed=${processed}`
  )

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

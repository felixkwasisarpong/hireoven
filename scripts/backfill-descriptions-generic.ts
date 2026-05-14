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
 *   npx tsx scripts/backfill-descriptions-generic.ts --execute --ats=icims        # only iCIMS adapter
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
const timeoutMs = Math.max(2000, Number.parseInt(getArg("--timeout-ms=") ?? "12000", 10))

type Row = {
  id: string
  apply_url: string
  description: string | null
}

async function loadCandidates(): Promise<Row[]> {
  const pool = getPostgresPool()
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

async function main() {
  console.log(
    `[backfill-descriptions] mode=${execute ? "execute" : "dry-run"} limit=${limit} concurrency=${concurrency} min-length=${minLength}` +
      (sourceFilter ? ` source=${sourceFilter}` : "") +
      (atsFilter ? ` ats=${atsFilter}` : "")
  )

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
            await pool
              .query(
                `UPDATE jobs SET description = $1, updated_at = now() WHERE id = $2`,
                [description, row.id]
              )
              .catch((err) => {
                console.error(`[backfill-descriptions] update failed for ${row.id}:`, err)
              })
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

/**
 * Backfill full descriptions for Adzuna jobs by following their apply_url
 * redirects to the actual job page (Greenhouse, Lever, Workday, company sites).
 *
 * Adzuna's search API truncates descriptions at ~500 chars. This script fetches
 * the real description from the source page and updates it in place WITHOUT
 * changing publication_status — jobs stay visible in the feed throughout.
 *
 * Success rate will be partial: redirects to Dice/Indeed/LinkedIn often fail
 * (those sites block server-side fetches). Company ATS pages (Greenhouse, Lever,
 * Workday, SmartRecruiters, Ashby) tend to succeed.
 *
 * Usage:
 *   npx tsx scripts/backfill-adzuna-descriptions.ts               # dry-run (no fetches)
 *   npx tsx scripts/backfill-adzuna-descriptions.ts --execute
 *   npx tsx scripts/backfill-adzuna-descriptions.ts --execute --limit=2000
 *   npx tsx scripts/backfill-adzuna-descriptions.ts --execute --concurrency=6 --limit=5000
 *
 * Safe to re-run: only processes jobs still under the min-length threshold.
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import pLimit from "p-limit"
import { fetchJobDescription } from "@/lib/jobs/description"
import { normalizePersistedJobRecord } from "@/lib/jobs/normalization"
import { safeJsonStringify } from "@/lib/jobs/json-sanitize"
import type { EmploymentType } from "@/types"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const getArg = (p: string) => process.argv.find((a) => a.startsWith(`--${p}=`))?.split("=")[1]
const limit       = Number(getArg("limit") ?? "0") || 2_000
const concurrency = Math.max(1, Math.min(12, Number(getArg("concurrency") ?? "5")))
const minChars    = Number(getArg("min-chars") ?? "800")
const timeoutMs   = Number(getArg("timeout-ms") ?? "12000")

type Row = {
  id: string
  title: string
  apply_url: string
  description: string | null
  location: string | null
  employment_type: string | null
  seniority_level: string | null
  is_remote: boolean
  is_hybrid: boolean
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  requires_authorization: boolean
  sponsors_h1b: boolean | null
  sponsorship_score: number
  visa_language_detected: string | null
  skills: string[]
  external_id: string
  first_detected_at: string
  raw_data: Record<string, unknown> | null
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) { console.error("Missing DATABASE_URL"); process.exit(1) }

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  })

  const { rows } = await pool.query<Row>(
    `SELECT id, title, apply_url, description, location,
            employment_type, seniority_level, is_remote, is_hybrid,
            salary_min, salary_max, salary_currency,
            requires_authorization, sponsors_h1b, sponsorship_score,
            visa_language_detected, skills, external_id, first_detected_at, raw_data
     FROM jobs
     WHERE is_active = true
       AND external_id ILIKE 'adzuna:%'
       AND is_us_or_ca_strict = true
       AND (description IS NULL OR length(description) < $1)
     ORDER BY first_detected_at DESC
     LIMIT $2`,
    [minChars, limit]
  )

  console.log(`${execute ? "EXECUTE" : "DRY-RUN"} — ${rows.length} Adzuna jobs with description < ${minChars} chars (cap: ${limit})`)
  if (!execute) {
    console.log("Sample apply URLs:")
    rows.slice(0, 8).forEach((r) => console.log(`  [${r.description?.length ?? 0}ch] ${r.title.slice(0, 50)} → ${r.apply_url.slice(0, 70)}`))
    console.log("\nRun with --execute to fetch and update descriptions.")
    await pool.end()
    return
  }

  let enriched = 0, failed = 0, skipped = 0
  const limiter = pLimit(concurrency)

  await Promise.all(
    rows.map((row) =>
      limiter(async () => {
        let newDesc: string | null = null
        try {
          newDesc = await fetchJobDescription(row.apply_url, timeoutMs)
        } catch { /* timeout / network error */ }

        if (!newDesc || newDesc.trim().length < 200) {
          failed++
          return
        }
        // Only update if the fetched description is meaningfully longer
        const currentLen = row.description?.length ?? 0
        if (newDesc.trim().length <= currentLen * 1.2) {
          skipped++
          return
        }

        // Re-run normalizer with the full description
        const norm = normalizePersistedJobRecord({
          id: row.id,
          title: row.title,
          normalized_title: null,
          location: row.location,
          apply_url: row.apply_url,
          external_id: row.external_id,
          description: newDesc,
          employment_type: row.employment_type as EmploymentType | null,
          seniority_level: row.seniority_level,
          is_remote: row.is_remote,
          is_hybrid: row.is_hybrid,
          salary_min: row.salary_min,
          salary_max: row.salary_max,
          salary_currency: row.salary_currency,
          sponsors_h1b: row.sponsors_h1b,
          sponsorship_score: row.sponsorship_score ?? 0,
          requires_authorization: row.requires_authorization,
          visa_language_detected: row.visa_language_detected,
          skills: row.skills ?? [],
          first_detected_at: row.first_detected_at,
          raw_data: row.raw_data ?? {},
        })
        const nc = norm.nextColumns

        const nextRaw = safeJsonStringify({
          ...(row.raw_data ?? {}),
          description_backfill: {
            fetched_at: new Date().toISOString(),
            original_length: currentLen,
            fetched_length: newDesc.trim().length,
          },
        })

        try {
          await pool.query(
            `UPDATE jobs
             SET description=$1, normalized_title=$2, skills=$3,
                 seniority_level=$4, employment_type=$5,
                 requires_authorization=$6, sponsors_h1b=$7,
                 sponsorship_score=$8, visa_language_detected=$9,
                 raw_data=$10, updated_at=now()
             WHERE id=$11`,
            [
              nc.description, nc.normalized_title, nc.skills,
              nc.seniority_level, nc.employment_type,
              nc.requires_authorization, nc.sponsors_h1b,
              nc.sponsorship_score, nc.visa_language_detected,
              nextRaw, row.id,
            ]
          )
          enriched++
          if (enriched <= 20 || enriched % 100 === 0) {
            console.log(`  ✓ [${enriched}] ${row.title.slice(0, 50)} (${currentLen} → ${newDesc.trim().length} chars)`)
          }
        } catch (err) {
          console.error(`  ✗ DB update failed for ${row.id}: ${(err as Error).message}`)
          failed++
        }
      })
    )
  )

  console.log(`\nDone. enriched=${enriched}  failed=${failed}  skipped(no improvement)=${skipped}`)
  await pool.end()
}

main().catch((e) => { console.error(e.message); process.exit(1) })

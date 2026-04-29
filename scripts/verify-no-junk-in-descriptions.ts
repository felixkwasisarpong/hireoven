/**
 * Scan active jobs.description for chrome / nav / auth phrases that should
 * never survive normalization. Exits non-zero if any are found, so this can
 * be wired into CI as a quality gate.
 *
 * Usage:
 *   npx tsx scripts/verify-no-junk-in-descriptions.ts
 *   npx tsx scripts/verify-no-junk-in-descriptions.ts --csv         # list every match
 *   npx tsx scripts/verify-no-junk-in-descriptions.ts --max-rows=5  # cap sample rows
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"

loadEnvConfig(process.cwd())

const csvOnly = process.argv.includes("--csv")
const maxRowsArg = process.argv.find((arg) => arg.startsWith("--max-rows="))
const maxRows = Math.max(1, Number(maxRowsArg?.split("=")[1] ?? "10"))

function getPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString,
    ssl:
      process.env.PGSSLMODE === "require"
        ? { rejectUnauthorized: false }
        : undefined,
  })
}

const JUNK_PHRASES = [
  "Skip to main content",
  "Skip to content",
  "Sign in to create job alert",
  "Sign in to save",
  "Create job alert",
  "Get notified about similar jobs",
  "Cookie Policy",
  "Cookie Notice",
  "Related jobs",
  "Similar jobs",
  "Recommended jobs",
  "Back to results",
  "Back to search",
  "Be an early applicant",
  "Easy apply",
]

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

async function main() {
  const pool = getPool()

  try {
    const phraseCounts = new Map<string, number>()
    const flaggedRowsByPhrase = new Map<
      string,
      Array<{ id: string; company: string | null; title: string; snippet: string }>
    >()

    if (csvOnly) {
      console.log(["job_id", "company", "title", "phrase", "snippet"].map(csvEscape).join(","))
    }

    for (const phrase of JUNK_PHRASES) {
      const { rows } = await pool.query<{
        id: string
        company_name: string | null
        title: string
        description: string
      }>(
        `SELECT j.id, c.name AS company_name, j.title, j.description
         FROM jobs j
         LEFT JOIN companies c ON c.id = j.company_id
         WHERE j.is_active = true
           AND j.description ILIKE '%' || $1 || '%'
         ORDER BY j.updated_at DESC
         LIMIT 200`,
        [phrase]
      )

      phraseCounts.set(phrase, rows.length)
      const samples = rows.slice(0, maxRows).map((row) => {
        const idx = row.description.toLowerCase().indexOf(phrase.toLowerCase())
        const start = Math.max(0, idx - 40)
        const end = Math.min(row.description.length, idx + phrase.length + 60)
        return {
          id: row.id,
          company: row.company_name,
          title: row.title,
          snippet: row.description.slice(start, end).replace(/\s+/g, " ").trim(),
        }
      })
      flaggedRowsByPhrase.set(phrase, samples)

      if (csvOnly) {
        for (const sample of samples) {
          console.log(
            [sample.id, sample.company, sample.title, phrase, sample.snippet]
              .map(csvEscape)
              .join(",")
          )
        }
      }
    }

    if (csvOnly) {
      const total = [...phraseCounts.values()].reduce((sum, n) => sum + n, 0)
      if (total > 0) process.exitCode = 1
      return
    }

    let total = 0
    console.log("Junk phrase counts in active jobs.description:")
    for (const phrase of JUNK_PHRASES) {
      const count = phraseCounts.get(phrase) ?? 0
      total += count
      console.log(`  ${count.toString().padStart(5)}  ${phrase}`)
    }
    console.log(`\nTotal flagged matches: ${total}\n`)

    if (total === 0) {
      console.log("✓ No chrome/nav/auth phrases detected.")
      return
    }

    console.log("Sample rows:")
    for (const phrase of JUNK_PHRASES) {
      const samples = flaggedRowsByPhrase.get(phrase) ?? []
      if (samples.length === 0) continue
      console.log(`\n  [${phrase}]`)
      for (const sample of samples) {
        console.log(
          `    ${sample.title.slice(0, 40).padEnd(40)} (${sample.company ?? "?"}) — …${sample.snippet}…`
        )
      }
    }

    console.log(
      `\nRun jobs:apply-extraction-fixes after the normalization changes ship to clean these.`
    )
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

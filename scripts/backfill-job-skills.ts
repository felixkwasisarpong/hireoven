/**
 * Re-extract `jobs.skills` for every active job from its title + description
 * using the current taxonomy (with boilerplate stripping).
 *
 * The historical AI-normalizer hallucinated soft skills ("Writing", "Public
 * Speaking") and false-positived on EEO / anti-fraud copy ("Recruiting",
 * "Compensation"). The deterministic extractor in lib/skills/taxonomy.ts now
 * strips boilerplate sentences before scanning, so re-running it cleans the
 * stored array.
 *
 * Usage:
 *   npx tsx scripts/backfill-job-skills.ts --dry-run
 *   npx tsx scripts/backfill-job-skills.ts --limit=1000
 *   npx tsx scripts/backfill-job-skills.ts            # full run (~330K rows)
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "../lib/postgres/server"
import {
  extractSkillsFromText,
  normalizeSkillList,
} from "../lib/skills/taxonomy"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const verbose = args.includes("--verbose")
const limitArg = args.find((a) => a.startsWith("--limit="))
const batchArg = args.find((a) => a.startsWith("--batch="))
const limit = limitArg ? Math.max(0, Number(limitArg.split("=")[1])) : 0
const batchSize = batchArg ? Math.max(50, Number(batchArg.split("=")[1])) : 500

type JobRow = {
  id: string
  title: string
  description: string | null
  skills: string[] | null
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

async function main() {
  const pool = getPostgresPool()
  console.log(
    `Backfilling jobs.skills (dry-run=${dryRun}, limit=${limit || "all"}, batch=${batchSize})`
  )

  const countRes = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM jobs WHERE is_active = true`
  )
  const totalActive = Number(countRes.rows[0]?.count ?? 0)
  console.log(`Active jobs to process: ${totalActive.toLocaleString()}`)

  let processed = 0
  let changed = 0
  let unchanged = 0
  let emptied = 0
  let lastId: string | null = null
  const examples: Array<{ id: string; title: string; before: string[]; after: string[] }> = []

  // Keyset pagination via id ordering — stable across the run.
  while (true) {
    const queryLimit = limit > 0 ? Math.min(batchSize, limit - processed) : batchSize
    if (queryLimit <= 0) break

    const params: Array<string | number> = [queryLimit]
    let sql = `SELECT id, title, description, skills
               FROM jobs
               WHERE is_active = true`
    if (lastId) {
      sql += ` AND id > $2`
      params.push(lastId)
    }
    sql += ` ORDER BY id LIMIT $1`

    const rowsRes = await pool.query<JobRow>(sql, params)
    if (rowsRes.rows.length === 0) break

    const updates: Array<{ id: string; skills: string[] }> = []
    for (const row of rowsRes.rows) {
      const stored = (row.skills ?? []).map((s) => s.trim()).filter(Boolean)
      const extracted = normalizeSkillList(
        extractSkillsFromText(row.title, row.description),
        24
      )

      if (!arraysEqual(stored, extracted)) {
        updates.push({ id: row.id, skills: extracted })
        if (extracted.length === 0 && stored.length > 0) emptied++
        if (examples.length < 5 && stored.length > 0) {
          examples.push({
            id: row.id,
            title: row.title,
            before: stored,
            after: extracted,
          })
        }
      } else {
        unchanged++
      }
    }

    if (!dryRun && updates.length > 0) {
      // Single batched UPDATE via VALUES join.
      const valuesParams: Array<string | string[]> = []
      const tuples = updates
        .map((u, i) => {
          const idIdx = i * 2 + 1
          const skillsIdx = i * 2 + 2
          valuesParams.push(u.id, u.skills)
          return `($${idIdx}::uuid, $${skillsIdx}::text[])`
        })
        .join(", ")
      await pool.query(
        `UPDATE jobs j
         SET skills = v.skills, updated_at = now()
         FROM (VALUES ${tuples}) AS v(id, skills)
         WHERE j.id = v.id`,
        valuesParams
      )
    }

    changed += updates.length
    processed += rowsRes.rows.length
    lastId = rowsRes.rows[rowsRes.rows.length - 1].id

    if (verbose || processed % 5000 < batchSize) {
      console.log(
        `  processed=${processed.toLocaleString()} changed=${changed.toLocaleString()} ` +
          `unchanged=${unchanged.toLocaleString()} emptied=${emptied.toLocaleString()}`
      )
    }
  }

  console.log("\n— Summary —")
  console.log(`Processed:    ${processed.toLocaleString()}`)
  console.log(`Changed:      ${changed.toLocaleString()}`)
  console.log(`Unchanged:    ${unchanged.toLocaleString()}`)
  console.log(`Emptied:      ${emptied.toLocaleString()} (had skills, now none)`)
  console.log(`Mode:         ${dryRun ? "DRY RUN — no writes" : "LIVE — updates applied"}`)

  if (examples.length > 0) {
    console.log("\n— Sample diffs —")
    for (const ex of examples) {
      console.log(`\n  ${ex.id}  ${ex.title}`)
      console.log(`    before: ${ex.before.join(", ")}`)
      console.log(`    after:  ${ex.after.join(", ") || "(none)"}`)
    }
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

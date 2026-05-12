/**
 * Batch skill enrichment.
 *
 *   npx tsx scripts/enrich-job-skills.ts                       # dry-run
 *   npx tsx scripts/enrich-job-skills.ts --execute
 *   npx tsx scripts/enrich-job-skills.ts --execute --limit=5000
 *   npx tsx scripts/enrich-job-skills.ts --execute --since=7d
 *   npx tsx scripts/enrich-job-skills.ts --execute --refresh-all
 *
 * Scans active jobs whose `skills[]` is empty or sparse (or all jobs with
 * --refresh-all), extracts skills from `title + description`, and UPDATEs
 * with the union of existing + extracted skills (case-insensitive dedup).
 *
 * Designed for a nightly cron. Idempotent — safe to re-run.
 */

import { loadEnvConfig } from "@next/env"
import { extractSkills, mergeSkills } from "@/lib/jobs/skills-extractor"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")
const refreshAll = args.includes("--refresh-all")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "2000", 10))
const sinceArg = getArg("--since=") ?? "30d"

function parseSinceToInterval(value: string): string {
  // Accept "7d", "24h", "60m"; default "30d".
  const m = value.match(/^(\d+)([dhm])$/)
  if (!m) return "30 days"
  const n = m[1]
  const unit = m[2]
  if (unit === "d") return `${n} days`
  if (unit === "h") return `${n} hours`
  if (unit === "m") return `${n} minutes`
  return "30 days"
}

type JobRow = {
  id: string
  title: string
  description: string | null
  skills: string[] | null
}

async function loadCandidates(): Promise<JobRow[]> {
  const pool = getPostgresPool()
  const interval = parseSinceToInterval(sinceArg)

  const sparseFilter = refreshAll
    ? ""
    : "AND (skills IS NULL OR cardinality(skills) < 3)"

  const { rows } = await pool.query<JobRow>(
    `SELECT id, title, description, skills
     FROM jobs
     WHERE is_active = true
       AND closed_at IS NULL
       AND description IS NOT NULL
       AND first_detected_at >= now() - $1::interval
       ${sparseFilter}
     ORDER BY first_detected_at DESC
     LIMIT $2`,
    [interval, limit]
  )
  return rows
}

async function applyEnrichment(updates: Array<{ id: string; skills: string[] }>): Promise<void> {
  if (updates.length === 0) return
  const pool = getPostgresPool()
  // jsonb_array_elements pattern — same shape as persist-bulk's update path.
  await pool.query(
    `UPDATE jobs
     SET skills = (
       SELECT array_agg(s)
       FROM jsonb_array_elements_text(v->'skills') AS s
     ),
     updated_at = now()
     FROM jsonb_array_elements($1::jsonb) AS v
     WHERE jobs.id = (v->>'id')::uuid`,
    [JSON.stringify(updates.map((u) => ({ id: u.id, skills: u.skills })))]
  )
}

async function main() {
  console.log(
    `[enrich-job-skills] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} since=${sinceArg} refreshAll=${refreshAll}`
  )

  const startedAt = Date.now()
  const candidates = await loadCandidates()
  console.log(`[enrich-job-skills] loaded ${candidates.length} candidate jobs`)

  let changed = 0
  let totalSkillsAdded = 0
  const updates: Array<{ id: string; skills: string[] }> = []

  for (const job of candidates) {
    const text = `${job.title}\n\n${job.description ?? ""}`
    const extracted = extractSkills(text)
    const merged = mergeSkills(job.skills, extracted)
    const existingSize = job.skills?.length ?? 0
    const delta = merged.length - existingSize
    if (delta <= 0) continue
    changed += 1
    totalSkillsAdded += delta
    updates.push({ id: job.id, skills: merged })
  }

  console.log(
    `[enrich-job-skills] scanned=${candidates.length} changed=${changed} newSkillsAdded=${totalSkillsAdded}`
  )

  if (dryRun) {
    console.log(`[enrich-job-skills] dry-run — no UPDATE issued. Elapsed ${Date.now() - startedAt}ms`)
    return
  }

  if (updates.length > 0) {
    // Chunk updates to avoid massive JSON payloads.
    const CHUNK = 500
    for (let i = 0; i < updates.length; i += CHUNK) {
      await applyEnrichment(updates.slice(i, i + CHUNK))
    }
  }

  console.log(
    `[enrich-job-skills] committed ${updates.length} job updates in ${Date.now() - startedAt}ms`
  )
  await getPostgresPool().end()
}

main().catch((error) => {
  console.error("[enrich-job-skills] fatal:", error)
  process.exit(1)
})

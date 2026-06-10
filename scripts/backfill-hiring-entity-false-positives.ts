/**
 * Re-run resolveHiringEntitySignal over every job that has a stored
 * raw_data.hiring_entity and rewrite it with the corrected logic.
 *
 * Fixes the "for our clients and communities" class of false positives, where
 * the plural "clients" was misread as "for our client, <name>" and produced a
 * bogus end-client display name (e.g. RBC showing as "s and communities").
 *
 * Only rows whose signal actually changes are touched. When the corrected logic
 * returns null, the hiring_entity key is removed so the card falls back to the
 * real company name.
 *
 *   npx tsx scripts/backfill-hiring-entity-false-positives.ts          # dry run (full table)
 *   npx tsx scripts/backfill-hiring-entity-false-positives.ts --apply  # write
 *
 * Scope to one company (indexed, light — safe on the memory-constrained web box):
 *   npx tsx scripts/backfill-hiring-entity-false-positives.ts --company <uuid> [--apply]
 *
 * NOTE: the unscoped form seq-scans the whole jobs table (no GIN index on
 * raw_data) and has OOM-restarted the production Postgres box. Prefer --company,
 * or run the full pass off-peak / on the harvester box.
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"
import { resolveHiringEntitySignal } from "@/lib/jobs/hiring-entity"

const APPLY = process.argv.includes("--apply")
const companyArgIdx = process.argv.indexOf("--company")
const COMPANY_ID = companyArgIdx >= 0 ? process.argv[companyArgIdx + 1] ?? null : null

type Row = {
  id: string
  description: string | null
  company_name: string | null
  hiring_entity: {
    display_name?: string | null
    is_staffing_intermediary?: boolean | null
    source?: string | null
  } | null
}

function sameSignal(
  stored: Row["hiring_entity"],
  next: ReturnType<typeof resolveHiringEntitySignal>,
): boolean {
  if (!stored && !next) return true
  if (!stored || !next) return false
  return (
    (stored.display_name ?? null) === (next.display_name ?? null) &&
    Boolean(stored.is_staffing_intermediary) === Boolean(next.is_staffing_intermediary)
  )
}

const BATCH = 2000

// Keyset-paginated to keep client memory bounded — loading every job's
// description at once OOMs the node heap on the production table.
async function main() {
  const pool = getPostgresPool()

  let lastId = "00000000-0000-0000-0000-000000000000"
  let scanned = 0
  let clearedCount = 0
  let rewrittenCount = 0
  const clearedSamples: string[] = []
  const rewrittenSamples: string[] = []

  for (;;) {
    const { rows } = await pool.query<Row & { id: string }>(
      `select j.id,
              j.description,
              c.name as company_name,
              j.raw_data->'hiring_entity' as hiring_entity
         from jobs j
         left join companies c on c.id = j.company_id
        where j.id > $1
          and j.raw_data ? 'hiring_entity'
          ${COMPANY_ID ? "and j.company_id = $3::uuid" : ""}
        order by j.id
        limit $2`,
      COMPANY_ID ? [lastId, BATCH, COMPANY_ID] : [lastId, BATCH],
    )
    if (rows.length === 0) break
    lastId = rows[rows.length - 1].id
    scanned += rows.length

    for (const r of rows) {
      const next = resolveHiringEntitySignal({
        companyName: r.company_name,
        description: r.description,
      })
      if (sameSignal(r.hiring_entity, next)) continue

      if (next === null) {
        clearedCount += 1
        if (clearedSamples.length < 25) {
          clearedSamples.push(`  clear   ${r.id}  [${r.company_name ?? "?"}]  was "${r.hiring_entity?.display_name ?? ""}"`)
        }
        if (APPLY) {
          await pool.query(
            `update jobs set raw_data = raw_data - 'hiring_entity', updated_at = now() where id = $1`,
            [r.id],
          )
        }
      } else {
        rewrittenCount += 1
        if (rewrittenSamples.length < 25) {
          rewrittenSamples.push(`  rewrite ${r.id}  [${r.company_name ?? "?"}]  "${r.hiring_entity?.display_name ?? ""}" → "${next.display_name ?? ""}"`)
        }
        if (APPLY) {
          await pool.query(
            `update jobs set raw_data = jsonb_set(raw_data, '{hiring_entity}', $2::jsonb), updated_at = now() where id = $1`,
            [r.id, JSON.stringify(next)],
          )
        }
      }
    }

    process.stdout.write(`\rscanned ${scanned}  clear ${clearedCount}  rewrite ${rewrittenCount}`)
  }

  console.log(`\n\nscanned (jobs with hiring_entity): ${scanned}`)
  console.log(`${APPLY ? "cleared" : "will clear"} (false positive → real company): ${clearedCount}`)
  console.log(`${APPLY ? "rewrote" : "will rewrite"} (signal changed): ${rewrittenCount}`)
  for (const s of clearedSamples) console.log(s)
  for (const s of rewrittenSamples) console.log(s)
  if (!APPLY) console.log("\n(dry run — pass --apply to write)")
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

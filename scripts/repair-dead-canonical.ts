/**
 * Second-phase dedup repair (run AFTER repair-dedup-cycles.ts).
 *
 * Targets working-adapter company records that are flagged as a duplicate of a
 * canonical that is DEAD / inactive / itself-a-duplicate — so the harvester
 * claim query skips the whole chain and the live board never crawls
 * (Walmart-class). For each such record D:
 *
 *   • If another CANONICAL already owns D's (ats_type, ats_identifier) — the real
 *     survivor — merge D into it (respects uq_companies_ats_pair_active).
 *   • Otherwise promote D itself to canonical + active + due-now so its board
 *     resumes crawling.
 *
 * Never moves jobs. Dry-run by default; --execute to write; --limit=N caps.
 *
 * Usage:
 *   npx tsx scripts/repair-dead-canonical.ts
 *   npx tsx scripts/repair-dead-canonical.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const EXECUTE = args.includes("--execute")
const limitArg = args.find((a) => a.startsWith("--limit="))
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) || 0 : 0

type Row = { id: string; name: string; ats_type: string | null; ats_identifier: string | null }

async function main() {
  const pool = getPostgresPool()

  const { rows: targets } = await pool.query<Row>(`
    SELECT d.id, d.name, d.ats_type, d.ats_identifier
    FROM companies d
    JOIN companies c ON c.id = d.duplicate_of_company_id
    WHERE d.duplicate_of_company_id IS NOT NULL
      AND d.ats_type IS NOT NULL AND d.ats_type NOT IN ('jsonld','custom','')
      AND d.careers_url IS NOT NULL
      AND (c.status = 'dead' OR c.is_active = false OR c.duplicate_of_company_id IS NOT NULL)
    ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ""}
  `)

  console.log(`\nDEAD-CANONICAL REPAIR  (${EXECUTE ? "EXECUTE" : "DRY-RUN"})`)
  console.log(`  broken records: ${targets.length}\n`)
  for (const r of targets.slice(0, 12)) console.log(`  FIX  "${r.name}" (${r.ats_type}/${r.ats_identifier})`)

  if (!EXECUTE) {
    console.log(`\nDry-run only. Re-run with --execute to apply.`)
    await pool.end()
    return
  }

  const client = await pool.connect()
  let promoted = 0
  let merged = 0
  let skipped = 0
  try {
    for (const r of targets) {
      try {
        await client.query("BEGIN")
        let owner: string | null = null
        if (r.ats_type && r.ats_identifier) {
          const { rows } = await client.query<{ id: string }>(
            `SELECT id FROM companies
             WHERE ats_type = $1 AND ats_identifier IS NOT NULL
               AND lower(ats_identifier) = lower($2)
               AND duplicate_of_company_id IS NULL
               AND id <> $3
             LIMIT 1`,
            [r.ats_type, r.ats_identifier, r.id]
          )
          owner = rows[0]?.id ?? null
        }
        if (owner) {
          await client.query(
            `UPDATE companies SET duplicate_of_company_id = $2, is_active = false, updated_at = now() WHERE id = $1`,
            [r.id, owner]
          )
          merged += 1
        } else {
          await client.query(
            `UPDATE companies
             SET duplicate_of_company_id = NULL, is_active = true, status = 'active',
                 crawl_allowed = true, next_harvest_at = now(), updated_at = now()
             WHERE id = $1`,
            [r.id]
          )
          promoted += 1
        }
        await client.query("COMMIT")
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {})
        skipped += 1
        console.log(`  ⚠ skipped "${r.name}": ${(e as Error).message}`)
      }
    }
  } finally {
    client.release()
  }

  console.log(`\n✔ Repaired ${promoted + merged} (promoted ${promoted}, merged-into-owner ${merged}); skipped ${skipped}.`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })

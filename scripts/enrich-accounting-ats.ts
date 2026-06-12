/**
 * One-off enrichment for the Accounting / Tax-tech cohort. Pins verified ATS
 * tokens onto companies the expansion-seed upsert won't fix (it doesn't touch
 * ats_type/ats_identifier on conflict). All tokens confirmed live.
 *
 * Two cases beyond simple NULL-fill:
 *   - bill.com had ats_type=greenhouse but a NULL identifier → fill it.
 *   - ramp.com is seeded greenhouse/ramp but has MIGRATED to Ashby (the
 *     greenhouse board is stale; the live board is ashby/ramp, ~112 jobs).
 *     This is the one row allowed to overwrite a different real ATS, via
 *     `force` — everything else refuses to clobber a real third-party ATS.
 *
 *   npx tsx scripts/enrich-accounting-ats.ts            # dry-run (preview)
 *   npx tsx scripts/enrich-accounting-ats.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Ats = "greenhouse" | "lever" | "ashby"
type Row = { domain: string; ats: Ats; id: string; careers: string; force?: true }
const ROWS: ReadonlyArray<Row> = [
  // existing rows needing an ATS fix
  { domain: "bill.com", ats: "greenhouse", id: "billcom", careers: "https://boards.greenhouse.io/billcom" },
  { domain: "pilot.com", ats: "greenhouse", id: "pilothq", careers: "https://boards.greenhouse.io/pilothq" },
  { domain: "floqast.com", ats: "lever", id: "floqast", careers: "https://jobs.lever.co/floqast" },
  { domain: "ramp.com", ats: "ashby", id: "ramp", careers: "https://jobs.ashbyhq.com/ramp", force: true }, // greenhouse -> ashby migration
  // Cat 58 inserts (backstop — seed sets ATS on insert, this is idempotent)
  { domain: "taxbit.com", ats: "greenhouse", id: "taxbit", careers: "https://boards.greenhouse.io/taxbit" },
  { domain: "rillet.com", ats: "ashby", id: "rillet", careers: "https://jobs.ashbyhq.com/rillet" },
  { domain: "getapril.com", ats: "ashby", id: "april", careers: "https://jobs.ashbyhq.com/april" },
  { domain: "numeric.io", ats: "ashby", id: "numeric", careers: "https://jobs.ashbyhq.com/numeric" },
  { domain: "puzzle.io", ats: "ashby", id: "puzzle", careers: "https://jobs.ashbyhq.com/puzzle" },
  { domain: "columntax.com", ats: "ashby", id: "columntax", careers: "https://jobs.ashbyhq.com/columntax" },
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  let changed = 0, skipped = 0, missing = 0
  for (const r of ROWS) {
    const { rows } = await pool.query<{ name: string; ats_type: string | null }>(
      "SELECT name, ats_type FROM companies WHERE domain = $1",
      [r.domain]
    )
    if (rows.length === 0) { console.log(`MISS  ${r.domain} — not in DB`); missing++; continue }
    const cur = rows[0]
    const blocked = cur.ats_type && cur.ats_type !== r.ats && cur.ats_type !== "custom"
    if (blocked && !r.force) {
      console.log(`SKIP  ${r.domain.padEnd(16)} already ats_type=${cur.ats_type}`)
      skipped++
      continue
    }
    if (execute) {
      await pool.query(
        `UPDATE companies SET ats_type=$2, ats_identifier=$3, careers_url=$4, is_active=true WHERE domain=$1`,
        [r.domain, r.ats, r.id, r.careers]
      )
    }
    changed++
    const note = blocked && r.force ? `  (FORCED over ${cur.ats_type})` : ""
    console.log(`${execute ? "SET " : "WOULD"}  ${cur.name.padEnd(14)} -> ${r.ats}/${r.id}${note}`)
  }
  console.log(`\n${execute ? "Updated" : "Would update"} ${changed}/${ROWS.length}  (skipped ${skipped}, missing ${missing})${execute ? "" : "  — re-run with --execute"}`)
  await pool.end()
}
main()

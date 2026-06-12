/**
 * One-off enrichment for the Retail / E-commerce cohort. Pins verified ATS
 * tokens onto companies the expansion-seed upsert won't fix (it doesn't set
 * ats_type/ats_identifier on conflict). All tokens confirmed live.
 *
 * Highest-value fix: carvana.com was NULL -> greenhouse/carvana (~2,219 jobs).
 * fanatics.com had ats_type=greenhouse but a NULL identifier -> fanaticsinc.
 *
 *   npx tsx scripts/enrich-retail-ats.ts            # dry-run (preview)
 *   npx tsx scripts/enrich-retail-ats.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Ats = "greenhouse" | "lever" | "ashby"
type Row = { domain: string; ats: Ats; id: string; careers: string }
const ROWS: ReadonlyArray<Row> = [
  // existing rows needing an ATS fix
  { domain: "carvana.com", ats: "greenhouse", id: "carvana", careers: "https://boards.greenhouse.io/carvana" },
  { domain: "fanatics.com", ats: "greenhouse", id: "fanaticsinc", careers: "https://boards.greenhouse.io/fanaticsinc" },
  { domain: "stockx.com", ats: "greenhouse", id: "stockx", careers: "https://boards.greenhouse.io/stockx" },
  { domain: "ruggable.com", ats: "greenhouse", id: "ruggable", careers: "https://boards.greenhouse.io/ruggable" },
  { domain: "gorgias.com", ats: "ashby", id: "gorgias", careers: "https://jobs.ashbyhq.com/gorgias" },
  // Cat 60 inserts (backstop — seed sets ATS on insert, this is idempotent)
  { domain: "yotpo.com", ats: "greenhouse", id: "yotpo", careers: "https://boards.greenhouse.io/yotpo" },
  { domain: "drinkolipop.com", ats: "greenhouse", id: "olipop", careers: "https://boards.greenhouse.io/olipop" },
  { domain: "liquiddeath.com", ats: "greenhouse", id: "liquiddeath", careers: "https://boards.greenhouse.io/liquiddeath" },
  { domain: "constructor.io", ats: "ashby", id: "constructor", careers: "https://jobs.ashbyhq.com/constructor" },
  { domain: "rechargepayments.com", ats: "ashby", id: "recharge", careers: "https://jobs.ashbyhq.com/recharge" },
  { domain: "awaytravel.com", ats: "ashby", id: "away", careers: "https://jobs.ashbyhq.com/away" },
  { domain: "bolt.com", ats: "ashby", id: "bolt", careers: "https://jobs.ashbyhq.com/bolt" },
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
    if (cur.ats_type && cur.ats_type !== r.ats && cur.ats_type !== "custom") {
      console.log(`SKIP  ${r.domain.padEnd(22)} already ats_type=${cur.ats_type}`)
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
    console.log(`${execute ? "SET " : "WOULD"}  ${cur.name.padEnd(16)} -> ${r.ats}/${r.id}`)
  }
  console.log(`\n${execute ? "Updated" : "Would update"} ${changed}/${ROWS.length}  (skipped ${skipped}, missing ${missing})${execute ? "" : "  — re-run with --execute"}`)
  await pool.end()
}
main()

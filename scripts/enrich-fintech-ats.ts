/**
 * One-off enrichment for the FinTech / Banking gap-scan. Pins verified ATS
 * tokens onto companies the expansion-seed upsert won't fix. All verified.
 * Argyle uses Rippling (not expressible in the expansion type) so pinned here.
 *
 *   npx tsx scripts/enrich-fintech-ats.ts            # dry-run
 *   npx tsx scripts/enrich-fintech-ats.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Ats = "greenhouse" | "lever" | "ashby" | "rippling"
type Row = { domain: string; ats: Ats; id: string; careers: string }
const ROWS: ReadonlyArray<Row> = [
  // existing rows needing a fix
  { domain: "betterment.com", ats: "greenhouse", id: "betterment", careers: "https://boards.greenhouse.io/betterment" },
  { domain: "current.com", ats: "greenhouse", id: "current", careers: "https://boards.greenhouse.io/current" },
  { domain: "argyle.com", ats: "rippling", id: "argyle", careers: "https://ats.rippling.com/argyle/jobs" },
  // Cat 67 inserts (backstop — idempotent)
  { domain: "alpaca.markets", ats: "greenhouse", id: "alpaca", careers: "https://boards.greenhouse.io/alpaca" },
  { domain: "pinwheel.com", ats: "greenhouse", id: "pinwheelapi", careers: "https://boards.greenhouse.io/pinwheelapi" },
  { domain: "unit.co", ats: "ashby", id: "unit", careers: "https://jobs.ashbyhq.com/unit" },
  { domain: "methodfi.com", ats: "ashby", id: "method", careers: "https://jobs.ashbyhq.com/method" },
  { domain: "sardine.ai", ats: "ashby", id: "sardine", careers: "https://jobs.ashbyhq.com/sardine" },
  { domain: "trmlabs.com", ats: "ashby", id: "trm-labs", careers: "https://jobs.ashbyhq.com/trm-labs" },
  { domain: "anchorage.com", ats: "lever", id: "anchorage", careers: "https://jobs.lever.co/anchorage" },
  { domain: "dwolla.com", ats: "lever", id: "dwolla", careers: "https://jobs.lever.co/dwolla" },
  { domain: "withpersona.com", ats: "lever", id: "withpersona", careers: "https://jobs.lever.co/withpersona" },
  { domain: "varomoney.com", ats: "lever", id: "varomoney", careers: "https://jobs.lever.co/varomoney" },
  { domain: "increase.com", ats: "lever", id: "increase", careers: "https://jobs.lever.co/increase" },
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  let changed = 0, skipped = 0, missing = 0
  for (const r of ROWS) {
    const { rows } = await pool.query<{ name: string; ats_type: string | null; is_active: boolean }>(
      "SELECT name, ats_type, is_active FROM companies WHERE domain = $1",
      [r.domain]
    )
    if (rows.length === 0) { console.log(`MISS  ${r.domain} — not in DB`); missing++; continue }
    const cur = rows[0]
    if (cur.ats_type && cur.ats_type !== r.ats && cur.ats_type !== "custom") {
      console.log(`SKIP  ${r.domain.padEnd(18)} already ats_type=${cur.ats_type}`)
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
    const react = !cur.is_active ? "  (reactivated)" : ""
    console.log(`${execute ? "SET " : "WOULD"}  ${cur.name.padEnd(18)} -> ${r.ats}/${r.id}${react}`)
  }
  console.log(`\n${execute ? "Updated" : "Would update"} ${changed}/${ROWS.length}  (skipped ${skipped}, missing ${missing})${execute ? "" : "  — re-run with --execute"}`)
  await pool.end()
}
main()

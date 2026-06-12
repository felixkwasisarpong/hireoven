/**
 * One-off enrichment for the Insurance / Insurtech cohort. Pins verified ATS
 * tokens onto companies the expansion-seed upsert won't fix (it doesn't set
 * ats_type/ats_identifier on conflict). All tokens confirmed live.
 *
 * Notable cases:
 *   - lemonade.com: ats_type=custom -> upgraded to ashby/lemonade (~46 jobs).
 *   - bestow.com / cloverhealth.com: were is_active=false -> reactivated with
 *     their real ATS (Ashby / Greenhouse). is_active=true is set on every row.
 *   - root: Rippling (ats_identifier=joinroot) — the SeedExtra type doesn't
 *     allow "rippling", so it can't live in the expansion seed; pinned here.
 *
 *   npx tsx scripts/enrich-insurance-ats.ts            # dry-run (preview)
 *   npx tsx scripts/enrich-insurance-ats.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Ats = "greenhouse" | "lever" | "ashby" | "rippling"
type Row = { domain: string; ats: Ats; id: string; careers: string; force?: true }
const ROWS: ReadonlyArray<Row> = [
  // existing rows needing an ATS fix / reactivation
  { domain: "hioscar.com", ats: "greenhouse", id: "oscar", careers: "https://boards.greenhouse.io/oscar" },
  { domain: "cloverhealth.com", ats: "greenhouse", id: "cloverhealth", careers: "https://boards.greenhouse.io/cloverhealth" },
  { domain: "pieinsurance.com", ats: "greenhouse", id: "pieinsurance", careers: "https://boards.greenhouse.io/pieinsurance" },
  { domain: "bestow.com", ats: "ashby", id: "bestow", careers: "https://jobs.ashbyhq.com/bestow" },
  { domain: "lemonade.com", ats: "ashby", id: "lemonade", careers: "https://jobs.ashbyhq.com/lemonade", force: true }, // custom -> ashby
  { domain: "joinroot.com", ats: "rippling", id: "joinroot", careers: "https://ats.rippling.com/joinroot/jobs" },
  // Cat 59 inserts (backstop — seed sets ATS on insert, this is idempotent)
  { domain: "coalitioninc.com", ats: "greenhouse", id: "coalition", careers: "https://boards.greenhouse.io/coalition" },
  { domain: "hippo.com", ats: "greenhouse", id: "hippo70", careers: "https://boards.greenhouse.io/hippo70" },
  { domain: "yourcounterpart.com", ats: "greenhouse", id: "counterpart", careers: "https://boards.greenhouse.io/counterpart" },
  { domain: "ladderlife.com", ats: "greenhouse", id: "ladder33", careers: "https://boards.greenhouse.io/ladder33" },
  { domain: "at-bay.com", ats: "greenhouse", id: "atbay", careers: "https://boards.greenhouse.io/atbay" },
  { domain: "ethoslife.com", ats: "greenhouse", id: "ethoslife", careers: "https://boards.greenhouse.io/ethoslife" },
  { domain: "gravie.com", ats: "lever", id: "gravie", careers: "https://jobs.lever.co/gravie" },
  { domain: "sanabenefits.com", ats: "lever", id: "sanabenefits", careers: "https://jobs.lever.co/sanabenefits" },
  { domain: "sureapp.com", ats: "lever", id: "sure", careers: "https://jobs.lever.co/sure" },
  { domain: "kin.com", ats: "ashby", id: "kin", careers: "https://jobs.ashbyhq.com/kin" },
  { domain: "trellisconnect.com", ats: "ashby", id: "savvyinsurance-trellis", careers: "https://jobs.ashbyhq.com/savvyinsurance-trellis" },
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
    const blocked = cur.ats_type && cur.ats_type !== r.ats && cur.ats_type !== "custom"
    if (blocked && !r.force) {
      console.log(`SKIP  ${r.domain.padEnd(20)} already ats_type=${cur.ats_type}`)
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
    const flags = [blocked && r.force ? `FORCED over ${cur.ats_type}` : "", !cur.is_active ? "reactivated" : ""].filter(Boolean).join(", ")
    console.log(`${execute ? "SET " : "WOULD"}  ${cur.name.padEnd(16)} -> ${r.ats}/${r.id}${flags ? `  (${flags})` : ""}`)
  }
  console.log(`\n${execute ? "Updated" : "Would update"} ${changed}/${ROWS.length}  (skipped ${skipped}, missing ${missing})${execute ? "" : "  — re-run with --execute"}`)
  await pool.end()
}
main()

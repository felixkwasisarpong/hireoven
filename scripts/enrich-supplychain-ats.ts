/**
 * One-off enrichment for the Supply Chain / Logistics cohort. Pins verified
 * ATS tokens onto companies the expansion-seed upsert won't fix (it doesn't
 * set ats_type/ats_identifier on conflict). All tokens confirmed live.
 *
 * Notable:
 *   - Tive & Shipium use Rippling (not expressible in the expansion SeedExtra
 *     type) so they're pinned here. Shipium is inserted plain by the seed.
 *   - locusrobotics.com & picklerobot.com were is_active=false -> reactivated.
 *
 *   npx tsx scripts/enrich-supplychain-ats.ts            # dry-run (preview)
 *   npx tsx scripts/enrich-supplychain-ats.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Ats = "greenhouse" | "lever" | "ashby" | "rippling"
type Row = { domain: string; ats: Ats; id: string; careers: string }
const ROWS: ReadonlyArray<Row> = [
  // existing rows needing an ATS fix / reactivation
  { domain: "altana.ai", ats: "greenhouse", id: "altanaai", careers: "https://boards.greenhouse.io/altanaai" },
  { domain: "dexterity.ai", ats: "lever", id: "dexterity", careers: "https://jobs.lever.co/dexterity" },
  { domain: "fourkites.com", ats: "greenhouse", id: "fourkites", careers: "https://boards.greenhouse.io/fourkites" },
  { domain: "locusrobotics.com", ats: "greenhouse", id: "locusrobotics", careers: "https://boards.greenhouse.io/locusrobotics" },
  { domain: "picklerobot.com", ats: "lever", id: "picklerobot", careers: "https://jobs.lever.co/picklerobot" },
  { domain: "tive.com", ats: "rippling", id: "tive-careers", careers: "https://ats.rippling.com/tive-careers/jobs" },
  { domain: "shipium.com", ats: "rippling", id: "shipium", careers: "https://ats.rippling.com/shipium/jobs" },
  // Cat 61 greenhouse inserts (backstop — seed sets ATS on insert, idempotent)
  { domain: "project44.com", ats: "greenhouse", id: "project44", careers: "https://boards.greenhouse.io/project44" },
  { domain: "aftership.com", ats: "greenhouse", id: "aftership", careers: "https://boards.greenhouse.io/aftership" },
  { domain: "gather.ai", ats: "greenhouse", id: "gatherai", careers: "https://boards.greenhouse.io/gatherai" },
  { domain: "flexe.com", ats: "greenhouse", id: "flexe", careers: "https://boards.greenhouse.io/flexe" },
  { domain: "outrider.ai", ats: "greenhouse", id: "outrider", careers: "https://boards.greenhouse.io/outrider" },
  { domain: "uberfreight.com", ats: "greenhouse", id: "uberfreight", careers: "https://job-boards.greenhouse.io/uberfreight" },
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
    const react = !cur.is_active ? "  (reactivated)" : ""
    console.log(`${execute ? "SET " : "WOULD"}  ${cur.name.padEnd(18)} -> ${r.ats}/${r.id}${react}`)
  }
  console.log(`\n${execute ? "Updated" : "Would update"} ${changed}/${ROWS.length}  (skipped ${skipped}, missing ${missing})${execute ? "" : "  — re-run with --execute"}`)
  await pool.end()
}
main()

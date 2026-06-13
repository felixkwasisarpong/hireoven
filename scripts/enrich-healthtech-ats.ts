/**
 * One-off enrichment for the Healthcare / Health Tech cohort. Pins verified
 * ATS tokens onto companies the expansion-seed upsert won't fix. All verified.
 * Qventus was is_active=false -> reactivated.
 *
 *   npx tsx scripts/enrich-healthtech-ats.ts            # dry-run
 *   npx tsx scripts/enrich-healthtech-ats.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Ats = "greenhouse" | "lever" | "ashby"
type Row = { domain: string; ats: Ats; id: string; careers: string }
const ROWS: ReadonlyArray<Row> = [
  // existing rows needing a fix
  { domain: "qventus.com", ats: "greenhouse", id: "qventus", careers: "https://boards.greenhouse.io/qventus" },
  { domain: "pathai.com", ats: "greenhouse", id: "pathai", careers: "https://boards.greenhouse.io/pathai" },
  { domain: "particlehealth.com", ats: "greenhouse", id: "particlehealth", careers: "https://boards.greenhouse.io/particlehealth" },
  // Cat 64 inserts (backstop — idempotent)
  { domain: "komodohealth.com", ats: "greenhouse", id: "komodohealth", careers: "https://job-boards.greenhouse.io/komodohealth" },
  { domain: "usenourish.com", ats: "greenhouse", id: "usenourish", careers: "https://boards.greenhouse.io/usenourish" },
  { domain: "uniteus.com", ats: "greenhouse", id: "uniteus", careers: "https://job-boards.greenhouse.io/uniteus" },
  { domain: "suki.ai", ats: "greenhouse", id: "suki", careers: "https://boards.greenhouse.io/suki" },
  { domain: "ro.co", ats: "lever", id: "ro", careers: "https://jobs.lever.co/ro" },
  { domain: "redoxengine.com", ats: "lever", id: "redoxengine", careers: "https://jobs.lever.co/redoxengine" },
  { domain: "carbonhealth.com", ats: "lever", id: "carbonhealth", careers: "https://jobs.lever.co/carbonhealth" },
  { domain: "color.com", ats: "lever", id: "color", careers: "https://jobs.lever.co/color" },
  { domain: "notablehealth.com", ats: "ashby", id: "notable", careers: "https://jobs.ashbyhq.com/notable" },
  { domain: "radai.com", ats: "ashby", id: "radai", careers: "https://jobs.ashbyhq.com/radai" },
  { domain: "openevidence.com", ats: "ashby", id: "openevidence", careers: "https://jobs.ashbyhq.com/openevidence" },
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

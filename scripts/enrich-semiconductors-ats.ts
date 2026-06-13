/**
 * One-off enrichment for the Semiconductors / Hardware / Robotics cohort.
 * Pins verified ATS tokens onto companies the expansion-seed upsert won't fix.
 * Formlabs was is_active=false -> reactivated. All tokens verified live.
 *
 *   npx tsx scripts/enrich-semiconductors-ats.ts            # dry-run
 *   npx tsx scripts/enrich-semiconductors-ats.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Ats = "greenhouse" | "lever" | "ashby" | "rippling"
type Row = { domain: string; ats: Ats; id: string; careers: string }
const ROWS: ReadonlyArray<Row> = [
  // existing rows needing a fix
  { domain: "cerebras.net", ats: "ashby", id: "cerebras", careers: "https://jobs.ashbyhq.com/cerebras" },
  { domain: "etched.com", ats: "ashby", id: "etched", careers: "https://jobs.ashbyhq.com/etched" },
  { domain: "physicalintelligence.company", ats: "ashby", id: "physicalintelligence", careers: "https://jobs.ashbyhq.com/physicalintelligence" },
  { domain: "rain.ai", ats: "ashby", id: "rain-ai-jobs", careers: "https://jobs.ashbyhq.com/rain-ai-jobs" },
  { domain: "1x.tech", ats: "ashby", id: "1x", careers: "https://jobs.ashbyhq.com/1x" },
  { domain: "formlabs.com", ats: "greenhouse", id: "formlabs", careers: "https://boards.greenhouse.io/formlabs" },
  { domain: "diligentrobots.com", ats: "greenhouse", id: "diligentrobotics", careers: "https://boards.greenhouse.io/diligentrobotics" },
  // Cat 65 inserts (backstop — idempotent)
  { domain: "sambanova.ai", ats: "greenhouse", id: "sambanovasystems", careers: "https://boards.greenhouse.io/sambanovasystems" },
  { domain: "lightmatter.co", ats: "greenhouse", id: "lightmatter", careers: "https://boards.greenhouse.io/lightmatter" },
  { domain: "bayasystems.com", ats: "greenhouse", id: "bayasystems", careers: "https://boards.greenhouse.io/bayasystems" },
  { domain: "enchargeai.com", ats: "greenhouse", id: "enchargeai", careers: "https://boards.greenhouse.io/enchargeai" },
  { domain: "markforged.com", ats: "greenhouse", id: "markforged", careers: "https://boards.greenhouse.io/markforged" },
  { domain: "divergent3d.com", ats: "greenhouse", id: "divergent", careers: "https://boards.greenhouse.io/divergent" },
  { domain: "path-robotics.com", ats: "greenhouse", id: "pathrobotics", careers: "https://boards.greenhouse.io/pathrobotics" },
  { domain: "collaborativerobotics.com", ats: "ashby", id: "cobot", careers: "https://jobs.ashbyhq.com/cobot" },
  { domain: "sanctuary.ai", ats: "lever", id: "sanctuary", careers: "https://jobs.lever.co/sanctuary" },
  { domain: "positron.ai", ats: "rippling", id: "positron", careers: "https://ats.rippling.com/positron/jobs" },
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
      console.log(`SKIP  ${r.domain.padEnd(28)} already ats_type=${cur.ats_type}`)
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
    console.log(`${execute ? "SET " : "WOULD"}  ${cur.name.padEnd(20)} -> ${r.ats}/${r.id}${react}`)
  }
  console.log(`\n${execute ? "Updated" : "Would update"} ${changed}/${ROWS.length}  (skipped ${skipped}, missing ${missing})${execute ? "" : "  — re-run with --execute"}`)
  await pool.end()
}
main()

/**
 * One-off enrichment for the AI / ML / Data gap-scan. Pins verified ATS tokens
 * onto companies the expansion-seed upsert won't fix. All tokens verified live.
 *
 * Headline custom-crawl upgrades: Harvey 262 (custom->ashby), Glean 174
 * (custom->greenhouse), Synthesia 78 (custom->ashby). ElevenLabs (154) was
 * is_active=false -> reactivated. Runway token corrected (runway -> runway-ml).
 *
 *   npx tsx scripts/enrich-ai-ats.ts            # dry-run
 *   npx tsx scripts/enrich-ai-ats.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Ats = "greenhouse" | "lever" | "ashby"
type Row = { domain: string; ats: Ats; id: string; careers: string }
const ROWS: ReadonlyArray<Row> = [
  // existing rows needing a fix / custom-upgrade / reactivation
  { domain: "harvey.ai", ats: "ashby", id: "harvey", careers: "https://jobs.ashbyhq.com/harvey" },
  { domain: "glean.com", ats: "greenhouse", id: "gleanwork", careers: "https://boards.greenhouse.io/gleanwork" },
  { domain: "synthesia.io", ats: "ashby", id: "synthesia", careers: "https://jobs.ashbyhq.com/synthesia" },
  { domain: "elevenlabs.io", ats: "ashby", id: "elevenlabs", careers: "https://jobs.ashbyhq.com/elevenlabs" },
  { domain: "runwayml.com", ats: "ashby", id: "runway-ml", careers: "https://jobs.ashbyhq.com/runway-ml" },
  { domain: "arize.com", ats: "greenhouse", id: "arizeai", careers: "https://boards.greenhouse.io/arizeai" },
  { domain: "comet.com", ats: "greenhouse", id: "comet", careers: "https://boards.greenhouse.io/comet" },
  { domain: "labelbox.com", ats: "greenhouse", id: "labelbox", careers: "https://boards.greenhouse.io/labelbox" },
  { domain: "voxel51.com", ats: "greenhouse", id: "voxel51", careers: "https://boards.greenhouse.io/voxel51" },
  { domain: "trychroma.com", ats: "ashby", id: "trychroma", careers: "https://jobs.ashbyhq.com/trychroma" },
  { domain: "weaviate.io", ats: "ashby", id: "weaviate", careers: "https://jobs.ashbyhq.com/weaviate" },
  // Cat 66 inserts (backstop — idempotent)
  { domain: "assemblyai.com", ats: "greenhouse", id: "assemblyai", careers: "https://job-boards.greenhouse.io/assemblyai" },
  { domain: "contextual.ai", ats: "greenhouse", id: "contextualai", careers: "https://boards.greenhouse.io/contextualai" },
  { domain: "dagster.io", ats: "greenhouse", id: "dagsterlabs", careers: "https://boards.greenhouse.io/dagsterlabs" },
  { domain: "astronomer.io", ats: "ashby", id: "astronomer", careers: "https://jobs.ashbyhq.com/astronomer" },
  { domain: "evenuplaw.com", ats: "ashby", id: "evenup", careers: "https://jobs.ashbyhq.com/evenup" },
  { domain: "roboflow.com", ats: "ashby", id: "roboflow", careers: "https://jobs.ashbyhq.com/roboflow" },
  { domain: "tecton.ai", ats: "lever", id: "tecton", careers: "https://jobs.lever.co/tecton" },
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
    const flags = [cur.ats_type === "custom" ? "custom-upgrade" : "", !cur.is_active ? "reactivated" : ""].filter(Boolean).join(", ")
    console.log(`${execute ? "SET " : "WOULD"}  ${cur.name.padEnd(16)} -> ${r.ats}/${r.id}${flags ? `  (${flags})` : ""}`)
  }
  console.log(`\n${execute ? "Updated" : "Would update"} ${changed}/${ROWS.length}  (skipped ${skipped}, missing ${missing})${execute ? "" : "  — re-run with --execute"}`)
  await pool.end()
}
main()

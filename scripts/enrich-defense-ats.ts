/**
 * One-off enrichment for the Government Contractors / Defense-adjacent cohort.
 * Pins verified ATS tokens onto companies the expansion-seed upsert won't fix
 * (it doesn't set ats_type/ats_identifier on conflict). All tokens verified.
 *
 * Headline: Anduril MIGRATED lever -> greenhouse/andurilindustries (~2,086
 * jobs; the lever board is dead). One row uses `force` to override a real ATS.
 * Chaos (155) / Impulse / Ursa Major reactivated; Rebellion custom-upgrade.
 *
 *   npx tsx scripts/enrich-defense-ats.ts            # dry-run
 *   npx tsx scripts/enrich-defense-ats.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Ats = "greenhouse" | "lever" | "ashby" | "rippling"
type Row = { domain: string; ats: Ats; id: string; careers: string; force?: true }
const ROWS: ReadonlyArray<Row> = [
  { domain: "anduril.com", ats: "greenhouse", id: "andurilindustries", careers: "https://boards.greenhouse.io/andurilindustries", force: true }, // lever -> greenhouse migration
  { domain: "chaosindustries.com", ats: "greenhouse", id: "chaosindustries", careers: "https://boards.greenhouse.io/chaosindustries" },
  { domain: "rebelliondefense.com", ats: "greenhouse", id: "rebelliondefense", careers: "https://boards.greenhouse.io/rebelliondefense" },
  { domain: "ursamajor.com", ats: "greenhouse", id: "ursamajor", careers: "https://boards.greenhouse.io/ursamajor" },
  { domain: "saronic.com", ats: "ashby", id: "saronic", careers: "https://jobs.ashbyhq.com/saronic" },
  { domain: "skydio.com", ats: "ashby", id: "skydio", careers: "https://jobs.ashbyhq.com/skydio" },
  { domain: "impulsespace.com", ats: "ashby", id: "impulse", careers: "https://jobs.ashbyhq.com/impulse" },
  { domain: "picogrid.com", ats: "ashby", id: "picogrid", careers: "https://jobs.ashbyhq.com/picogrid" },
  // Cat 63 inserts (backstop — idempotent)
  { domain: "capellaspace.com", ats: "greenhouse", id: "capellaspace", careers: "https://boards.greenhouse.io/capellaspace" },
  { domain: "epirusinc.com", ats: "greenhouse", id: "epirus", careers: "https://boards.greenhouse.io/epirus" },
  { domain: "muonspace.com", ats: "greenhouse", id: "muonspace", careers: "https://boards.greenhouse.io/muonspace" },
  { domain: "neros.tech", ats: "greenhouse", id: "nerostechnologies", careers: "https://boards.greenhouse.io/nerostechnologies" },
  { domain: "varda.com", ats: "greenhouse", id: "vardaspace", careers: "https://boards.greenhouse.io/vardaspace" },
  { domain: "vastspace.com", ats: "greenhouse", id: "vast", careers: "https://boards.greenhouse.io/vast" },
  { domain: "machindustries.com", ats: "ashby", id: "mach", careers: "https://jobs.ashbyhq.com/mach" },
  { domain: "secondfront.com", ats: "ashby", id: "Second-Front-Systems", careers: "https://jobs.ashbyhq.com/Second-Front-Systems" },
  { domain: "forterra.ai", ats: "lever", id: "forterra", careers: "https://jobs.lever.co/forterra" },
  { domain: "overland.ai", ats: "rippling", id: "overland-ai", careers: "https://ats.rippling.com/overland-ai/jobs" },
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
    const flags = [blocked && r.force ? `FORCED over ${cur.ats_type}` : "", cur.ats_type === "custom" ? "custom-upgrade" : "", !cur.is_active ? "reactivated" : ""].filter(Boolean).join(", ")
    console.log(`${execute ? "SET " : "WOULD"}  ${cur.name.padEnd(18)} -> ${r.ats}/${r.id}${flags ? `  (${flags})` : ""}`)
  }
  console.log(`\n${execute ? "Updated" : "Would update"} ${changed}/${ROWS.length}  (skipped ${skipped}, missing ${missing})${execute ? "" : "  — re-run with --execute"}`)
  await pool.end()
}
main()

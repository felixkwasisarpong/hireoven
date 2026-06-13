/**
 * One-off enrichment for the Cybersecurity cohort. Pins verified ATS tokens
 * onto companies the expansion-seed upsert won't fix (it doesn't set
 * ats_type/ats_identifier on conflict). All tokens confirmed live.
 *
 * Notable: Netskope (114), KnowBe4 (97), Tanium (64), Abnormal (77) were
 * ats_type=custom (generic crawl) -> upgraded to their real Greenhouse boards.
 * Cato Networks (123) & Dragos were is_active=false -> reactivated.
 *
 *   npx tsx scripts/enrich-cybersecurity-ats.ts            # dry-run
 *   npx tsx scripts/enrich-cybersecurity-ats.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Ats = "greenhouse" | "lever" | "ashby"
type Row = { domain: string; ats: Ats; id: string; careers: string }
const ROWS: ReadonlyArray<Row> = [
  // existing rows needing an ATS fix / reactivation / custom-upgrade
  { domain: "abnormalsecurity.com", ats: "greenhouse", id: "abnormalsecurity", careers: "https://boards.greenhouse.io/abnormalsecurity" },
  { domain: "netskope.com", ats: "greenhouse", id: "netskope", careers: "https://boards.greenhouse.io/netskope" },
  { domain: "knowbe4.com", ats: "greenhouse", id: "knowbe4", careers: "https://boards.greenhouse.io/knowbe4" },
  { domain: "tanium.com", ats: "greenhouse", id: "tanium", careers: "https://boards.greenhouse.io/tanium" },
  { domain: "catonetworks.com", ats: "greenhouse", id: "catonetworks", careers: "https://boards.greenhouse.io/catonetworks" },
  { domain: "dragos.com", ats: "greenhouse", id: "dragos", careers: "https://boards.greenhouse.io/dragos" },
  { domain: "recordedfuture.com", ats: "greenhouse", id: "recordedfuture", careers: "https://boards.greenhouse.io/recordedfuture" },
  { domain: "axonius.com", ats: "greenhouse", id: "axonius", careers: "https://boards.greenhouse.io/axonius" },
  { domain: "veracode.com", ats: "greenhouse", id: "veracode", careers: "https://boards.greenhouse.io/veracode" },
  { domain: "hackerone.com", ats: "ashby", id: "hackerone", careers: "https://jobs.ashbyhq.com/hackerone" },
  { domain: "snyk.io", ats: "ashby", id: "snyk", careers: "https://jobs.ashbyhq.com/snyk" },
  { domain: "wiz.io", ats: "ashby", id: "wiz", careers: "https://jobs.ashbyhq.com/wiz" },
  // Cat 62 inserts (backstop — seed sets ATS on insert, idempotent)
  { domain: "armis.com", ats: "greenhouse", id: "armissecurity", careers: "https://boards.greenhouse.io/armissecurity" },
  { domain: "chainguard.dev", ats: "greenhouse", id: "chainguard", careers: "https://boards.greenhouse.io/chainguard" },
  { domain: "cybereason.com", ats: "greenhouse", id: "cybereason", careers: "https://boards.greenhouse.io/cybereason" },
  { domain: "censys.io", ats: "greenhouse", id: "censys", careers: "https://boards.greenhouse.io/censys" },
  { domain: "salt.security", ats: "greenhouse", id: "saltsecurity", careers: "https://boards.greenhouse.io/saltsecurity" },
  { domain: "tailscale.com", ats: "greenhouse", id: "tailscale", careers: "https://boards.greenhouse.io/tailscale" },
  { domain: "yubico.com", ats: "greenhouse", id: "yubico", careers: "https://boards.greenhouse.io/yubico" },
  { domain: "endorlabs.com", ats: "greenhouse", id: "endorlabs", careers: "https://boards.greenhouse.io/endorlabs" },
  { domain: "horizon3.ai", ats: "ashby", id: "horizon3ai", careers: "https://jobs.ashbyhq.com/horizon3ai" },
  { domain: "socket.dev", ats: "ashby", id: "socket", careers: "https://jobs.ashbyhq.com/socket" },
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
    const flags = [cur.ats_type === "custom" ? "custom-upgrade" : "", !cur.is_active ? "reactivated" : ""].filter(Boolean).join(", ")
    console.log(`${execute ? "SET " : "WOULD"}  ${cur.name.padEnd(18)} -> ${r.ats}/${r.id}${flags ? `  (${flags})` : ""}`)
  }
  console.log(`\n${execute ? "Updated" : "Would update"} ${changed}/${ROWS.length}  (skipped ${skipped}, missing ${missing})${execute ? "" : "  — re-run with --execute"}`)
  await pool.end()
}
main()

/**
 * One-off enrichment: pin verified ATS tokens onto the Marketing / Product
 * Analytics companies. Needed because the expansion-seed upsert's ON CONFLICT
 * clause deliberately doesn't touch ats_type/ats_identifier — so any of these
 * that already existed in the DB (from prior discovery/F2000 seeds) can't be
 * fixed by re-seeding. This targeted UPDATE pins them directly.
 *
 * All tokens confirmed live against the public ATS APIs. Conservative: fills
 * rows where ats_type is NULL and upgrades the generic "custom" crawl fallback,
 * but never clobbers a real third-party ATS already detected.
 *
 *   npx tsx scripts/enrich-analytics-ats.ts            # dry-run (preview)
 *   npx tsx scripts/enrich-analytics-ats.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Ats = "greenhouse" | "lever" | "ashby"
const ROWS: ReadonlyArray<[domain: string, ats: Ats, identifier: string, careersUrl: string]> = [
  // already seeded in base/expansion without ats_type
  ["amplitude.com", "greenhouse", "amplitude", "https://boards.greenhouse.io/amplitude"],
  ["mixpanel.com", "greenhouse", "mixpanel", "https://job-boards.greenhouse.io/mixpanel"],
  ["braze.com", "greenhouse", "braze", "https://boards.greenhouse.io/braze"],
  ["launchdarkly.com", "greenhouse", "launchdarkly", "https://boards.greenhouse.io/launchdarkly"],
  ["klaviyo.com", "greenhouse", "klaviyo", "https://boards.greenhouse.io/klaviyo"],
  // Cat 57 additions (some pre-existed in DB → upsert won't have set ATS)
  ["appsflyer.com", "greenhouse", "appsflyer", "https://boards.greenhouse.io/appsflyer"],
  ["pendo.io", "greenhouse", "pendo", "https://boards.greenhouse.io/pendo"],
  ["hightouch.com", "greenhouse", "hightouch", "https://job-boards.greenhouse.io/hightouch"],
  ["iterable.com", "greenhouse", "iterable", "https://job-boards.greenhouse.io/iterable"],
  ["northbeam.io", "greenhouse", "northbeam", "https://job-boards.greenhouse.io/northbeam"],
  ["similarweb.com", "greenhouse", "similarweb", "https://boards.greenhouse.io/similarweb"],
  ["triplewhale.com", "greenhouse", "triplewhale", "https://job-boards.greenhouse.io/triplewhale"],
  ["customer.io", "greenhouse", "customerio", "https://boards.greenhouse.io/customerio"],
  ["hex.tech", "greenhouse", "hextechnologies", "https://boards.greenhouse.io/hextechnologies"],
  ["sisense.com", "greenhouse", "sisense", "https://boards.greenhouse.io/sisense"],
  ["sproutsocial.com", "greenhouse", "sproutsocial", "https://boards.greenhouse.io/sproutsocial"],
  ["contentsquare.com", "lever", "contentsquare", "https://jobs.lever.co/contentsquare"],
  ["logrocket.com", "lever", "logrocket", "https://jobs.lever.co/logrocket"],
  ["quantummetric.com", "lever", "quantummetric", "https://jobs.lever.co/quantummetric"],
  ["kochava.com", "lever", "kochava", "https://jobs.lever.co/kochava"],
  ["snowplow.io", "lever", "snowplow", "https://jobs.lever.co/snowplow"],
  ["posthog.com", "ashby", "posthog", "https://jobs.ashbyhq.com/posthog"],
  ["fullstory.com", "ashby", "fullstory", "https://jobs.ashbyhq.com/fullstory"],
  ["statsig.com", "ashby", "statsig", "https://jobs.ashbyhq.com/statsig"],
  ["geteppo.com", "ashby", "eppo", "https://jobs.ashbyhq.com/eppo"],
  ["singular.net", "ashby", "singular", "https://jobs.ashbyhq.com/singular"],
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  let changed = 0, skipped = 0, missing = 0
  for (const [domain, ats, identifier, careersUrl] of ROWS) {
    const { rows } = await pool.query<{ name: string; ats_type: string | null }>(
      "SELECT name, ats_type FROM companies WHERE domain = $1",
      [domain]
    )
    if (rows.length === 0) {
      console.log(`MISS  ${domain} — not in DB`)
      missing++
      continue
    }
    const cur = rows[0]
    // Fill NULLs, upgrade the generic "custom" crawl fallback or a matching ATS;
    // never clobber a different real third-party ATS already detected.
    if (cur.ats_type && cur.ats_type !== ats && cur.ats_type !== "custom") {
      console.log(`SKIP  ${domain.padEnd(20)} already ats_type=${cur.ats_type}`)
      skipped++
      continue
    }
    if (execute) {
      await pool.query(
        `UPDATE companies
            SET ats_type = $2, ats_identifier = $3, careers_url = $4, is_active = true
          WHERE domain = $1`,
        [domain, ats, identifier, careersUrl]
      )
    }
    changed++
    console.log(`${execute ? "SET " : "WOULD"}  ${cur.name.padEnd(18)} -> ${ats}/${identifier}`)
  }
  console.log(
    `\n${execute ? "Updated" : "Would update"} ${changed}/${ROWS.length}  (skipped ${skipped}, missing ${missing})` +
      (execute ? "" : "  — re-run with --execute")
  )
  await pool.end()
}
main()

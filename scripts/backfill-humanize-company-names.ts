/**
 * One-shot: walk every ALL-CAPS multi-word company and apply
 * humanizeCompanyName() so the display reads "Visa" instead of
 * "VISA TECHNOLOGY AND OPERATIONS LLC".
 *
 *   npx tsx scripts/backfill-humanize-company-names.ts             # dry-run
 *   npx tsx scripts/backfill-humanize-company-names.ts --execute
 */
import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "../lib/postgres/server"
import {
  guessPublicDomain,
  humanizeCompanyName,
} from "../lib/companies/placeholder-from-employer"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")

async function main() {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ id: string; name: string; domain: string | null }>(
    `SELECT id, name, domain
       FROM companies
      WHERE name = UPPER(name)
        AND name ~ '\\s'
        AND length(name) > 8
        AND is_active = true
      ORDER BY name`
  )

  let changed = 0
  let unchanged = 0
  for (const row of rows) {
    const cleaned = humanizeCompanyName(row.name, row.domain ?? guessPublicDomain(row.name))
    if (cleaned === row.name) {
      unchanged += 1
      continue
    }
    console.log(`  ${row.name.padEnd(60)} → ${cleaned}`)
    if (execute) {
      await pool.query(
        `UPDATE companies SET name = $1, updated_at = now() WHERE id = $2`,
        [cleaned.slice(0, 140), row.id]
      )
    }
    changed += 1
  }

  console.log(
    `\n${execute ? "Updated" : "Would update"}: ${changed} • unchanged: ${unchanged} • mode: ${execute ? "execute" : "dry-run"}`
  )

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

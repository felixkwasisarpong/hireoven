/**
 * One-off data fix for two companies whose logos never rendered because their
 * stored `domain` was an ATS host (so companyLogoUrlFromDomain returned "").
 *
 *   - "UIC" is actually Ultra Intelligence & Communications. Its domain was the
 *     Workday tenant host (ultra.wd3.myworkdayjobs.com). Re-point to the real
 *     brand domain ultra-ic.com + name + logo. Harvest is unaffected — it runs
 *     off ats_type/ats_identifier (ultra:wd3:uiccareers), not the domain.
 *   - LivaNova has a duplicate record on its Workday host
 *     (livanova.wd5.myworkdayjobs.com) with no logo. The domain is unique so we
 *     can't re-point it to livanova.com (the canonical record owns that); give
 *     the duplicate the same brand logo so its jobs render a mark everywhere.
 *
 *   npx tsx scripts/fix-company-logo-data.ts            # dry-run
 *   npx tsx scripts/fix-company-logo-data.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

const execute = process.argv.includes("--execute")

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const ultraLogo = companyLogoUrlFromDomain("ultra-ic.com")
  const livanovaLogo = companyLogoUrlFromDomain("livanova.com")

  const ops: Array<{ label: string; sql: string; params: unknown[] }> = [
    {
      label: "UIC → Ultra Intelligence & Communications (ultra-ic.com + logo)",
      sql: `UPDATE companies
              SET name = 'Ultra Intelligence & Communications',
                  domain = 'ultra-ic.com',
                  logo_url = $1
            WHERE id = 'b7040d45-d536-42e5-ad4f-d35b18078238'
              AND domain = 'ultra.wd3.myworkdayjobs.com'`,
      params: [ultraLogo],
    },
    {
      label: "LivaNova (Workday duplicate) → backfill brand logo",
      sql: `UPDATE companies
              SET logo_url = $1
            WHERE id = 'f94b4b9e-be4c-4b55-9b66-76468cb5ab23'
              AND logo_url IS NULL`,
      params: [livanovaLogo],
    },
  ]

  console.log(`ultra-ic.com  logo: ${ultraLogo || "(empty!)"}`)
  console.log(`livanova.com  logo: ${livanovaLogo || "(empty!)"}\n`)

  for (const op of ops) {
    if (execute) {
      const { rowCount } = await pool.query(op.sql, op.params)
      console.log(`${rowCount ? "SET " : "SKIP"} ${op.label}${rowCount ? "" : " (no match / already set)"}`)
    } else {
      console.log(`WOULD ${op.label}`)
    }
  }

  console.log(`\n${execute ? "Applied" : "Dry run"}${execute ? "" : " — re-run with --execute"}`)
  await pool.end()
}
main()

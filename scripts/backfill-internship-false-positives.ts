/**
 * Find rows mis-classified as employment_type='internship' where the title
 * clearly disagrees (Senior / Staff / Principal / Manager / Director / etc.
 * and no intern keyword anywhere in the title). Re-run inferEmploymentType
 * with the new title-first rule and persist the corrected value.
 *
 *   npx tsx scripts/backfill-internship-false-positives.ts          # dry run
 *   npx tsx scripts/backfill-internship-false-positives.ts --apply  # write
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"
import { inferEmploymentType } from "@/lib/jobs/metadata"

const APPLY = process.argv.includes("--apply")

async function main() {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{
    id: string
    title: string
    description: string | null
    company_name: string | null
  }>(
    `select j.id, j.title, j.description, c.name as company_name
       from jobs j
       left join companies c on c.id = j.company_id
      where j.employment_type = 'internship'
        and j.title !~* '\\m(intern|internship|co[ -]?op)\\M'
        and j.title  ~* '\\m(senior|sr\\.?|staff|principal|lead|manager|director|head|vp|vice president|chief|ceo|cto|cfo|coo|president|founder)\\M'`,
  )

  console.log(`candidates (title says non-intern, employment_type=internship): ${rows.length}`)

  const fixes: { id: string; title: string; newType: string | null; company: string | null }[] = []
  for (const r of rows) {
    const newType = inferEmploymentType(r.title, r.description)
    if (newType !== "internship") {
      fixes.push({ id: r.id, title: r.title, newType, company: r.company_name })
    }
  }

  console.log(`will reclassify: ${fixes.length}`)
  for (const f of fixes.slice(0, 25)) {
    console.log(`  ${f.id}  [${f.company ?? "?"}]  ${f.title}  →  ${f.newType ?? "null"}`)
  }
  if (fixes.length > 25) console.log(`  …and ${fixes.length - 25} more`)

  if (!APPLY) {
    console.log("\n(dry run — pass --apply to write)")
    await pool.end()
    return
  }

  let updated = 0
  for (const f of fixes) {
    await pool.query(
      `update jobs set employment_type = $2, updated_at = now() where id = $1`,
      [f.id, f.newType],
    )
    updated += 1
  }
  console.log(`updated ${updated} rows`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

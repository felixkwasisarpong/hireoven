/**
 * Promote employer-attested ACWIA cap exemption onto companies.
 *
 * lib/cap-exempt/classify.ts currently infers cap-exempt status from a company's NAME and domain
 * (".edu", "university", federal-lab patterns). The prevailing wage file contains the employer's
 * own attestation, under penalty of perjury, of which INA 214(g)(5) prong it falls under — a
 * strictly better signal for the employers it covers (1,125 distinct FEINs).
 *
 * This writes is_cap_exempt with source 'acwia_attested' and confidence 'high'. It only ever
 * SETS exemption, never clears it: an employer that did not attest on a wage determination may
 * still be exempt (many cap-exempt employers rarely file PWDs at all), so absence is not evidence.
 *
 * Dry run by default; pass --apply to write.
 *
 *   npx tsx scripts/promote-acwia-cap-exempt.ts
 *   npx tsx scripts/promote-acwia-cap-exempt.ts --apply
 *
 * ⚠ Joins companies via company_name_norm(pwd_records.employer_name) — NOT by equating
 * companies.name_normalized with pwd_records.employer_name_normalized. Those two columns are
 * produced by different normalizers and disagree.
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"

const APPLY = process.argv.includes("--apply")

/**
 * Deliberately stricter than the 4-char floor used elsewhere.
 *
 * Cap-exempt is a high-stakes flag in the harmful direction: a candidate who believes an employer
 * is exempt may take that offer expecting to skip the lottery entirely. A short normalized key is
 * exactly where entity collisions happen — 'Rare, Inc.' (a conservation nonprofit) normalizes to
 * `rare` and would silently adopt any company of ours named Rare. Real cap-exempt employers are
 * overwhelmingly long-named ("university of new mexico", "lawrence berkeley national laboratory"),
 * so this costs little recall and removes the collision class. Skipped names are logged so the
 * loss is visible rather than silent.
 */
const MIN_KEY_LENGTH = 8

async function main(): Promise<void> {
  const pool = getPostgresPool()
  const client = await pool.connect()

  try {
    await client.query("SET statement_timeout = 0")

    const { rows: preview } = await client.query<{
      company_id: string
      company_name: string
      employer_name: string
      reason: string
      already: boolean
      current_source: string | null
    }>(
      `WITH attested AS (
         SELECT company_name_norm(employer_name) AS cn,
                min(employer_name)               AS employer_name,
                bool_or(acwia_higher_education)  AS he,
                bool_or(acwia_affiliated_nonprofit) AS np,
                bool_or(acwia_research_org)      AS ro
           FROM pwd_records
          WHERE covered_by_acwia
            AND employer_name IS NOT NULL
          GROUP BY 1
       )
       SELECT c.id::text AS company_id, c.name AS company_name, a.employer_name,
              CASE WHEN a.he THEN 'university'
                   WHEN a.np THEN 'affiliated_nonprofit'
                   ELSE 'nonprofit_research' END AS reason,
              c.is_cap_exempt AS already,
              c.cap_exempt_source AS current_source
         FROM attested a
         JOIN companies c ON c.name_normalized = a.cn
        WHERE length(a.cn) >= $1`,
      [MIN_KEY_LENGTH]
    )

    const newly = preview.filter((r) => !r.already)
    const upgrades = preview.filter((r) => r.already && r.current_source !== "acwia_attested")

    // Surface what the length guard costs, so the recall loss is never silent.
    const { rows: skipped } = await client.query<{ employer_name: string; cn: string }>(
      `WITH attested AS (
         SELECT company_name_norm(employer_name) AS cn, min(employer_name) AS employer_name
           FROM pwd_records
          WHERE covered_by_acwia AND employer_name IS NOT NULL
          GROUP BY 1
       )
       SELECT a.employer_name, a.cn
         FROM attested a JOIN companies c ON c.name_normalized = a.cn
        WHERE length(a.cn) < $1
        ORDER BY a.cn`,
      [MIN_KEY_LENGTH]
    )
    if (skipped.length) {
      console.log(
        `skipped ${skipped.length} attested employer(s) whose normalized name is under ${MIN_KEY_LENGTH} chars ` +
          `(collision risk): ${skipped.map((s) => `${s.employer_name} [${s.cn}]`).slice(0, 12).join(", ")}`
      )
    }

    console.log(`attested employers matched to companies: ${preview.length.toLocaleString()}`)
    console.log(`  newly cap-exempt:            ${newly.length.toLocaleString()}`)
    console.log(`  already flagged (heuristic): ${upgrades.length.toLocaleString()} — will be upgraded to attested`)

    if (newly.length) {
      console.log("\nExamples of newly cap-exempt:")
      for (const r of newly.slice(0, 10)) {
        console.log(`  ${r.reason.padEnd(20)} ${r.company_name}  <- "${r.employer_name}"`)
      }
    }

    if (!APPLY) {
      console.log("\nDry run — nothing written. Re-run with --apply.")
      return
    }

    const res = await client.query(
      `WITH attested AS (
         SELECT company_name_norm(employer_name) AS cn,
                bool_or(acwia_higher_education)  AS he,
                bool_or(acwia_affiliated_nonprofit) AS np,
                bool_or(acwia_research_org)      AS ro
           FROM pwd_records
          WHERE covered_by_acwia AND employer_name IS NOT NULL
          GROUP BY 1
       )
       UPDATE companies c
          SET is_cap_exempt = true,
              cap_exempt_reason = CASE WHEN a.he THEN 'university'
                                       WHEN a.np THEN 'affiliated_nonprofit'
                                       ELSE 'nonprofit_research' END,
              cap_exempt_confidence = 'high',
              cap_exempt_source = 'acwia_attested',
              cap_exempt_verified_at = now()
         FROM attested a
        WHERE c.name_normalized = a.cn
          AND length(a.cn) >= $1
          AND (c.is_cap_exempt IS DISTINCT FROM true OR c.cap_exempt_source IS DISTINCT FROM 'acwia_attested')`,
      [MIN_KEY_LENGTH]
    )
    console.log(`\nUpdated ${res.rowCount?.toLocaleString() ?? 0} companies.`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

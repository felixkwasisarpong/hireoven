/**
 * Re-apply the CURRENT normalizeEmployerName() to every lca_records row.
 *
 * WHY: employer_name_normalized was written by whatever version of the normalizer was current at
 * import time, and that function has changed. The result is that one raw employer name can carry
 * two different normalized values across vintages — measured: 'AMAZON.COM SERVICES LLC' appears as
 * BOTH 'amazon com services' (11,750 rows, older normalizer) and 'amazon com' (11,620 rows,
 * current normalizer, which strips 'services' via LEGAL_SUFFIX_RE).
 *
 * That silently halves every large employer in any GROUP BY employer_name_normalized — which is
 * exactly how lib/h1b/transfer-velocity.ts and lib/h1b/placement-graph.ts aggregate. The same
 * company shows up as two competing rows in a "who can transfer me" ranking.
 *
 * Keyed on DISTINCT employer_name (92,640) rather than row id (728,993), so this is ~200 batched
 * statements instead of a per-row rewrite.
 *
 * Dry run by default; pass --apply to write.
 *
 *   npx tsx scripts/renormalize-lca-employers.ts
 *   npx tsx scripts/renormalize-lca-employers.ts --apply
 *
 * NOTE: after applying, the downstream aggregates need rebuilding —
 * scripts/rebuild-h1b-aggregates.ts and scripts/refresh-h1b-leaderboard.ts.
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"
import { normalizeEmployerName } from "@/lib/h1b/normalize-employer"

const APPLY = process.argv.includes("--apply")
const BATCH = 500

async function main(): Promise<void> {
  const pool = getPostgresPool()
  const client = await pool.connect()

  try {
    await client.query("SET statement_timeout = 0")

    console.log("Reading distinct employer names ...")
    const { rows } = await client.query<{ employer_name: string; employer_name_normalized: string | null }>(
      `SELECT DISTINCT employer_name, employer_name_normalized
         FROM lca_records
        WHERE employer_name IS NOT NULL`
    )
    console.log(`  ${rows.length.toLocaleString()} distinct (name, normalized) pairs`)

    // One raw name may currently map to several normalized values; we rewrite all of them.
    const fixes = new Map<string, string>()
    let alreadyCorrect = 0
    for (const r of rows) {
      const correct = normalizeEmployerName(r.employer_name)
      if (!correct) continue
      if (r.employer_name_normalized === correct) {
        alreadyCorrect++
        continue
      }
      fixes.set(r.employer_name, correct)
    }

    console.log(`  already correct: ${alreadyCorrect.toLocaleString()}`)
    console.log(`  need rewrite:    ${fixes.size.toLocaleString()} distinct names`)

    if (fixes.size) {
      console.log("\nExamples:")
      let shown = 0
      for (const r of rows) {
        const correct = fixes.get(r.employer_name)
        if (!correct || r.employer_name_normalized === correct) continue
        console.log(`  "${r.employer_name}"\n     ${r.employer_name_normalized} -> ${correct}`)
        if (++shown >= 8) break
      }
    }

    if (!APPLY) {
      console.log("\nDry run — nothing written. Re-run with --apply.")
      return
    }

    const entries = [...fixes.entries()]
    let updatedRows = 0
    for (let i = 0; i < entries.length; i += BATCH) {
      const chunk = entries.slice(i, i + BATCH)
      const values: unknown[] = []
      const tuples = chunk.map(([name, norm]) => {
        values.push(name, norm)
        return `($${values.length - 1},$${values.length})`
      })
      const res = await client.query(
        `UPDATE lca_records l
            SET employer_name_normalized = v.norm
           FROM (VALUES ${tuples.join(",")}) AS v(name, norm)
          WHERE l.employer_name = v.name
            AND l.employer_name_normalized IS DISTINCT FROM v.norm`,
        values
      )
      updatedRows += res.rowCount ?? 0
      if ((i / BATCH) % 20 === 0) {
        console.log(`  ${Math.min(i + BATCH, entries.length).toLocaleString()}/${entries.length.toLocaleString()} names, ${updatedRows.toLocaleString()} rows`)
      }
    }
    console.log(`\nDone — ${updatedRows.toLocaleString()} rows renormalized.`)
    console.log("Next: npx tsx scripts/rebuild-h1b-aggregates.ts")
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

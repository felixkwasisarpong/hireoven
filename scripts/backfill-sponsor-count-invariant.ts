/**
 * Repair companies whose 3-year sponsorship total is below their 1-year total.
 *
 * Two writers (enrich-h1b.ts and recompute-company-h1b-scores.ts) used to pair a
 * USCIS 1-year approval count with a DOL LCA 3-year certification count. Those
 * are different datasets, so wherever LCA employer-matching missed a company the
 * pair rendered as an impossibility — AWS showed "2,901 this yr · 0 (3yr)".
 * Both writers now roll from USCIS over nested windows (lib/h1b/sponsor-counts),
 * but the rows they already wrote stay wrong until this runs.
 *
 * Scope is deliberately narrow: ONLY rows that violate the invariant. At the
 * time of writing that is ~4,489 of 12,114 companies with sponsorship history,
 * so this is a small, targeted repair rather than a full-table sweep.
 *
 * RUN ON THE HARVESTER BOX. The web box is memory-constrained and unindexed
 * work against `jobs`/`companies` there has OOM-restarted prod Postgres before.
 *
 *   npx tsx scripts/backfill-sponsor-count-invariant.ts --dry-run
 *   npx tsx scripts/backfill-sponsor-count-invariant.ts --limit=500
 *   npx tsx scripts/backfill-sponsor-count-invariant.ts
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "../lib/postgres/server"
import { rollupSponsorCounts } from "../lib/h1b/sponsor-counts"

const args = process.argv.slice(2)
const DRY_RUN = args.includes("--dry-run")
const LIMIT = Number.parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0", 10) || null
const BATCH = 250

type Broken = { id: string; name: string; one_year: number; three_year: number }

async function main() {
  const pool = getPostgresPool()

  // Rows violating the invariant. Both counts are indexed-free but the predicate
  // is highly selective and `companies` is ~52k rows, so this is a cheap scan.
  const { rows: broken } = await pool.query<Broken>(
    `SELECT id, name,
            COALESCE(h1b_sponsor_count_1yr, 0) AS one_year,
            COALESCE(h1b_sponsor_count_3yr, 0) AS three_year
       FROM companies
      WHERE COALESCE(h1b_sponsor_count_1yr, 0) > 0
        AND COALESCE(h1b_sponsor_count_3yr, 0) < COALESCE(h1b_sponsor_count_1yr, 0)
      ORDER BY h1b_sponsor_count_1yr DESC
      ${LIMIT ? `LIMIT ${LIMIT}` : ""}`,
  )

  console.log(`[backfill] ${broken.length} companies violate 3yr >= 1yr${DRY_RUN ? "  (DRY RUN)" : ""}`)
  if (broken.length === 0) return

  let repaired = 0
  let unchanged = 0
  let noSource = 0

  for (let offset = 0; offset < broken.length; offset += BATCH) {
    const slice = broken.slice(offset, offset + BATCH)
    const ids = slice.map((row) => row.id)

    // USCIS approvals per company per year, for this batch only.
    const { rows: uscisRows } = await pool.query<{ company_id: string; year: number; approved: number }>(
      `SELECT company_id, year, COALESCE(SUM(approved), 0)::int AS approved
         FROM h1b_records
        WHERE company_id = ANY($1::uuid[])
        GROUP BY company_id, year`,
      [ids],
    )
    const byCompany = new Map<string, Map<number, { approved: number }>>()
    for (const row of uscisRows) {
      const years = byCompany.get(row.company_id) ?? new Map<number, { approved: number }>()
      years.set(Number(row.year), { approved: Number(row.approved) })
      byCompany.set(row.company_id, years)
    }

    // LCA three-year certifications, used only as a floor.
    const { rows: lcaRows } = await pool.query<{ company_id: string; stats_by_year: Record<string, { certified?: number }> | null }>(
      `SELECT company_id, stats_by_year FROM employer_lca_stats WHERE company_id = ANY($1::uuid[])`,
      [ids],
    )
    const lcaThreeYear = new Map<string, number>()
    for (const row of lcaRows) {
      const byYear = row.stats_by_year ?? {}
      const years = Object.keys(byYear)
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => b - a)
      const total = years
        .slice(0, 3)
        .reduce((sum, year) => sum + Number(byYear[String(year)]?.certified ?? 0), 0)
      lcaThreeYear.set(row.company_id, (lcaThreeYear.get(row.company_id) ?? 0) + total)
    }

    for (const row of slice) {
      const years = byCompany.get(row.id)
      if (!years || years.size === 0) {
        // No USCIS history to roll from. Clamping to the 1-year figure is the
        // conservative repair: it removes the impossibility without inventing
        // filings we have no record of.
        const clamped = row.one_year
        if (!DRY_RUN) {
          await pool.query(
            `UPDATE companies SET h1b_sponsor_count_3yr = $2, updated_at = now() WHERE id = $1`,
            [row.id, clamped],
          )
        }
        noSource += 1
        continue
      }

      const counts = rollupSponsorCounts(years, lcaThreeYear.get(row.id) ?? 0)
      if (counts.oneYear === row.one_year && counts.threeYear === row.three_year) {
        unchanged += 1
        continue
      }
      if (!DRY_RUN) {
        await pool.query(
          `UPDATE companies
              SET h1b_sponsor_count_1yr = $2, h1b_sponsor_count_3yr = $3, updated_at = now()
            WHERE id = $1`,
          [row.id, counts.oneYear, counts.threeYear],
        )
      }
      if (repaired < 10) {
        console.log(
          `  ${row.name.slice(0, 38).padEnd(40)} ${row.one_year}/${row.three_year}  ->  ${counts.oneYear}/${counts.threeYear}`,
        )
      }
      repaired += 1
    }

    console.log(`[backfill] ${Math.min(offset + BATCH, broken.length)}/${broken.length}`)
  }

  console.log(
    `\n[backfill] repaired=${repaired}  clamped_no_uscis=${noSource}  unchanged=${unchanged}${DRY_RUN ? "  (DRY RUN — nothing written)" : ""}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

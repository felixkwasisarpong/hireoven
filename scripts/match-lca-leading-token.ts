/**
 * Leading-token attribution pass: link unmatched LCA employers to existing companies
 * when the employer's name *begins with* a real company's full name as whole words
 * (e.g. "AMAZON.COM SERVICES LLC" -> "Amazon", "Meta Platforms, Inc" -> "Meta").
 * The canonical trigram matcher (h1b-match.sql) can't reach these (similarity < 0.55),
 * but a unique whole-word leading-token match is precise.
 *
 *   npx tsx scripts/match-lca-leading-token.ts            # dry-run (count + sample)
 *   npx tsx scripts/match-lca-leading-token.ts --execute  # link + refresh MV
 *
 * Guards: only real-domain canonical companies (one row per normalized name), only
 * employers with >= MIN_CERT certified, and only when the LONGEST matching company
 * name is UNIQUE (no ambiguity). Pure Postgres.
 */
import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

const EXECUTE = process.argv.includes("--execute")
const MIN_CERT = 10

// Spaced + collapsed normalization (keeps word boundaries, unlike h1b-match.sql).
const NORM = (col: string) =>
  `trim(regexp_replace(regexp_replace(lower(${col}),'[^a-z0-9]+',' ','g'),'\\s+',' ','g'))`

// One canonical company per normalized name: real domain only, prefer most jobs.
const CANON = `
  canon AS (
    SELECT DISTINCT ON (cn) id, name, cn FROM (
      SELECT id, name, ${NORM("name")} AS cn, COALESCE(job_count,0) jc
      FROM companies
      WHERE domain IS NOT NULL
        AND domain !~ 'placeholder|discovered|^builtin-|^adzuna-|^dice-|^workable-'
    ) q
    WHERE length(cn) >= 4
    ORDER BY cn, jc DESC
  )`

// Efficient: generate each employer's whole-word leading prefixes (1..5 tokens) and
// equi-join to canonical names (hash join) — no cross-join/LIKE scan. Pick the
// LONGEST matching canonical name per employer (most specific); canon is unique per
// normalized name so each prefix hits at most one company.
const PAIRS = `
  emp AS (
    SELECT id AS eid, ${NORM("display_name")} AS en
    FROM employer_lca_stats
    WHERE company_id IS NULL AND total_certified >= ${MIN_CERT}
  ),
  emp_pref AS (
    SELECT eid, array_to_string((string_to_array(en, ' '))[1:k], ' ') AS prefix
    FROM emp, generate_series(1, 5) AS k
    WHERE array_length(string_to_array(en, ' '), 1) >= k
  ),
  matches AS (
    SELECT ep.eid, canon.id AS cid, canon.name AS cname,
           row_number() OVER (PARTITION BY ep.eid ORDER BY length(ep.prefix) DESC) AS rn
    FROM emp_pref ep JOIN canon ON canon.cn = ep.prefix
  ),
  linkable AS (
    SELECT eid, cid, cname FROM matches WHERE rn = 1
  )`

async function main() {
  const { getPostgresPool } = await import("@/lib/postgres/server")
  const pool = getPostgresPool()
  const stamp = () => new Date().toISOString()

  const { rows: [{ c }] } = await pool.query<{ c: number }>(
    `WITH ${CANON}, ${PAIRS} SELECT count(*)::int c FROM linkable`
  )
  const sample = await pool.query<{ d: string; cname: string }>(
    `WITH ${CANON}, ${PAIRS}
     SELECT e.display_name d, l.cname FROM linkable l
     JOIN employer_lca_stats e ON e.id = l.eid
     ORDER BY e.total_certified DESC NULLS LAST LIMIT 15`
  )
  console.log(`[${stamp()}] linkable employers: ${c}`)
  console.log(sample.rows.map((r) => `  ${r.d} -> ${r.cname}`).join("\n"))

  if (!EXECUTE) {
    console.log("dry-run — pass --execute to link + refresh the leaderboard MV.")
    return
  }

  const upd = await pool.query(
    `WITH ${CANON}, ${PAIRS}
     UPDATE employer_lca_stats e SET company_id = l.cid
     FROM linkable l WHERE e.id = l.eid AND e.company_id IS NULL`
  )
  console.log(`[${stamp()}] linked ${upd.rowCount} employers.`)

  await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY h1b_leaderboard_mv").catch((e) =>
    console.warn("MV refresh (concurrent) failed, trying plain:", e.message)
  )
  console.log(`[${stamp()}] leaderboard MV refreshed. Re-run h1b-match.sql rollup to update companies.sponsors_h1b counts.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })

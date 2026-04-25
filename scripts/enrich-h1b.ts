/**
 * Two-phase H1B enrichment:
 *
 * Phase 1 — RELINK: match unlinked h1b_records and employer_lca_stats rows to
 *   existing companies using normalized name matching (no fuzzy distance).
 *   Strategies (in priority order):
 *     1. raw case-insensitive exact match on company.name
 *     2. normalized key (strip punctuation, legal suffixes, & → AND)
 *     3. tight key (normalized with spaces removed)
 *   Only unique matches are linked; ambiguous matches are skipped.
 *
 * Phase 2 — RECOMPUTE: rebuild denormalized sponsorship fields on companies
 *   (sponsors_h1b, sponsorship_confidence, h1b_sponsor_count_1yr/3yr)
 *   from the now-linked h1b_records and employer_lca_stats tables.
 *
 * Usage:
 *   npx tsx scripts/enrich-h1b.ts                          # dry run (both phases)
 *   npx tsx scripts/enrich-h1b.ts --execute                # run both phases
 *   npx tsx scripts/enrich-h1b.ts --execute --phase=relink # only phase 1
 *   npx tsx scripts/enrich-h1b.ts --execute --phase=recompute # only phase 2
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool, type PoolClient } from "pg"

// ─── CLI ────────────────────────────────────────────────────────────────────

const execute = process.argv.includes("--execute")
const phaseArg = process.argv.find((a) => a.startsWith("--phase="))?.split("=")[1] ?? "all"
const runRelink = phaseArg === "all" || phaseArg === "relink"
const runRecompute = phaseArg === "all" || phaseArg === "recompute"

// ─── Name normalization ──────────────────────────────────────────────────────

const LEGAL_SUFFIXES = new Set([
  "INC", "INCORPORATED", "LLC", "LLC.", "L.L.C", "LTD", "LIMITED",
  "CORP", "CORPORATION", "CO", "COMPANY", "PLC", "LLP", "LP",
  "HOLDINGS", "HOLDING", "GROUP", "SERVICES", "SOLUTIONS",
])

function normalizeKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !LEGAL_SUFFIXES.has(t))
    .join(" ")
    .trim()
}

function tightKey(name: string): string {
  return normalizeKey(name).replace(/\s+/g, "")
}

function upperKey(name: string): string {
  return name.toUpperCase().trim()
}

// ─── Matching ────────────────────────────────────────────────────────────────

type Company = { id: string; name: string }

function buildIndexes(companies: Company[]) {
  const byUpper = new Map<string, Company[]>()
  const byNorm = new Map<string, Company[]>()
  const byTight = new Map<string, Company[]>()

  for (const c of companies) {
    const u = upperKey(c.name)
    const n = normalizeKey(c.name)
    const t = tightKey(c.name)
    byUpper.set(u, [...(byUpper.get(u) ?? []), c])
    if (n) byNorm.set(n, [...(byNorm.get(n) ?? []), c])
    if (t) byTight.set(t, [...(byTight.get(t) ?? []), c])
  }
  return { byUpper, byNorm, byTight }
}

function matchEmployer(
  employerName: string,
  idx: ReturnType<typeof buildIndexes>
): { company: Company; mode: string } | null {
  const u = upperKey(employerName)
  const candidates = idx.byUpper.get(u)
  if (candidates?.length === 1) return { company: candidates[0], mode: "raw" }
  if (candidates && candidates.length > 1) return null // ambiguous

  const n = normalizeKey(employerName)
  if (n) {
    const nc = idx.byNorm.get(n)
    if (nc?.length === 1) return { company: nc[0], mode: "norm" }
    if (nc && nc.length > 1) return null
  }

  const t = tightKey(employerName)
  if (t) {
    const tc = idx.byTight.get(t)
    if (tc?.length === 1) return { company: tc[0], mode: "tight" }
  }

  return null
}

// ─── Phase 1: relink h1b_records ────────────────────────────────────────────

async function relinkH1BRecords(pool: Pool, companies: Company[]) {
  console.log("\n[relink] Loading distinct unmatched employers from h1b_records...")
  const { rows: employers } = await pool.query<{
    employer_name: string
    row_count: string
    total_approved: string
  }>(`
    SELECT employer_name,
           COUNT(*)                          AS row_count,
           SUM(COALESCE(approved, 0))        AS total_approved
    FROM h1b_records
    WHERE company_id IS NULL AND employer_name IS NOT NULL
    GROUP BY employer_name
    ORDER BY SUM(COALESCE(approved, 0)) DESC
  `)
  console.log(`[relink] ${employers.length.toLocaleString()} distinct unmatched employer names in h1b_records`)

  const idx = buildIndexes(companies)
  const matches: Array<{ employerName: string; companyId: string; mode: string; rows: number }> = []
  let ambiguous = 0
  let noMatch = 0

  for (const emp of employers) {
    const result = matchEmployer(emp.employer_name, idx)
    if (!result) {
      if (upperKey(emp.employer_name) !== emp.employer_name.toUpperCase()) ambiguous++
      else noMatch++
      continue
    }
    matches.push({
      employerName: emp.employer_name,
      companyId: result.company.id,
      mode: result.mode,
      rows: Number(emp.row_count),
    })
  }

  console.log(`[relink] Matched: ${matches.length} | No match: ${noMatch} | Skipped (ambiguous): ${ambiguous}`)

  // Show top matches
  for (const m of matches.slice(0, 15)) {
    console.log(`  [${m.mode}] "${m.employerName}" → ${companies.find((c) => c.id === m.companyId)?.name} (${m.rows} rows)`)
  }

  if (!execute) return matches.length

  let linked = 0
  const BATCH = 100
  for (let i = 0; i < matches.length; i += BATCH) {
    const batch = matches.slice(i, i + BATCH)
    await Promise.all(
      batch.map((m) =>
        pool.query(
          "UPDATE h1b_records SET company_id = $1 WHERE employer_name = $2 AND company_id IS NULL",
          [m.companyId, m.employerName]
        )
      )
    )
    linked += batch.length
    if (linked % 500 === 0 || linked === matches.length) {
      process.stdout.write(`\r[relink] h1b_records updated: ${linked}/${matches.length}`)
    }
  }
  console.log()
  return linked
}

// ─── Phase 1b: relink employer_lca_stats ────────────────────────────────────

async function relinkLCAStats(pool: Pool, companies: Company[]) {
  console.log("\n[relink] Loading unmatched rows from employer_lca_stats...")
  const { rows: lcaRows } = await pool.query<{
    id: string
    employer_name_normalized: string
    display_name: string | null
    total_certified: number
  }>(
    "SELECT id, employer_name_normalized, display_name, total_certified FROM employer_lca_stats WHERE company_id IS NULL ORDER BY total_certified DESC NULLS LAST"
  )
  console.log(`[relink] ${lcaRows.length} unmatched employer_lca_stats rows`)

  const idx = buildIndexes(companies)
  let matched = 0
  let missed = 0

  for (const row of lcaRows) {
    const nameToMatch = row.display_name ?? row.employer_name_normalized
    const result = matchEmployer(nameToMatch, idx)
    if (!result) { missed++; continue }

    console.log(`  [${result.mode}] LCA: "${nameToMatch}" → ${result.company.name}`)
    matched++
    if (execute) {
      await pool.query(
        "UPDATE employer_lca_stats SET company_id = $1 WHERE id = $2",
        [result.company.id, row.id]
      )
    }
  }

  console.log(`[relink] LCA stats matched: ${matched} | missed: ${missed}`)
  return matched
}

// ─── Phase 2: recompute company sponsorship fields ──────────────────────────

async function recomputeScores(pool: Pool) {
  console.log("\n[recompute] Building USCIS snapshots from h1b_records...")

  const { rows: uscisRows } = await pool.query<{
    company_id: string
    year: number
    approved: number
    denied: number
  }>(
    "SELECT company_id, year, COALESCE(approved,0) AS approved, COALESCE(denied,0) AS denied FROM h1b_records WHERE company_id IS NOT NULL"
  )

  const uscisByCompany = new Map<string, Map<number, { approved: number; denied: number }>>()
  for (const r of uscisRows) {
    const byYear = uscisByCompany.get(r.company_id) ?? new Map()
    const cur = byYear.get(r.year) ?? { approved: 0, denied: 0 }
    cur.approved += Number(r.approved)
    cur.denied += Number(r.denied)
    byYear.set(r.year, cur)
    uscisByCompany.set(r.company_id, byYear)
  }

  console.log(`[recompute] ${uscisByCompany.size} companies have USCIS records`)

  const { rows: lcaRows } = await pool.query<{
    company_id: string
    total_certified: number
    total_denied: number
    certification_rate: number | null
    stats_by_year: Record<string, { certified?: number }> | null
  }>(
    "SELECT company_id, total_certified, total_denied, certification_rate, stats_by_year FROM employer_lca_stats WHERE company_id IS NOT NULL"
  )

  type LCASnapshot = { cert1y: number; cert3y: number; approvalRate: number }
  const lcaByCompany = new Map<string, LCASnapshot>()

  for (const r of lcaRows) {
    const certByYear = new Map<number, number>()
    if (r.stats_by_year && typeof r.stats_by_year === "object") {
      for (const [y, s] of Object.entries(r.stats_by_year)) {
        const year = Number(y)
        if (Number.isFinite(year)) {
          certByYear.set(year, (certByYear.get(year) ?? 0) + (Number(s?.certified) || 0))
        }
      }
    }
    const years = [...certByYear.keys()].sort((a, b) => b - a)
    const cert1y = years.length > 0 ? (certByYear.get(years[0]) ?? 0) : 0
    const cert3y = years.slice(0, 3).reduce((s, y) => s + (certByYear.get(y) ?? 0), 0)
    const approvalRate = r.certification_rate != null
      ? Number(r.certification_rate)
      : (() => { const d = Number(r.total_certified) + Number(r.total_denied); return d > 0 ? Number(r.total_certified) / d : 0 })()
    const existing = lcaByCompany.get(r.company_id)
    lcaByCompany.set(r.company_id, {
      cert1y: (existing?.cert1y ?? 0) + cert1y,
      cert3y: (existing?.cert3y ?? 0) + cert3y,
      approvalRate,
    })
  }

  console.log(`[recompute] ${lcaByCompany.size} companies have LCA records`)

  const { rows: companies } = await pool.query<{
    id: string
    name: string
    sponsorship_confidence: number | null
    sponsors_h1b: boolean | null
    h1b_sponsor_count_1yr: number | null
    h1b_sponsor_count_3yr: number | null
  }>(
    "SELECT id, name, sponsorship_confidence, sponsors_h1b, h1b_sponsor_count_1yr, h1b_sponsor_count_3yr FROM companies"
  )

  const updates: Array<{ id: string; name: string; patch: Record<string, unknown> }> = []

  for (const c of companies) {
    const uscis = uscisByCompany.get(c.id)
    const lca = lcaByCompany.get(c.id)

    let patch: Record<string, unknown>

    if (uscis) {
      const latestYear = Math.max(...Array.from(uscis.keys()))
      const latest = uscis.get(latestYear) ?? { approved: 0, denied: 0 }
      const total = latest.approved + latest.denied
      const approvalRate = total > 0 ? latest.approved / total : 0
      const lca3y = lca?.cert3y ?? 0

      let conf = 0
      if (latest.approved > 0) conf += 70
      if (approvalRate > 0.8) conf += 10
      if (latest.approved > 10) conf += 10
      if (latest.approved > 50) conf += 10

      patch = {
        sponsors_h1b: latest.approved > 0 || lca3y > 0,
        sponsorship_confidence: Math.min(100, conf),
        h1b_sponsor_count_1yr: latest.approved,
        h1b_sponsor_count_3yr: lca3y,
      }
    } else if (lca) {
      let conf = 0
      if (lca.cert1y > 0) conf += 70
      if (lca.approvalRate > 0.85) conf += 10
      if (lca.cert1y > 10) conf += 10
      if (lca.cert1y > 50) conf += 10

      patch = {
        sponsors_h1b: lca.cert1y > 0 || lca.cert3y > 0,
        sponsorship_confidence: Math.min(100, conf),
        h1b_sponsor_count_1yr: lca.cert1y,
        h1b_sponsor_count_3yr: lca.cert3y,
      }
    } else {
      continue // no data → leave as-is
    }

    // Skip if nothing changed
    const unchanged =
      (c.sponsorship_confidence ?? 0) === patch.sponsorship_confidence &&
      Boolean(c.sponsors_h1b) === patch.sponsors_h1b &&
      (c.h1b_sponsor_count_1yr ?? 0) === patch.h1b_sponsor_count_1yr &&
      (c.h1b_sponsor_count_3yr ?? 0) === patch.h1b_sponsor_count_3yr

    if (!unchanged) updates.push({ id: c.id, name: c.name, patch })
  }

  updates.sort((a, b) => (Number(b.patch.sponsorship_confidence) - Number(a.patch.sponsorship_confidence)))

  console.log(`[recompute] ${updates.length} companies need updating`)
  for (const u of updates.slice(0, 20)) {
    console.log(`  ${u.name.slice(0, 48).padEnd(48)} conf=${u.patch.sponsorship_confidence} 1yr=${u.patch.h1b_sponsor_count_1yr}`)
  }

  if (!execute) return updates.length

  let done = 0
  for (const u of updates) {
    await pool.query(
      `UPDATE companies SET
        sponsors_h1b = $1,
        sponsorship_confidence = $2,
        h1b_sponsor_count_1yr = $3,
        h1b_sponsor_count_3yr = $4,
        updated_at = NOW()
       WHERE id = $5`,
      [u.patch.sponsors_h1b, u.patch.sponsorship_confidence, u.patch.h1b_sponsor_count_1yr, u.patch.h1b_sponsor_count_3yr, u.id]
    )
    done++
    if (done % 100 === 0 || done === updates.length) {
      process.stdout.write(`\r[recompute] updated ${done}/${updates.length}`)
    }
  }
  console.log()
  return done
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[enrich-h1b] mode=${execute ? "EXECUTE" : "DRY RUN"} phases=${phaseArg}\n`)

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const { rows: companies } = await pool.query<Company>("SELECT id, name FROM companies")
  console.log(`[enrich-h1b] ${companies.length} companies loaded`)

  if (runRelink) {
    await relinkH1BRecords(pool, companies)
    await relinkLCAStats(pool, companies)
  }

  if (runRecompute) {
    await recomputeScores(pool)
  }

  if (!execute) {
    console.log("\nDry run complete. Re-run with --execute to apply changes.")
  }

  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })

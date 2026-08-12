/**
 * T1-06 — propose company-entity merges (READ-ONLY).
 *
 * Big employers are fragmented into multiple `companies` rows because the crawl
 * pipeline creates a row per identifier (real domain + Oracle tenant domain +
 * adzuna placeholder + other-ATS "discovered" rows) and the dedup pass misses
 * the tail. This script GROUPS active companies by name_normalized, picks a
 * survivor, and prints merge PROPOSALS — it writes nothing. A human reviews the
 * output before any merge is executed (past auto-merges picked the wrong
 * survivor and stranded live records).
 *
 * Survivor rule: the row with a REAL domain (not a placeholder/tenant/discovered
 * synthetic) + a working ats_type + the most jobs. Groups with two or more real
 * domains are NOT proposed — they may be distinct entities (e.g. "Kroger" vs
 * "The Kroger Co.") — and go to a NEEDS-REVIEW bucket instead.
 *
 * Run: DATABASE_URL=... npx tsx scripts/propose-company-merges.ts
 */
import pg from "pg"

type Row = { id: string; name: string; name_normalized: string; domain: string | null; job_count: number; ats_type: string | null }

const SYNTHETIC = /(\.placeholder$|-tenant$|-discovered|\.workable-discovered|:)/i
function isRealDomain(d: string | null): boolean {
  if (!d) return false
  if (SYNTHETIC.test(d)) return false
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) // looks like a hostname, no spaces
}

;(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false })
  const { rows } = await pool.query<Row>(
    `SELECT id::text, name, name_normalized, domain, job_count, ats_type
       FROM companies
      WHERE is_active = true AND job_count > 0
        AND name_normalized IN (
          SELECT name_normalized FROM companies
           WHERE is_active = true AND job_count > 0
           GROUP BY name_normalized HAVING count(*) > 1)
      ORDER BY name_normalized, job_count DESC`,
  )
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const g = groups.get(r.name_normalized) ?? []
    g.push(r); groups.set(r.name_normalized, g)
  }

  const confident: Array<{ key: string; survivor: Row; merge: Row[]; reclaimed: number }> = []
  const review: Array<{ key: string; realDomains: Row[] }> = []

  for (const [key, g] of groups) {
    const real = g.filter((r) => isRealDomain(r.domain))
    if (real.length >= 2) { review.push({ key, realDomains: real }); continue }
    // survivor: the one real-domain row if present, else the biggest overall
    const survivor = (real[0] ?? g[0])
    const merge = g.filter((r) => r.id !== survivor.id)
    if (merge.length === 0) continue
    confident.push({ key, survivor, merge, reclaimed: merge.reduce((s, r) => s + r.job_count, 0) })
  }
  confident.sort((a, b) => b.reclaimed - a.reclaimed)
  review.sort((a, b) => b.realDomains.reduce((s, r) => s + r.job_count, 0) - a.realDomains.reduce((s, r) => s + r.job_count, 0))

  console.log(`groups=${groups.size}  confident=${confident.length}  needs_review=${review.length}`)
  console.log(`\n=== TOP CONFIDENT MERGES (survivor <= merge rows) ===`)
  for (const c of confident.slice(0, 20)) {
    console.log(`\n[${c.key}]  survivor: "${c.survivor.name}" ${c.survivor.domain} (${c.survivor.job_count}, ${c.survivor.ats_type ?? "no-ats"})`)
    for (const m of c.merge) console.log(`   merge <- "${m.name}" ${m.domain} (${m.job_count}, ${m.ats_type ?? "no-ats"})`)
  }
  console.log(`\n=== TOP NEEDS-REVIEW (>=2 real domains — maybe distinct) ===`)
  for (const r of review.slice(0, 15)) {
    console.log(`[${r.key}]  ` + r.realDomains.map((d) => `${d.domain}(${d.job_count},${d.ats_type ?? "-"})`).join("  "))
  }
  await pool.end()
})()

/**
 * Repair dedup mis-merges that stopped boards from being crawled.
 *
 * A buggy name/domain dedup run created two failure modes among adapter-backed
 * company records (verified 2026-07-09):
 *
 *   1. CYCLES: A.duplicate_of_company_id = B AND B.duplicate_of_company_id = A.
 *      The harvester claim query skips any row with duplicate_of_company_id set,
 *      so BOTH ends are skipped → the employer's board(s) stop crawling entirely.
 *      (~1,262 cycles / ~99k live jobs.)
 *   2. DEAD/BROKEN CANONICAL: a live adapter record points at a canonical that is
 *      dead / inactive / itself a duplicate (Walmart-class). Nobody crawls it.
 *
 * Repair, per broken group:
 *   • Pick the canonical = best record by (working adapter + careers_url,
 *     is_active, job_count, oldest created_at).
 *   • If the two records are the SAME employer (equal/substring name slug OR
 *     shared domain) → keep them merged: clear the winner's dup pointer +
 *     reactivate it; point the loser at the winner and mark it inactive.
 *   • If they are DISSIMILAR (likely a WRONG merge, e.g. "Clackamas Town Center"
 *     ↔ "Jcrew") → SPLIT: un-merge BOTH, reactivate both, so neither employer
 *     stays hidden/uncrawled. These are logged distinctly for review.
 *
 * This never MOVES jobs (each record keeps its own) and never leaves a winner
 * pointing at a loser, so there is no double-crawl of an identical board beyond
 * what maintenance.ts COMPANY_DEDUP_SQL (same ats_type+identifier) re-collapses.
 *
 * Dry-run by default. Pass --execute to write. --limit=N caps groups touched.
 *
 * Usage:
 *   npx tsx scripts/repair-dedup-cycles.ts               # dry-run summary
 *   npx tsx scripts/repair-dedup-cycles.ts --execute     # apply
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const EXECUTE = args.includes("--execute")
const limitArg = args.find((a) => a.startsWith("--limit="))
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) || 0 : 0

const REAL_ADAPTER = (t: string | null): boolean =>
  !!t && !["jsonld", "custom", ""].includes(t)

function nameSlug(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/\b(inc|corp|corporation|company|co|llc|group|ltd|the|llp|plc|gmbh|holdings|international)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "")
}

function rootDomain(domain: string | null): string {
  if (!domain) return ""
  const d = domain.toLowerCase().trim()
  // Ignore synthetic placeholder/discovered hosts — they aren't a real brand.
  if (/placeholder|discovered|-employer\b/.test(d)) return ""
  const parts = d.split(".").filter(Boolean)
  return parts.length >= 2 ? parts.slice(-2).join(".") : d
}

type Row = {
  id: string
  name: string
  ats_type: string | null
  ats_identifier: string | null
  is_active: boolean
  status: string | null
  job_count: number | null
  careers_url: string | null
  domain: string | null
  created_at: string | null
  duplicate_of_company_id: string | null
}

/** Higher score = better canonical. */
function score(r: Row): number {
  let s = 0
  if (REAL_ADAPTER(r.ats_type) && r.careers_url) s += 1000
  if (r.is_active) s += 100
  if (r.status === "active") s += 10
  s += Math.min(Number(r.job_count) || 0, 9_000) / 1000 // up to +9, job_count tiebreak
  return s
}

function pickWinner(a: Row, b: Row): { win: Row; lose: Row } {
  const sa = score(a)
  const sb = score(b)
  if (sa !== sb) return sa > sb ? { win: a, lose: b } : { win: b, lose: a }
  // Tie → older created_at wins (stable, matches COMPANY_DEDUP_SQL).
  const ta = a.created_at ? Date.parse(a.created_at) : Infinity
  const tb = b.created_at ? Date.parse(b.created_at) : Infinity
  return ta <= tb ? { win: a, lose: b } : { win: b, lose: a }
}

function sameEmployer(a: Row, b: Row): boolean {
  const sa = nameSlug(a.name)
  const sb = nameSlug(b.name)
  if (sa && sb && (sa === sb || sa.includes(sb) || sb.includes(sa))) return true
  const da = rootDomain(a.domain)
  const db = rootDomain(b.domain)
  if (da && db && da === db) return true
  return false
}

async function main() {
  const pool = getPostgresPool()

  // ── Load all 2-cycles among adapter-backed rows ──
  const { rows: cycleRows } = await pool.query<{ a: string; b: string }>(`
    SELECT a.id AS a, b.id AS b
    FROM companies a
    JOIN companies b ON a.duplicate_of_company_id = b.id
    WHERE b.duplicate_of_company_id = a.id
      AND a.id < b.id
  `)

  const ids = new Set<string>()
  for (const c of cycleRows) { ids.add(c.a); ids.add(c.b) }

  if (ids.size === 0) {
    console.log("No cycles found.")
    await pool.end()
    return
  }

  const { rows: detailRows } = await pool.query<Row>(
    `SELECT id, name, ats_type, ats_identifier, is_active, status, job_count,
            careers_url, domain, created_at::text, duplicate_of_company_id
     FROM companies WHERE id = ANY($1::uuid[])`,
    [Array.from(ids)]
  )
  const byId = new Map(detailRows.map((r) => [r.id, r]))

  let pairs = cycleRows
    .map((c) => ({ a: byId.get(c.a)!, b: byId.get(c.b)! }))
    .filter((p) => p.a && p.b)
  if (LIMIT > 0) pairs = pairs.slice(0, LIMIT)

  const plan: Array<{
    kind: "merge" | "split"
    win: Row
    lose: Row
  }> = []

  for (const { a, b } of pairs) {
    const { win, lose } = pickWinner(a, b)
    plan.push({ kind: sameEmployer(a, b) ? "merge" : "split", win, lose })
  }

  const merges = plan.filter((p) => p.kind === "merge")
  const splits = plan.filter((p) => p.kind === "split")
  const jobsFreed = plan.reduce(
    (n, p) => n + (Number(p.win.job_count) || 0) + (p.kind === "split" ? Number(p.lose.job_count) || 0 : 0),
    0
  )

  console.log(`\nCYCLE REPAIR PLAN  (${EXECUTE ? "EXECUTE" : "DRY-RUN"})`)
  console.log(`  cycles:            ${plan.length}`)
  console.log(`  same-employer merge: ${merges.length}  (promote winner, keep loser merged)`)
  console.log(`  dissimilar SPLIT:    ${splits.length}  (un-merge BOTH — likely wrong merges)`)
  console.log(`  boards re-crawled ≈ ${plan.length + splits.length}  |  job_count on promoted boards ≈ ${jobsFreed}\n`)

  console.log("── sample SPLITS (dissimilar pairs un-merged) ──")
  for (const p of splits.slice(0, 15)) {
    console.log(`  SPLIT  "${p.win.name}" (${p.win.ats_type},jc=${p.win.job_count})  ✕  "${p.lose.name}" (${p.lose.ats_type},jc=${p.lose.job_count})`)
  }
  console.log("\n── sample MERGES (winner ← loser) ──")
  for (const p of merges.slice(0, 15)) {
    console.log(`  KEEP  "${p.win.name}" (${p.win.ats_type},jc=${p.win.job_count},act=${p.win.is_active})  ←  "${p.lose.name}" (jc=${p.lose.job_count})`)
  }

  if (!EXECUTE) {
    console.log(`\nDry-run only. Re-run with --execute to apply.`)
    await pool.end()
    return
  }

  // A partial unique index (uq_companies_ats_pair_active) allows only ONE
  // canonical (duplicate_of_company_id IS NULL) per (ats_type, ats_identifier).
  // So before promoting a record we must check whether its board already has a
  // canonical owner elsewhere — if so, we merge INTO that owner instead of
  // creating a second canonical (which would violate the index).
  async function canonicalOwner(r: Row, excludeIds: string[]): Promise<string | null> {
    if (!r.ats_type || !r.ats_identifier) return null
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM companies
       WHERE ats_type = $1 AND ats_identifier IS NOT NULL
         AND lower(ats_identifier) = lower($2)
         AND duplicate_of_company_id IS NULL
         AND id <> ALL($3::uuid[])
       LIMIT 1`,
      [r.ats_type, r.ats_identifier, excludeIds]
    )
    return rows[0]?.id ?? null
  }
  const promote = (id: string) =>
    client.query(
      `UPDATE companies SET duplicate_of_company_id = NULL, is_active = true,
         status = 'active', crawl_allowed = true, next_harvest_at = now(), updated_at = now()
       WHERE id = $1`,
      [id]
    )
  const mergeInto = (id: string, canon: string) =>
    client.query(
      `UPDATE companies SET duplicate_of_company_id = $2, is_active = false, updated_at = now()
       WHERE id = $1`,
      [id, canon]
    )

  const client = await pool.connect()
  let done = 0
  let skipped = 0
  try {
    for (const p of plan) {
      try {
        await client.query("BEGIN")
        // Winner: promote unless its board already has a canonical owner.
        const wOwner = await canonicalOwner(p.win, [p.win.id, p.lose.id])
        const winnerCanon = wOwner ?? p.win.id
        if (wOwner) await mergeInto(p.win.id, wOwner)
        else await promote(p.win.id)

        if (p.kind === "merge") {
          // Same employer → loser merges into whatever the winner resolved to.
          await mergeInto(p.lose.id, winnerCanon)
        } else {
          // Different employer → give the loser its own canonical (or defer to
          // an existing owner of its board; the winner is now visible to the check).
          const lOwner = await canonicalOwner(p.lose, [p.lose.id])
          if (lOwner) await mergeInto(p.lose.id, lOwner)
          else await promote(p.lose.id)
        }
        await client.query("COMMIT")
        done += 1
        if (done % 200 === 0) console.log(`  …applied ${done}/${plan.length}`)
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {})
        skipped += 1
        console.log(`  ⚠ skipped "${p.win.name}" ↔ "${p.lose.name}": ${(e as Error).message}`)
      }
    }
  } finally {
    client.release()
  }

  console.log(`\n✔ Applied ${done} cycle repairs (${merges.length} merges, ${splits.length} splits); skipped ${skipped}.`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

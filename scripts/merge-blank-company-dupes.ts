/**
 * Auto-merge blank-logo company rows into the canonical real-domain row for the
 * SAME company. The tail of blank companies (ATS `*-tenant` / `:wdN:` /
 * `*-discovered` / adzuna `*.placeholder` / bare `*.bamboohr.com`) is mostly
 * duplicates of a canonical row that already owns the real domain + logo.
 *
 * Matching is EXACT-key only (never substring) so it under-merges rather than
 * ever combining two different companies:
 *   keys(blank)     = { normalizedName, tenantSlug }
 *   keys(canonical) = { normalizedName, domainStem }
 * A blank merges into a canonical iff they share an exact key of length >= 4.
 * Keys that map to >1 distinct canonical are AMBIGUOUS and dropped.
 *
 * Merge is the proven delete-free pattern (repoint non-colliding jobs -> hide
 * leftover duplicate jobs -> deactivate the dupe), reactivating the canonical
 * if it was inactive.
 *
 * Usage:
 *   npx tsx scripts/merge-blank-company-dupes.ts --dry-run            # preview all
 *   npx tsx scripts/merge-blank-company-dupes.ts --dry-run --min-jobs=50
 *   npx tsx scripts/merge-blank-company-dupes.ts --apply --min-jobs=1
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { readFileSync } from "node:fs"

loadEnvConfig(process.cwd())

// Common English words — used to reject ambiguous single-word matches
// ("Republic" -> Republic Airways) while keeping exact-name matches (Oracle==Oracle).
const DICT = new Set<string>()
try {
  for (const w of readFileSync("/usr/share/dict/words", "utf8").split("\n")) {
    const t = w.trim().toLowerCase()
    if (t.length >= 4) DICT.add(t)
  }
} catch { /* no dict available -> guard is a no-op */ }

const argv = process.argv.slice(2)
const APPLY = argv.includes("--apply")
const DRY_RUN = !APPLY
const minJobsArg = argv.find((a) => a.startsWith("--min-jobs="))
const MIN_JOBS = minJobsArg ? Math.max(0, Number(minJobsArg.split("=")[1])) : 1
const limitArg = argv.find((a) => a.startsWith("--limit="))
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 0

const MIN_KEY_LEN = 4

// A domain that is NOT a real company website (ATS host / placeholder sentinel).
const BLANK_DOMAIN_RE =
  /(-tenant$|\.placeholder$|-discovered$|\.discovered$|reverted-placeholder$|:wd\d|myworkdayjobs|\.icims\.|lever\.co|smartrecruiters|\.workable\.com|greenhouse|\.bamboohr\.com$|bamboohr-tenant|oraclecloud|jazzhr|paylocity|\.ukg\.|workforcenow|\.adp\.|builtin-discovery)/i

function isRealDomain(d: string | null): boolean {
  if (!d) return false
  if (BLANK_DOMAIN_RE.test(d)) return false
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)
}

const LEGAL_SUFFIX_RE =
  /[,\s]+(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|companies|llp|plc|incorporated|holdings?|group|na|usa|us|america[ns]?|stores?|hourly|external|careers?)\.?$/gi

function normalizeName(name: string): string {
  let s = (name ?? "").toLowerCase().trim()
  let prev = ""
  while (s !== prev) { prev = s; s = s.replace(LEGAL_SUFFIX_RE, "").trim() }
  return s.replace(/[^a-z0-9]/g, "")
}

/** Stem of a real domain: label before the TLD, minus separators. */
function domainStem(domain: string): string {
  const host = domain.toLowerCase().replace(/^www\./, "")
  const labels = host.split(".")
  const stem = labels.length > 2 ? labels[labels.length - 2] : labels[0]
  return (stem ?? "").replace(/[^a-z0-9]/g, "")
}

/** ATS tenant slug embedded in a blank domain. */
function tenantSlug(domain: string): string {
  let s = domain.toLowerCase().split(":")[0]!.split(".")[0]!
  s = s.replace(/^(adzuna|dice)-/, "")
  return s.replace(/[^a-z0-9]/g, "")
}

type Co = { id: string; name: string; domain: string; is_active: boolean }

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const { rows: all } = await pool.query<Co>(
    `SELECT id, name, domain, is_active FROM companies WHERE domain IS NOT NULL`
  )

  const canon: Co[] = []
  const blanks: Co[] = []
  for (const c of all) {
    if (c.is_active && isRealDomain(c.domain)) canon.push(c)
    else if (BLANK_DOMAIN_RE.test(c.domain)) blanks.push(c)
  }

  // Build exact-key -> canonical index. Keys mapping to >1 canonical are dropped.
  const index = new Map<string, Co | "AMBIGUOUS">()
  const addKey = (key: string, c: Co) => {
    if (key.length < MIN_KEY_LEN) return
    const cur = index.get(key)
    if (!cur) index.set(key, c)
    else if (cur !== "AMBIGUOUS" && cur.id !== c.id) index.set(key, "AMBIGUOUS")
  }
  for (const c of canon) {
    addKey(normalizeName(c.name), c)
    addKey(domainStem(c.domain), c)
  }

  // Match each blank to a canonical by any exact key.
  const pairs: { blank: Co; canon: Co }[] = []
  for (const b of blanks) {
    const bName = normalizeName(b.name)
    const bKeys = [bName, tenantSlug(b.domain)].filter((k) => k.length >= MIN_KEY_LEN)
    // canonId -> { canon, matched keys }
    const byCanon = new Map<string, { canon: Co; keys: string[] }>()
    for (const k of bKeys) {
      const hit = index.get(k)
      if (hit && hit !== "AMBIGUOUS" && hit.id !== b.id) {
        const e = byCanon.get(hit.id) ?? { canon: hit, keys: [] }
        e.keys.push(k)
        byCanon.set(hit.id, e)
      }
    }
    if (byCanon.size !== 1) continue // 0 hits, or matches >1 distinct canonical => skip
    const { canon, keys: shared } = [...byCanon.values()][0]!
    // Ambiguity guard: if every shared key is a common dictionary word and the
    // full names don't match, the blank could be a different same-word company.
    if (bName !== normalizeName(canon.name) && shared.every((k) => DICT.has(k))) continue
    pairs.push({ blank: b, canon })
  }

  // Active-job counts for the blanks in pairs (bounded set).
  const blankIds = pairs.map((p) => p.blank.id)
  const jobCount = new Map<string, number>()
  if (blankIds.length) {
    const { rows } = await pool.query<{ company_id: string; n: string }>(
      `SELECT company_id, count(*) n FROM jobs WHERE company_id = ANY($1) AND is_active = true GROUP BY company_id`,
      [blankIds]
    )
    for (const r of rows) jobCount.set(r.company_id, Number(r.n))
  }

  let selected = pairs
    .map((p) => ({ ...p, jobs: jobCount.get(p.blank.id) ?? 0 }))
    .filter((p) => p.jobs >= MIN_JOBS)
    .sort((a, b) => b.jobs - a.jobs)
  if (LIMIT > 0) selected = selected.slice(0, LIMIT)

  console.log(`\ncanonical rows: ${canon.length} | blank rows: ${blanks.length}`)
  console.log(`proposed merges (jobs>=${MIN_JOBS}): ${selected.length} | ${DRY_RUN ? "DRY RUN" : "APPLYING"}\n`)
  for (const p of selected.slice(0, 60)) {
    console.log(`  ${String(p.jobs).padStart(5)}  ${p.blank.name} [${p.blank.domain.slice(0, 34)}]  ->  ${p.canon.name} [${p.canon.domain}]`)
  }
  if (selected.length > 60) console.log(`  … +${selected.length - 60} more`)
  const totalJobs = selected.reduce((s, p) => s + p.jobs, 0)
  console.log(`\ntotal active jobs to consolidate: ${totalJobs}`)

  if (DRY_RUN) { await pool.end(); return }

  let done = 0
  for (const p of selected) {
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(`UPDATE companies SET is_active=true WHERE id=$1 AND is_active=false`, [p.canon.id])
      await client.query(
        `UPDATE jobs j SET company_id=$1 WHERE j.company_id=$2
           AND NOT EXISTS (SELECT 1 FROM jobs k WHERE k.company_id=$1 AND k.external_id=j.external_id)`,
        [p.canon.id, p.blank.id]
      )
      await client.query(`UPDATE jobs SET is_active=false WHERE company_id=$1 AND is_active=true`, [p.blank.id])
      await client.query(`UPDATE companies SET is_active=false WHERE id=$1`, [p.blank.id])
      await client.query("COMMIT")
      done++
      if (done % 100 === 0) console.log(`  merged ${done}/${selected.length}`)
    } catch (err) {
      await client.query("ROLLBACK")
      console.log(`  ✗ ${p.blank.name} -> ${p.canon.name}: ${(err as Error).message}`)
    } finally {
      client.release()
    }
  }
  console.log(`\nmerged ${done}/${selected.length}`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })

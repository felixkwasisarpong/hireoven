/**
 * Enrich companies with E-Verify enrollment status by querying the USCIS E-Verify
 * Employer Search (a Tableau dashboard — see lib/everify/tableau-lookup.ts). USCIS
 * removed the bulk download, so this is the only authoritative, daily-refreshed source.
 *
 * For each scoped company we search its name, then accept ONLY an exact normalized-name
 * match (against the employer name or its DBA) whose account status is "Open". This is
 * deliberately conservative: a false E-Verify flag can harm a student's STEM OPT case,
 * so we under-match rather than over-match (same stance as lib/everify/import.ts).
 *
 * Matches are written to the e_verify_employers staging table and flip
 * companies.is_e_verify (the e-verify page reads is_e_verify = true).
 *
 * Read-only by default; pass --apply to write.
 *
 *   npx tsx scripts/enrich-everify.ts                  # dry run, top 50 by H1B sponsorship
 *   npx tsx scripts/enrich-everify.ts --limit=500
 *   npx tsx scripts/enrich-everify.ts --headful        # watch the browser
 *   npx tsx scripts/enrich-everify.ts --apply --limit=500
 *
 * Politeness: this hammers a .gov UI one query at a time (~10s/company). Keep
 * concurrency at 1 and run it on the harvester box, not the web box.
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { getPostgresPool } from "@/lib/postgres/server"
import { normalizeEmployerName } from "@/lib/h1b/normalize-employer"
import { EverifyTableauLookup, type EverifySearchHit } from "@/lib/everify/tableau-lookup"

const APPLY = process.argv.includes("--apply")
const HEADFUL = process.argv.includes("--headful")
const CACHE_PATH = path.join(process.cwd(), ".cache", "enrich-everify.json")

function flagInt(name: string, fallback: number): number {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  if (!a) return fallback
  const n = Number.parseInt(a.split("=")[1], 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const LIMIT = flagInt("limit", 50)
const SETTLE_MS = flagInt("settle", 7000)
// The USCIS Tableau session goes stale after ~an hour (~360 queries), after which
// every lookup fails. Proactively recycle the browser well before that.
const RECYCLE_EVERY = flagInt("recycle", 150)

type Company = { id: string; name: string }
type Cache = Record<string, { matched: boolean; everifyName?: string; state?: string | null; at: string }>

function loadCache(): Cache {
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) } catch { return {} }
}
function saveCache(c: Cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
  fs.writeFileSync(CACHE_PATH, JSON.stringify(c, null, 2))
}

const isOpen = (status: string | null) => !!status && /open/i.test(status) && !/terminat/i.test(status)

/** Exact normalized-name match against employer name or DBA, account status Open. */
function pickMatch(companyName: string, hits: EverifySearchHit[]): EverifySearchHit | null {
  const target = normalizeEmployerName(companyName)
  if (!target) return null
  for (const h of hits) {
    if (!isOpen(h.account_status)) continue
    const cands = [h.employer_name, h.doing_business_as].filter(Boolean) as string[]
    if (cands.some((c) => normalizeEmployerName(c) === target)) return h
  }
  return null
}

function synthEverifyId(name: string, state: string | null): string {
  return "live_" + createHash("sha1").update(`${name}|${state ?? ""}`.toLowerCase()).digest("hex").slice(0, 20)
}

async function main() {
  const pool = getPostgresPool()
  // Scope to top H1B sponsors via the precomputed leaderboard MV (rank_volume is
  // indexed there). This is web-box-safe — it avoids an unindexed sort of the full
  // companies table — and matches the set the e-verify page surfaces. The PK join
  // skips companies already flagged. Widen later if we want non-sponsor coverage.
  const { rows: companies } = await pool.query<Company>(
    `SELECT mv.company_id AS id, mv.company_name AS name
     FROM h1b_leaderboard_mv mv
     JOIN companies c ON c.id = mv.company_id
     WHERE c.is_active = true AND c.is_e_verify = false
       AND mv.company_name IS NOT NULL AND mv.company_name <> ''
     ORDER BY mv.rank_volume ASC
     LIMIT $1`,
    [LIMIT]
  )
  console.log(`[everify] ${companies.length} companies to check (limit ${LIMIT}); apply=${APPLY}`)
  if (companies.length === 0) return

  const cache = loadCache()
  const lookup = new EverifyTableauLookup({ headless: !HEADFUL, searchSettleMs: SETTLE_MS })
  console.log("[everify] launching browser + loading dashboard…")
  await lookup.init()
  console.log("[everify] dashboard ready (Date Enrolled = Last 30 years)\n")

  let checked = 0
  let matched = 0
  let flipped = 0
  try {
    for (const c of companies) {
      checked++

      // Proactively recycle the session before it can go stale.
      if (checked > 1 && checked % RECYCLE_EVERY === 0) {
        console.log(`  … recycling browser session (after ${checked})`)
        try { await lookup.reinit() } catch (e) { console.warn("  ! reinit failed:", e instanceof Error ? e.message : e) }
      }

      let hit: EverifySearchHit | null = null
      try {
        // One reinit-and-retry on failure — covers a session that died early.
        let res
        try {
          res = await lookup.search(c.name)
        } catch (firstErr) {
          console.warn(`  ↻ ${c.name}: ${firstErr instanceof Error ? firstErr.message : firstErr} — reinit + retry`)
          await lookup.reinit()
          res = await lookup.search(c.name)
        }
        hit = pickMatch(c.name, res.hits)
        cache[c.id] = { matched: !!hit, everifyName: hit?.employer_name, state: hit?.state ?? null, at: new Date().toISOString() }
      } catch (err) {
        console.warn(`  ! ${c.name}: lookup failed — ${err instanceof Error ? err.message : err}`)
        continue
      }
      if (!hit) {
        console.log(`  · ${c.name} — no E-Verify match`)
        continue
      }
      matched++
      console.log(`  ✓ ${c.name} → "${hit.employer_name}" [${hit.account_status}/${hit.state ?? "?"}]`)
      if (!APPLY) continue

      const eid = synthEverifyId(hit.employer_name, hit.state)
      await pool.query(
        `INSERT INTO e_verify_employers
           (e_verify_id, employer_name, employer_name_norm, city, state, zip, industry_naics, status, matched_company_id)
         VALUES ($1,$2,$3,NULL,$4,NULL,NULL,'enrolled',$5)
         ON CONFLICT (e_verify_id) DO UPDATE SET
           employer_name = EXCLUDED.employer_name,
           employer_name_norm = EXCLUDED.employer_name_norm,
           state = EXCLUDED.state, status = 'enrolled',
           matched_company_id = EXCLUDED.matched_company_id, imported_at = NOW()`,
        [eid, hit.employer_name, normalizeEmployerName(hit.employer_name), hit.state, c.id]
      )
      const upd = await pool.query(
        `UPDATE companies
         SET is_e_verify = true, e_verify_company_id = $2, e_verify_status = 'enrolled', e_verify_synced_at = NOW()
         WHERE id = $1 AND is_e_verify = false`,
        [c.id, eid]
      )
      flipped += upd.rowCount ?? 0
    }
  } finally {
    await lookup.close()
    saveCache(cache)
  }

  console.log(`\n[everify] checked ${checked} · matched ${matched}` + (APPLY ? ` · flipped ${flipped}` : " · DRY RUN (no writes)"))
  if (!APPLY && matched > 0) console.log("[everify] re-run with --apply to write these.")
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })

/**
 * Backfill logos for Adzuna placeholder companies.
 *
 * The Adzuna ingest (`app/api/cron/adzuna-ingest/route.ts`) creates a company
 * row for every unknown employer with a synthetic `adzuna-<slug>.placeholder`
 * domain and NO `logo_url`. Because the domain isn't real, `CompanyLogo` has
 * nothing to resolve and renders a bare initial-letter chip. These rows are
 * very fresh and very numerous, so they dominate the "Best Match" candidate
 * pool — which is why most cards there show no logo.
 *
 * This script recovers a real brand mark WITHOUT touching the placeholder
 * `domain` (a UNIQUE column other flows — ATS discovery, dedup — key on). It
 * only writes `companies.logo_url`, which `CompanyLogo` renders directly:
 *
 *   1. Guess a public domain from the company name (`guessPublicDomain`).
 *   2. Precision guard: skip generic single-word guesses that resolve to an
 *      unrelated brand (e.g. "Climate Systems Inc" → climate.com). Multi-word
 *      brand names are kept; single-word names must be long + non-generic.
 *   3. Verify logo.dev actually HAS a real logo for that domain via
 *      `?fallback=404` (a 200 means a real mark, 404 means it would only serve
 *      a generic monogram — which we skip so we don't store junk).
 *   4. On hit: set `logo_url` and record provenance in
 *      `raw_ats_config.logo_backfill` so the write is auditable / reversible.
 *
 * Idempotent: only touches rows where `logo_url IS NULL`. Re-runnable.
 *
 * Requires: DATABASE_URL (Postgres), NEXT_PUBLIC_LOGO_DEV_TOKEN (or
 *           LOGO_DEV_TOKEN) in .env.local
 *
 * Usage:
 *   npx tsx scripts/backfill-adzuna-placeholder-logos.ts                # dry run
 *   npx tsx scripts/backfill-adzuna-placeholder-logos.ts --execute      # commit
 *   npx tsx scripts/backfill-adzuna-placeholder-logos.ts --limit=500 --execute
 *   npx tsx scripts/backfill-adzuna-placeholder-logos.ts --concurrency=24 --execute
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { guessPublicDomain } from "../lib/companies/placeholder-from-employer"
import { companyLogoUrlFromDomain } from "../lib/companies/logo-url"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  return direct ? direct.slice(prefix.length) : undefined
}

const execute = process.argv.includes("--execute")
const limit = Number(flag("limit") ?? "0") || Infinity
const concurrency = Math.max(1, Number(flag("concurrency") ?? "20") || 20)

const LOGO_DEV_TOKEN =
  process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN || process.env.LOGO_DEV_TOKEN || ""

// Generic single words that frequently resolve to an unrelated brand on
// logo.dev. A single-word guess matching one of these is skipped — the risk of
// attaching the wrong logo outweighs the gain. (Multi-word names are distinct
// enough to trust.)
const GENERIC_SINGLE_WORDS = new Set([
  "climate", "shelter", "integer", "summit", "legacy", "apex", "vertex",
  "horizon", "pinnacle", "premier", "elite", "global", "national", "general",
  "capital", "alliance", "advantage", "synergy", "momentum", "catalyst",
  "frontier", "liberty", "freedom", "unity", "fusion", "nexus", "vector",
  "matrix", "quantum", "spectrum", "summit", "compass", "beacon", "anchor",
  "bridge", "gateway", "keystone", "cornerstone", "foundation", "heritage",
  "century", "empire", "kingdom", "dynasty", "phoenix", "titan", "atlas",
  "orion", "sentinel", "guardian", "paramount", "supreme", "prime", "core",
])

// Pure legal/structural words — stripped before counting the name's
// *meaningful* words. Descriptive words (technology, group, holdings, systems,
// services, solutions…) are deliberately NOT here: when the brand is e.g.
// "Systems Engineering" or "The Wolverine Group", those descriptors are what
// distinguish it, and dropping them is exactly the failure we want to catch.
const LEGAL_TOKENS = new Set([
  "the", "inc", "incorporated", "llc", "llp", "corp", "corporation",
  "co", "company", "companies", "ltd", "limited", "plc", "and", "of", "lp",
])

function meaningfulTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t && !LEGAL_TOKENS.has(t))
}

/**
 * Whether a guessed domain is distinctive enough to trust.
 *
 * The dangerous case is a multi-word brand collapsing to a single generic word
 * because `guessPublicDomain` stripped the distinctive half — e.g.
 * "Systems Engineering" → engineering.com, "Priority Technology Holdings" →
 * priority.com, "The Wolverine Group" → wolverine.com. Signature: the domain
 * stem is exactly ONE of the name's meaningful words while the name had ≥2.
 * Multi-word *concatenations* (goldman+sachs) and genuine single-word brands
 * (fairphone) are kept.
 */
function isDistinctiveGuess(name: string, domain: string): boolean {
  const stem = domain.replace(/\.com$/, "")
  const tokens = meaningfulTokens(name)
  if (tokens.length === 0) return false

  // Multi-word name collapsed to a single one of its words → distinctive part
  // was dropped. Reject.
  if (tokens.length >= 2 && tokens.includes(stem)) return false

  // Genuine single-word brand: require a reasonable length and a non-generic
  // word (generic single words resolve to unrelated brands on logo.dev).
  if (tokens.length === 1) {
    if (stem.length < 5) return false
    if (GENERIC_SINGLE_WORDS.has(stem)) return false
  }

  return true
}

async function logoDevHasRealLogo(domain: string): Promise<boolean> {
  if (!LOGO_DEV_TOKEN) return false
  try {
    const res = await fetch(
      `https://img.logo.dev/${encodeURIComponent(domain)}?token=${LOGO_DEV_TOKEN}&size=128&format=png&fallback=404`,
      { redirect: "follow" }
    )
    return res.status === 200
  } catch {
    return false
  }
}

type Row = {
  id: string
  name: string
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000"

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) {
    console.error("Missing DATABASE_URL in env")
    process.exit(1)
  }
  if (!LOGO_DEV_TOKEN) {
    console.error("Missing NEXT_PUBLIC_LOGO_DEV_TOKEN / LOGO_DEV_TOKEN — cannot verify logos")
    process.exit(1)
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  })

  let cursor = ZERO_UUID
  let scanned = 0
  let noGuess = 0
  let notDistinctive = 0
  let noRealLogo = 0
  let updated = 0
  const PAGE = 500

  console.log(
    `${execute ? "EXECUTE" : "DRY-RUN"} — backfilling logo_url for adzuna-*.placeholder companies (logo_url IS NULL)\n`
  )

  while (scanned < limit) {
    const { rows } = await pool.query<Row>(
      `SELECT id, name
       FROM companies
       WHERE domain LIKE 'adzuna-%.placeholder'
         AND logo_url IS NULL
         AND id > $1::uuid
       ORDER BY id ASC
       LIMIT $2`,
      [cursor, PAGE]
    )
    if (rows.length === 0) break

    // Resolve guesses up front, then verify with bounded concurrency.
    const candidates = rows
      .map((row) => {
        scanned++
        cursor = row.id
        const domain = guessPublicDomain(row.name)
        if (!domain) {
          noGuess++
          return null
        }
        if (!isDistinctiveGuess(row.name, domain)) {
          notDistinctive++
          return null
        }
        return { row, domain }
      })
      .filter((c): c is { row: Row; domain: string } => c !== null)

    for (let i = 0; i < candidates.length; i += concurrency) {
      const batch = candidates.slice(i, i + concurrency)
      const oks = await Promise.all(batch.map((c) => logoDevHasRealLogo(c.domain)))
      for (let j = 0; j < batch.length; j++) {
        const { row, domain } = batch[j]
        if (!oks[j]) {
          noRealLogo++
          continue
        }
        const logoUrl = companyLogoUrlFromDomain(domain)
        if (!logoUrl) {
          noRealLogo++
          continue
        }
        updated++
        if (updated <= 60) console.log(`  ✓ ${row.name}  →  ${domain}`)
        if (execute) {
          const provenance = {
            source: "adzuna_name_guess",
            guessed_domain: domain,
            verified_at: new Date().toISOString(),
          }
          try {
            await pool.query(
              `UPDATE companies
               SET logo_url = $1,
                   raw_ats_config = COALESCE(raw_ats_config, '{}'::jsonb)
                                    || jsonb_build_object('logo_backfill', $2::jsonb),
                   updated_at = now()
               WHERE id = $3`,
              [logoUrl, JSON.stringify(provenance), row.id]
            )
          } catch (uErr) {
            console.error(`  FAILED ${row.name}: ${(uErr as Error).message}`)
            updated--
          }
        }
      }
    }

    if (rows.length < PAGE) break
  }

  await pool.end()

  console.log(
    `\nDone (${execute ? "committed" : "dry-run"}).\n` +
      `  scanned:          ${scanned}\n` +
      `  no domain guess:  ${noGuess}\n` +
      `  not distinctive:  ${notDistinctive}\n` +
      `  no real logo:     ${noRealLogo}\n` +
      `  ${execute ? "updated" : "would update"}: ${updated}`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * Cleans up the "already enrolled elsewhere" conflicts surfaced by
 * reclassify-custom-companies.ts: a 'custom'-tagged company record with a
 * real, good-looking domain (from company enrichment) whose real ATS turns
 * out to already be enrolled under a DIFFERENT company row — usually one
 * auto-discovered with a placeholder domain (e.g. `acme.bamboohr-discovered`)
 * that's actually the one doing the real, working harvesting.
 *
 * Same pattern fixed by hand for American Express and Cantor Fitzgerald this
 * session: the working row (by ats_type+ats_identifier) is kept as canonical;
 * if its domain is a placeholder pattern, the loser's real domain/logo/
 * industry/size are moved onto it (freeing the domain first to respect
 * companies_domain_key). The loser is always marked dead + duplicate_of,
 * never deleted, never touches jobs directly.
 *
 * Finds candidates itself (any active 'custom' row whose careers_url/
 * direct_ats_url resolves via detectAdapter to an (ats_type, ats_identifier)
 * pair that's already owned by a different active row) — no need to re-run
 * reclassify-custom-companies.ts first.
 *
 * Usage:
 *   npx tsx scripts/merge-reclassified-duplicates.ts             # dry-run
 *   npx tsx scripts/merge-reclassified-duplicates.ts --limit=500
 *   npx tsx scripts/merge-reclassified-duplicates.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

const EXECUTE = process.argv.includes("--execute")
const LIMIT = Number.parseInt(flag("limit") ?? "", 10) || 2000
const CONCURRENCY = Math.max(1, Number.parseInt(flag("concurrency") ?? "", 10) || 20)
const FETCH_TIMEOUT_MS = 9000

const HREF_RE = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi
const BARE_URL_RE = /https?:\/\/[^\s"'<>)]+/gi
const ASSET_EXTENSION_RE = /\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|json)(\?|#|$)/i
// "-discovered" and "-tenant" are both auto-discovery domain-slug conventions
// used interchangeably across different discovery scripts (e.g.
// "microsoftc1.smartrecruiters-tenant", "nauto.greenhouse-discovered") — no
// real company would ever end up with either as their actual domain.
const PLACEHOLDER_DOMAIN_RE = /placeholder|discovered$|-tenant$|^adzuna-|^dice-|^builtin-|^workable-/i

// Some ATS platforms have a shared demo/marketing tenant that isn't specific
// to any one customer (e.g. Gem's own jobs.gem.com/gem board). A slug that's
// literally identical to its own ats_type ("gem"/"gem", "google"/"google" is
// fine since that's a real single-tenant adapter, but a GENERIC-looking combo
// discovered independently across unrelated companies is a red flag) gets
// excluded rather than risk conflating unrelated companies into one shared,
// non-company-specific tenant.
const SELF_REFERENTIAL_SLUG_ATS_TYPES = new Set(["gem"])

type CompanyRow = {
  id: string
  name: string
  domain: string
  logo_url: string | null
  industry: string | null
  size: string | null
  careers_url: string | null
  direct_ats_url: string | null
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function extractCandidateUrls(html: string, baseUrl: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(HREF_RE)) {
    if (ASSET_EXTENSION_RE.test(m[1])) continue
    try {
      found.add(new URL(m[1], baseUrl).toString())
    } catch {
      /* ignore */
    }
  }
  for (const m of html.matchAll(BARE_URL_RE)) {
    if (ASSET_EXTENSION_RE.test(m[0])) continue
    found.add(m[0])
  }
  return [...found]
}

type Candidate = { loser: CompanyRow; atsType: string; slug: string }

async function findCandidate(company: CompanyRow): Promise<Candidate | null> {
  const targetUrl = company.direct_ats_url?.trim() || company.careers_url?.trim()
  if (!targetUrl) return null
  const html = await fetchHtml(targetUrl)
  if (!html) return null

  const candidates = extractCandidateUrls(html, targetUrl)
  const matches = new Map<string, { atsType: string; slug: string }>()
  for (const url of candidates) {
    const detection = detectAdapter(url)
    if (!detection) continue
    if (!matches.has(detection.adapter.name)) {
      matches.set(detection.adapter.name, { atsType: detection.adapter.name, slug: detection.slug })
    }
  }
  if (matches.size !== 1) return null
  const only = [...matches.values()][0]
  if (SELF_REFERENTIAL_SLUG_ATS_TYPES.has(only.atsType) && only.slug === only.atsType) return null
  return { loser: company, atsType: only.atsType, slug: only.slug }
}

async function main() {
  const pool = getPostgresPool()
  const { rows } = await pool.query<CompanyRow>(
    `SELECT id, name, domain, logo_url, industry, size, careers_url, direct_ats_url
       FROM companies
      WHERE status = 'active' AND is_active = true
        AND ats_type = 'custom'
        AND careers_url IS NOT NULL
      ORDER BY job_count DESC NULLS LAST
      LIMIT $1`,
    [LIMIT]
  )
  console.log(`scanning ${rows.length} 'custom' companies for already-enrolled-elsewhere duplicates`)

  const limiter = pLimit(CONCURRENCY)
  let done = 0
  const startedAt = Date.now()
  const candidateResults = await Promise.all(
    rows.map((c) =>
      limiter(async () => {
        const r = await findCandidate(c)
        done += 1
        if (done % 100 === 0 || done === rows.length) {
          console.log(`  progress: ${done}/${rows.length} (${Math.round((Date.now() - startedAt) / 1000)}s elapsed)`)
        }
        return r
      })
    )
  )
  const candidates = candidateResults.filter((c): c is Candidate => c !== null)
  console.log(`found ${candidates.length} candidates with a single detectable ATS match`)

  const pairs: Array<{ winner: CompanyRow; loser: CompanyRow; atsType: string; slug: string }> = []
  for (const c of candidates) {
    const { rows: winnerRows } = await pool.query<CompanyRow>(
      `SELECT id, name, domain, logo_url, industry, size, careers_url, direct_ats_url
         FROM companies
        WHERE ats_type = $1 AND ats_identifier = $2 AND status = 'active' AND is_active = true AND id != $3`,
      [c.atsType, c.slug, c.loser.id]
    )
    const winner = winnerRows[0]
    if (winner) pairs.push({ winner, loser: c.loser, atsType: c.atsType, slug: c.slug })
  }

  // Only auto-merge when the winner has NO real identity of its own (a bare
  // auto-discovery placeholder) — the exact American Express / Cantor
  // Fitzgerald pattern. When the winner already has its own real domain, a
  // shared (ats_type, ats_identifier) can legitimately mean two DIFFERENT
  // companies/brands sharing one recruiting portal (found live: "KTVB" — an
  // Idaho TV station — detected the same Greenhouse board as "WGRZ", a
  // Buffalo station; both are Tegna-owned stations with distinct identities,
  // not duplicates of each other). Auto-merging those would silently erase a
  // real, distinct company. This bucket is reported only, never written.
  const safePairs = pairs.filter((p) => PLACEHOLDER_DOMAIN_RE.test(p.winner.domain))
  const reviewPairs = pairs.filter((p) => !PLACEHOLDER_DOMAIN_RE.test(p.winner.domain))

  console.log(`\n${pairs.length} confirmed duplicate pairs (already enrolled under a different id):`)
  console.log(`  ${safePairs.length} safe to auto-merge (winner is a bare placeholder identity)`)
  console.log(`  ${reviewPairs.length} need manual review (winner already has its own real domain — could be a legitimate distinct brand sharing a portal)\n`)

  for (const p of safePairs.slice(0, 40)) {
    console.log(`  [auto-merge] ${p.loser.name.slice(0, 35).padEnd(35)} loser=${p.loser.domain.slice(0, 30).padEnd(30)} winner=${p.winner.domain.slice(0, 30)}`)
  }
  if (safePairs.length > 40) console.log(`  ... and ${safePairs.length - 40} more`)

  console.log("\nneeds manual review (not auto-merged, ever):")
  for (const p of reviewPairs) {
    console.log(`  [review]     ${p.loser.name.slice(0, 35).padEnd(35)} loser=${p.loser.domain.slice(0, 30).padEnd(30)} winner=${p.winner.name} (${p.winner.domain})`)
  }

  if (!EXECUTE) {
    console.log("\ndry-run — pass --execute to merge the auto-merge-safe pairs only.")
    await pool.end()
    return
  }

  let merged = 0
  let upgraded = 0
  for (const p of safePairs) {
    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      // Free the real domain from the loser first (companies_domain_key).
      await client.query(
        `UPDATE companies SET domain = $2, updated_at = now() WHERE id = $1`,
        [p.loser.id, `${p.loser.domain}.dead-placeholder`]
      )
      await client.query(
        `UPDATE companies
            SET domain = $2,
                logo_url = COALESCE(NULLIF($3, ''), logo_url),
                industry = COALESCE(industry, $4),
                size = COALESCE(size, $5),
                updated_at = now()
          WHERE id = $1`,
        [p.winner.id, p.loser.domain, p.loser.logo_url ?? "", p.loser.industry, p.loser.size]
      )
      upgraded += 1

      await client.query(
        `UPDATE companies
            SET is_active = false,
                status = 'dead',
                duplicate_of_company_id = $2,
                notes = COALESCE(notes || E'\n', '') || $3,
                updated_at = now()
          WHERE id = $1`,
        [
          p.loser.id,
          p.winner.id,
          `${new Date().toISOString().slice(0, 10)}: merged into canonical ${p.atsType}:${p.slug} record (id ${p.winner.id}) — was ats_type='custom', real ATS already enrolled elsewhere`,
        ]
      )
      await client.query("COMMIT")
      merged += 1
    } catch (e) {
      await client.query("ROLLBACK")
      console.error(`  failed to merge ${p.loser.name}: ${(e as Error).message}`)
    } finally {
      client.release()
    }
  }
  console.log(`\ndone. merged ${merged}/${safePairs.length} duplicate pairs (${upgraded} winner rows upgraded to the real domain/logo). ${reviewPairs.length} left untouched for manual review.`)
  await pool.end()
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

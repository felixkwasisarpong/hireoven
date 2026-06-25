/**
 * Repair wrong/synthetic company domains that surface as broken logos on the
 * public H-1B sponsor leaderboard.
 *
 * Background
 * ──────────
 * Leaderboard rows read `companies.domain` + `companies.logo_url` straight from
 * the `companies` table (via `h1b_leaderboard_mv`). Many H-1B employers were
 * created with a domain *synthesized from their legal name* by a historical
 * generator that:
 *   • mangled names by slicing "co"/"corp" mid-word
 *     ("Company"→"mpany", "Corporation"→"oration", "Coupang"→"upang"), and
 *   • guessed a `.com` for universities/hospitals whose real mark is `.edu`/`.org`.
 * The stored `logo_url` is a logo.dev URL built on that bad domain, so logo.dev
 * returns junk or an unrelated brand's mark.
 *
 * What this does
 * ──────────────
 * For each leaderboard company whose domain looks synthetic, it generates
 * candidate domains (curated brand map → .edu/.org → boundary-correct .com),
 * HTTP-probes them, and:
 *   • adopts the first that resolves (updating domain when free + logo_url), or
 *   • nulls `logo_url` when nothing verifies, so the UI renders a clean
 *     letter-tile avatar instead of a wrong-brand logo.
 * Finally it refreshes the leaderboard materialized view.
 *
 * Usage
 * ─────
 *   npx tsx scripts/fix-h1b-leaderboard-domains.ts --dry-run            # preview, no writes
 *   npx tsx scripts/fix-h1b-leaderboard-domains.ts --dry-run --limit=50
 *   npx tsx scripts/fix-h1b-leaderboard-domains.ts                      # apply + refresh MV
 *   npx tsx scripts/fix-h1b-leaderboard-domains.ts --no-refresh         # apply, skip MV refresh
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { domainCandidates, isSyntheticDomain } from "../lib/companies/institution-domains"
import { companyLogoUrlFromDomain } from "../lib/companies/logo-url"

loadEnvConfig(process.cwd())

// ─── CLI flags ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const DRY_RUN = argv.includes("--dry-run")
const NO_REFRESH = argv.includes("--no-refresh")
const limitArg = argv.find((a) => a.startsWith("--limit="))
const concArg = argv.find((a) => a.startsWith("--concurrency="))
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 0
const CONCURRENCY = Math.max(1, Math.min(16, Number(concArg?.split("=")[1] ?? "8")))
const PROBE_TIMEOUT_MS = 6_000
const LOGO_TOKEN = process.env.LOGO_DEV_TOKEN ?? process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ?? ""

// ─── Domain probe ──────────────────────────────────────────────────────────────
const ATS_HOST_RE =
  /\.(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com|workday\.com|icims\.com|jobvite\.com|taleo\.net|bamboohr\.com|workable\.com)$/i
const PLACEHOLDER_RE =
  /\.(uscis-employer|lca-employer|[a-z]+-discovered|placeholder|ats-placeholder)$/i

function bareDomain(domain: string): string {
  return domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!
}

async function probeDomain(domain: string): Promise<boolean> {
  for (const url of [`https://${domain}`, `https://www.${domain}`]) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Hireoven/1.0)" },
      })
      clearTimeout(timer)
      if (res.status < 500) {
        const finalHost = new URL(res.url ?? url).hostname
        if (ATS_HOST_RE.test(finalHost)) return false // landed on an ATS page, not a brand site
        return true
      }
    } catch {
      // timeout / DNS fail — try the next URL
    }
  }
  return false
}

async function resolveDomain(name: string): Promise<string | null> {
  for (const candidate of domainCandidates(name)) {
    if (await probeDomain(candidate)) return candidate
  }
  return null
}

function logoUrlFor(domain: string): string {
  // Use the app's canonical resolver so curated local SVGs (e.g.
  // /company-logos/capital-one.svg) win over a generic logo.dev URL, and brand
  // overrides are honored — never hardcode an img.logo.dev URL here.
  return companyLogoUrlFromDomain(domain, "logo-dev")
}

// ─── Concurrency helper ─────────────────────────────────────────────────────────
async function pMap<T, R>(items: T[], fn: (item: T, idx: number) => Promise<R>, concurrency: number) {
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
}

// ─── Main ────────────────────────────────────────────────────────────────────────
type Row = { id: string; name: string; domain: string | null; logo_url: string | null }

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  // Scope to the public leaderboard set only — bounded and indexed (PK join),
  // so we never trip a heavy full-table scan on the memory-constrained box.
  const { rows } = await pool.query<Row>(`
    SELECT c.id, c.name, c.domain, c.logo_url
    FROM h1b_leaderboard_mv mv
    JOIN companies c ON c.id = mv.company_id
    ORDER BY mv.rank_volume ASC
    ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ""}
  `)

  const targets = rows.filter((r) => isSyntheticDomain(r.name, r.domain))
  console.log(`\nLeaderboard companies scanned : ${rows.length}`)
  console.log(`Synthetic / suspect domains    : ${targets.length}`)
  console.log(`Mode                           : ${DRY_RUN ? "DRY RUN (no writes)" : "APPLY"}`)
  console.log(`Concurrency                    : ${CONCURRENCY}\n`)

  if (!DRY_RUN && !LOGO_TOKEN) {
    throw new Error("LOGO_DEV_TOKEN or NEXT_PUBLIC_LOGO_DEV_TOKEN is required to rebuild logo URLs")
  }

  let fixedDomain = 0
  let loggedOnly = 0 // verified brand domain already taken → updated logo only
  let cleared = 0 // nothing verified → nulled logo so a clean letter-tile shows
  let keptLive = 0 // no better match, but stored domain is a live brand site → leave it
  let noop = 0 // re-verified the same domain it already had → nothing to write

  await pMap(
    targets,
    async (c, idx) => {
      const tag = `[${idx + 1}/${targets.length}]`
      const stored = c.domain ? bareDomain(c.domain) : ""
      const resolved = await resolveDomain(c.name)

      if (!resolved) {
        // No better domain verified. If the stored domain is itself a live,
        // non-institution brand site, leave it untouched rather than blank a
        // possibly-real logo. Only clear when it's dead/placeholder/ATS or a
        // university-on-.com (those resolve to parked pages with junk favicons).
        const junk =
          !stored ||
          PLACEHOLDER_RE.test(stored) ||
          ATS_HOST_RE.test(stored) ||
          (stored.endsWith(".com") && /\b(universit|college)\b/i.test(c.name))
        if (!junk && (await probeDomain(stored))) {
          keptLive++
          console.log(`${tag} ~ ${c.name}  kept ${stored} (live, no better match)`)
          return
        }
        const needsClear = c.logo_url != null && c.logo_url !== ""
        console.log(`${tag} ✗ ${c.name}  (no domain verified)${needsClear ? "  → clear logo" : ""}`)
        if (needsClear) {
          cleared++
          if (!DRY_RUN) {
            await pool.query(`UPDATE companies SET logo_url = NULL, updated_at = now() WHERE id = $1`, [c.id])
          }
        }
        return
      }

      const newLogo = logoUrlFor(resolved)

      // Re-verified the domain it already had (e.g. "raymondjames.com") and the
      // logo is unchanged — skip the write entirely.
      if (resolved === stored && c.logo_url === newLogo) {
        noop++
        return
      }

      console.log(`${tag} ✓ ${c.name}  ${c.domain ?? "—"} → ${resolved}`)

      if (DRY_RUN) {
        fixedDomain++
        return
      }

      try {
        // Adopt the verified domain only when no other company owns it (the
        // domain column is UNIQUE); otherwise keep our domain but still refresh
        // the logo, since several entities can legitimately share a brand mark.
        const res = await pool.query<{ adopted: boolean }>(
          `UPDATE companies SET
             logo_url = $2,
             domain = CASE
               WHEN NOT EXISTS (SELECT 1 FROM companies x WHERE x.domain = $1 AND x.id <> companies.id)
               THEN $1 ELSE companies.domain END,
             updated_at = now()
           WHERE id = $3
           RETURNING (domain = $1) AS adopted`,
          [resolved, newLogo, c.id]
        )
        if (res.rows[0]?.adopted) fixedDomain++
        else loggedOnly++
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "23505") {
          // Lost a race for the domain — still set the logo.
          await pool.query(`UPDATE companies SET logo_url = $1, updated_at = now() WHERE id = $2`, [newLogo, c.id])
          loggedOnly++
        } else {
          throw err
        }
      }
    },
    CONCURRENCY
  )

  console.log(`\n── Results ──────────────────────────────`)
  console.log(`  Domain + logo fixed : ${fixedDomain}`)
  console.log(`  Logo-only updated   : ${loggedOnly}`)
  console.log(`  Logo cleared        : ${cleared}`)
  console.log(`  Kept live (no better): ${keptLive}`)
  console.log(`  No-op (already ok)  : ${noop}`)

  if (!DRY_RUN && !NO_REFRESH) {
    console.log(`\nRefreshing h1b_leaderboard_mv …`)
    await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY h1b_leaderboard_mv")
    console.log(`  done.`)
  } else if (DRY_RUN) {
    console.log(`\n(dry run — no DB writes, MV not refreshed)`)
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

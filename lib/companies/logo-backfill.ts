/**
 * Unified company-logo backfill.
 *
 * Turns a domain we already know into a real logo. For every active company
 * that has a usable web domain — either a real `companies.domain` or a
 * `raw_ats_config.guessed_domain` resolved by the discovery pipeline — but no
 * stored `logo_url`, this derives the logo.dev URL, validates it actually
 * resolves to a real brand mark (logo.dev `fallback=404` → 200 only when a logo
 * exists, not the generated initials monogram), and stores it.
 *
 * Deliberately precision-first: it NEVER guesses a domain from the company name
 * (that is `discover-from-domains`' job, which also sets logos when it resolves).
 * This pass only converts already-known/resolved domains into logos, so it can't
 * attach a wrong brand to a company. It therefore complements, not duplicates,
 * the discovery crons and covers the gap they skip — companies that already hold
 * a real domain never otherwise get a logo pass.
 *
 * Used by the GET /api/cron/company-logos cron and runnable as a script.
 */

import type { Pool } from "pg"
import pLimit from "p-limit"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"
import { isAtsDomain } from "@/lib/companies/ats-domains"
import { nameTokens, domainMatchesName } from "@/lib/companies/domain-resolution"

// Synthetic domain suffixes the discovery pipeline uses as dedup keys — never a
// real website, so never a logo source.
const SYNTHETIC_DOMAIN_RE =
  /(\.(placeholder|signal|uscis-employer|lca-employer|glassdoor-discovery|builtin-discovery|ats-placeholder|sourced)|-discovered|\.discovered)$/i
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

/** A domain we can actually derive a logo from (real website, not ATS/synthetic). */
export function isResolvableLogoDomain(value: string | null | undefined): boolean {
  if (!value) return false
  const d = value.trim().toLowerCase()
  if (!BARE_DOMAIN_RE.test(d)) return false
  if (SYNTHETIC_DOMAIN_RE.test(d)) return false
  if (isAtsDomain(d)) return false
  return true
}

function logoDevToken(): string {
  const raw = (process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN || process.env.LOGO_DEV_TOKEN || "").trim()
  return raw.startsWith("pk_") ? raw : ""
}

/**
 * True when logo.dev actually has a real logo for this domain (not the generated
 * monogram). `fallback=404` makes logo.dev 404 instead of returning initials.
 */
async function logoDevHasRealLogo(domain: string, token: string, timeoutMs = 8000): Promise<boolean> {
  const url = `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(token)}&size=128&format=png&fallback=404`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal })
    return res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

type CandidateRow = {
  id: string
  name: string
  domain: string | null
  guessed_domain: string | null
}

export type LogoBackfillResult = {
  scanned: number
  updated: number
  noRealLogo: number
  noDomain: number
  nameMismatch: number
}

export async function backfillCompanyLogos(
  pool: Pool,
  opts: { limit?: number; concurrency?: number; execute?: boolean } = {}
): Promise<LogoBackfillResult> {
  const limit = Math.max(1, opts.limit ?? 300)
  const concurrency = Math.max(1, opts.concurrency ?? 6)
  const execute = opts.execute ?? false

  const token = logoDevToken()
  if (!token) {
    // Without a publishable token we can't validate real logos; bail safely.
    return { scanned: 0, updated: 0, noRealLogo: 0, noDomain: 0, nameMismatch: 0 }
  }

  // Indexed-friendly: filter to active rows missing a logo that have *some*
  // domain signal. Keep the batch bounded so the cron stays well under budget.
  // Only pull rows that actually carry a resolvable domain (real `domain` or a
  // resolved `guessed_domain`) so the batch isn't dominated by synthetic-key
  // rows we'd just skip. `SYN` matches the discovery dedup suffixes; ATS hosts
  // are excluded too. The JS `isResolvableLogoDomain` check below is the final
  // authority — this predicate just keeps the batch productive.
  const SYN = `'(\\.(placeholder|signal|uscis-employer|lca-employer|glassdoor-discovery|builtin-discovery|ats-placeholder|sourced)$|-discovered$|\\.discovered$)'`
  const ATS = `'\\.(bamboohr\\.com|myworkdayjobs\\.com|greenhouse\\.io|lever\\.co|ashbyhq\\.com|smartrecruiters\\.com|workable\\.com|recruitee\\.com|jobvite\\.com|rippling\\.com)$'`
  const { rows } = await pool.query<CandidateRow>(
    `SELECT id, name, domain, raw_ats_config->>'guessed_domain' AS guessed_domain
       FROM companies
      WHERE is_active = true
        AND status = 'active'
        AND duplicate_of_company_id IS NULL
        AND COALESCE(NULLIF(logo_url, ''), '') = ''
        AND (
          (raw_ats_config->>'guessed_domain') ~* '^[a-z0-9-]+\\.[a-z0-9.-]+$'
            AND (raw_ats_config->>'guessed_domain') !~* ${SYN}
          OR (
            domain ~* '^[a-z0-9-]+\\.[a-z0-9.-]+$'
            AND domain !~* ${SYN}
            AND domain !~* ${ATS}
          )
        )
      ORDER BY updated_at DESC NULLS LAST
      LIMIT $1`,
    [limit]
  )

  const limiter = pLimit(concurrency)
  let updated = 0
  let noRealLogo = 0
  let noDomain = 0
  let nameMismatch = 0

  await Promise.all(
    rows.map((row) =>
      limiter(async () => {
        const candidate = [row.domain, row.guessed_domain].find(isResolvableLogoDomain)
        if (!candidate) {
          noDomain += 1
          return
        }
        // Guard against legacy/wrong stored domains (e.g. "The Norfolk Companies"
        // pointing at pilotonline.com): the domain's own slug must carry a
        // distinctive token from the company name. Prevents painting an
        // unrelated brand's logo onto the company.
        const tokens = nameTokens(row.name)
        if (tokens.length && !domainMatchesName(candidate, tokens)) {
          nameMismatch += 1
          return
        }
        const has = await logoDevHasRealLogo(candidate, token)
        if (!has) {
          noRealLogo += 1
          return
        }
        const logoUrl = companyLogoUrlFromDomain(candidate)
        if (!logoUrl) {
          noRealLogo += 1
          return
        }
        if (execute) {
          await pool.query(
            `UPDATE companies SET logo_url = $1, updated_at = now()
              WHERE id = $2 AND COALESCE(NULLIF(logo_url, ''), '') = ''`,
            [logoUrl, row.id]
          )
        }
        updated += 1
      })
    )
  )

  return { scanned: rows.length, updated, noRealLogo, noDomain, nameMismatch }
}

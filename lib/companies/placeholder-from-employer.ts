/**
 * Single source of truth for creating `companies` rows from raw employer
 * names found in USCIS or DOL LCA imports.
 *
 * Deliberately NOT called from the importers themselves - they are pure
 * data loaders now and must not mutate the companies table. This module is
 * consumed exclusively by admin-triggered reconciliation flows:
 *
 *   - `scripts/reconcile-companies-from-imports.ts` (bulk, post-import)
 *   - `components/admin/AddCompanyModal.tsx` for one-offs (optional refactor
 *     target; the modal still owns its own UX but can reuse the helpers here
 *     if/when we consolidate).
 *
 * The placeholder row is intentionally inactive (`is_active = false`) so the
 * crawler ignores it until ATS discovery promotes it. It stores a sentinel
 * `domain` (`<slug>.lca-employer` / `<slug>.uscis-employer`) to guarantee
 * uniqueness without colliding with real company domains.
 */

import { getPostgresPool } from '@/lib/postgres/server'
import { companyLogoUrlFromDomain } from '@/lib/companies/logo-url'

export const PLACEHOLDER_DOMAIN_SUFFIX_LCA = 'lca-employer'
export const PLACEHOLDER_DOMAIN_SUFFIX_USCIS = 'uscis-employer'

export type PlaceholderSource = 'lca' | 'uscis'

export type EnsurePlaceholderInput = {
  displayName: string
  normalized: string
  source: PlaceholderSource
  /** Optional: callers that already loaded companies can pass their cache. */
  existingByNormalized?: Map<string, string>
}

export type EnsurePlaceholderResult = {
  companyId: string
  created: boolean
  guessedDomain: string | null
}

export function slugifyEmployer(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function guessPublicDomain(displayName: string): string | null {
  const stripped = displayName
    .toLowerCase()
    .replace(/\b(incorporated|inc|l\.?l\.?c\.?|llp|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|solutions|services|systems|us|usa|america|americas|north\s+america)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '')
  if (!stripped || stripped.length < 2) return null
  return `${stripped}.com`
}

function placeholderDomain(slug: string, source: PlaceholderSource): string {
  const suffix =
    source === 'uscis'
      ? PLACEHOLDER_DOMAIN_SUFFIX_USCIS
      : PLACEHOLDER_DOMAIN_SUFFIX_LCA
  return `${slug}.${suffix}`
}

export async function ensurePlaceholderCompany(
  { displayName, normalized, source, existingByNormalized }: EnsurePlaceholderInput
): Promise<EnsurePlaceholderResult | null> {
  const known = existingByNormalized?.get(normalized)
  if (known) return { companyId: known, created: false, guessedDomain: null }

  const slug = slugifyEmployer(displayName) || normalized.replace(/\s+/g, '-')
  if (!slug) return null

  const sentinelDomain = placeholderDomain(slug, source)
  const guessedDomain = guessPublicDomain(displayName)
  const careersUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(displayName)}`
  const logoUrl = guessedDomain ? companyLogoUrlFromDomain(guessedDomain) : null

  const raw_ats_config = {
    source: source === 'uscis' ? 'uscis_reconciliation' : 'lca_reconciliation',
    normalized,
    guessed_domain: guessedDomain,
    ats_discovery_status: 'pending',
    domain_verified: false,
    created_via: 'reconcile_companies_from_imports',
    created_at: new Date().toISOString(),
  }

  const pool = getPostgresPool()

  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, domain, careers_url, logo_url, is_active, ats_type, raw_ats_config)
       VALUES ($1, $2, $3, $4, false, NULL, $5::jsonb)
       RETURNING id`,
      [displayName.slice(0, 140), sentinelDomain, careersUrl, logoUrl, JSON.stringify(raw_ats_config)]
    )
    const id = result.rows[0]?.id ?? null
    if (id) {
      existingByNormalized?.set(normalized, id)
      return { companyId: id, created: true, guessedDomain }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/23505|duplicate|unique/i.test(msg)) {
      const found = await pool.query<{ id: string }>(
        `SELECT id FROM companies WHERE domain = $1 LIMIT 1`,
        [sentinelDomain]
      )
      const foundId = found.rows[0]?.id ?? null
      if (foundId) {
        existingByNormalized?.set(normalized, foundId)
        return { companyId: foundId, created: false, guessedDomain }
      }
    }
  }

  return null
}

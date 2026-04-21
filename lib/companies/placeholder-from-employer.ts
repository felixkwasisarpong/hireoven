/**
 * Single source of truth for creating `companies` rows from raw employer
 * names found in USCIS or DOL LCA imports.
 *
 * Deliberately NOT called from the importers themselves — they are pure
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

import type { SupabaseClient } from '@supabase/supabase-js'
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

/**
 * Best-effort guess at an employer's public domain. We store this in
 * `raw_ats_config.guessed_domain` so the enrichment pipeline has something
 * to try first; a favicon-based logo derives from it.
 *
 * We strip legal suffixes (inc, llc, corp, limited, ...) BEFORE slugifying
 * so "Infosys Limited" → "infosys.com" instead of "infosyslimited.com",
 * and "Google LLC" → "google.com" instead of "googlellc.com". This
 * dramatically improves the favicon-logo hit rate and gives the ATS
 * discovery pipeline a usable starting URL.
 */
export function guessPublicDomain(displayName: string): string | null {
  const stripped = displayName
    .toLowerCase()
    // drop common corporate suffixes, punctuation, and trailing "us" / "usa"
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

/**
 * Idempotent placeholder creator. Given a normalized employer name, either
 * returns the existing company id or inserts a new inactive row and returns
 * the new id. Callers should supply `existingByNormalized` when batching to
 * avoid round-trips.
 */
export async function ensurePlaceholderCompany(
  supabase: SupabaseClient,
  { displayName, normalized, source, existingByNormalized }: EnsurePlaceholderInput
): Promise<EnsurePlaceholderResult | null> {
  // Fast path: caller already knows this employer maps to an existing row.
  const known = existingByNormalized?.get(normalized)
  if (known) return { companyId: known, created: false, guessedDomain: null }

  const slug = slugifyEmployer(displayName) || normalized.replace(/\s+/g, '-')
  if (!slug) return null

  const sentinelDomain = placeholderDomain(slug, source)
  const guessedDomain = guessPublicDomain(displayName)
  const careersUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
    displayName
  )}`
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

  // Try insert; on unique-domain collision look up the existing row.
  const { data, error } = await (supabase.from('companies') as any)
    .insert({
      name: displayName.slice(0, 140),
      domain: sentinelDomain,
      careers_url: careersUrl,
      logo_url: logoUrl,
      is_active: false,
      ats_type: null,
      raw_ats_config,
    })
    .select('id')
    .single()

  if (data?.id) {
    existingByNormalized?.set(normalized, data.id)
    return { companyId: data.id, created: true, guessedDomain }
  }

  const err = error as { code?: string; message?: string } | null
  if (err && (err.code === '23505' || /duplicate/i.test(err.message ?? ''))) {
    const { data: found } = await supabase
      .from('companies')
      .select('id')
      .eq('domain', sentinelDomain)
      .maybeSingle()
    const foundId = (found as { id?: string } | null)?.id ?? null
    if (foundId) {
      existingByNormalized?.set(normalized, foundId)
      return { companyId: foundId, created: false, guessedDomain }
    }
  }

  return null
}

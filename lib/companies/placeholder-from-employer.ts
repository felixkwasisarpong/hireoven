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

/**
 * Convert raw employer/LCA names into a human display name.
 *
 * USCIS / DOL imports give us legal-entity names like "VISA TECHNOLOGY AND
 * OPERATIONS LLC" or "LOCKHEED MARTIN CORPORATION". Those are correct for
 * H-1B filings but ugly on the marketing surface — and they prevent Dice
 * placeholders from de-duping against the harvester-created row.
 *
 * Heuristic:
 *   1. Only mangle multi-word ALL-CAPS names (catches LCA-style entries,
 *      leaves "IBM", "BMW", "AT&T" alone).
 *   2. Title-case + strip common legal suffixes ("Visa Technology And
 *      Operations Llc" → "Visa Technology And Operations").
 *   3. If the result is still > 25 chars, fall back to the guessed-domain
 *      stem ("visa.com" → "Visa").
 *   4. Otherwise keep the title-cased form.
 */
const LEGAL_SUFFIX_RE =
  /[ ,]+(Inc|Llc|Llp|L\.l\.c|Corp|Corporation|Ltd|Limited|Co|Company|Plc|Holdings|Group|Technologies|Technology|Solutions|Services|Systems|Operations|Operating|Bank|Na|Usa|Us|America|Americas|North\s+America)\.?$/i

const TRAILING_CONNECTOR_RE = /[ ,]+(And|Or|Of|The|&)\.?$/i

/**
 * Tokens we treat as known acronyms — never sentence-cased.
 * Lowercased keys for the lookup; values are the canonical capitalisation.
 */
const KNOWN_ACRONYMS: Record<string, string> = {
  "at&t": "AT&T",
  "ibm": "IBM",
  "bmw": "BMW",
  "ge": "GE",
  "us": "US",
  "usa": "USA",
  "u.s.": "U.S.",
  "u.k.": "U.K.",
  "uk": "UK",
  "ai": "AI",
  "ml": "ML",
  "jp": "JP",
  "jpmorgan": "JPMorgan",
  "kpmg": "KPMG",
  "ey": "EY",
  "pwc": "PwC",
  "bp": "BP",
  "hp": "HP",
  "hpe": "HPE",
  "ups": "UPS",
  "ibm.": "IBM",
}

function titleCaseToken(token: string): string {
  const lower = token.toLowerCase()
  const known = KNOWN_ACRONYMS[lower]
  if (known) return known
  // Preserve ampersand-containing short forms like AT&T verbatim if input was all-caps
  if (/&/.test(token)) return token.toUpperCase()
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
}

export function humanizeCompanyName(
  rawName: string,
  guessedDomain: string | null
): string {
  const trimmed = rawName.trim()
  if (!trimmed) return trimmed

  const isAllCapsMultiWord =
    trimmed === trimmed.toUpperCase() &&
    /[A-Z]/.test(trimmed) &&
    /\s/.test(trimmed)

  if (!isAllCapsMultiWord) return trimmed

  // Title-case word-by-word with acronym awareness.
  let titled = trimmed.split(/\s+/).map(titleCaseToken).join(" ")

  // Strip trailing legal suffixes and connectors iteratively (handles
  // "OPERATIONS LLC", "INC", or trailing "And" left after a suffix-strip).
  for (let i = 0; i < 4; i += 1) {
    const before = titled
    titled = titled.replace(LEGAL_SUFFIX_RE, "").replace(TRAILING_CONNECTOR_RE, "").trim()
    if (titled === before) break
  }

  if (titled.length >= 2 && titled.length <= 25) return titled

  // Fall back to the guessed-domain stem when title-case is still long.
  if (guessedDomain) {
    const m = guessedDomain.match(/^([a-z][a-z0-9-]{1,19})\./i)
    const stem = m?.[1]
    if (stem) {
      const known = KNOWN_ACRONYMS[stem.toLowerCase()]
      if (known) return known
      return stem.charAt(0).toUpperCase() + stem.slice(1).toLowerCase()
    }
  }

  return titled || trimmed
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

  // Convert "VISA TECHNOLOGY AND OPERATIONS LLC" → "Visa" before persisting.
  // Keeps the raw LCA form in raw_ats_config.normalized for traceability.
  const cleanName = humanizeCompanyName(displayName, guessedDomain)

  const raw_ats_config = {
    source: source === 'uscis' ? 'uscis_reconciliation' : 'lca_reconciliation',
    normalized,
    original_display_name: displayName,
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
      [cleanName.slice(0, 140), sentinelDomain, careersUrl, logoUrl, JSON.stringify(raw_ats_config)]
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

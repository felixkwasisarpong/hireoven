/**
 * A stable key for "which ATS board is this", independent of how the identifier
 * happens to be spelled.
 *
 * The same Workday board reaches us under several spellings depending on which
 * subsystem recorded it:
 *
 *   conocophillips/External              (backfill, from a board URL path)
 *   conocophillips:wd1:External          (adapter slug, tenant:datacentre:site)
 *   conocophillips:wd1:external          (lower-cased somewhere upstream)
 *
 * Those are one board, but an exact-string lookup treats them as three. That is
 * how the Career Site Scout minted a second ConocoPhillips record — the board was
 * already claimed under the slash spelling, the claim check missed it, and a
 * shadow company was created carrying 77 live jobs.
 *
 * The datacentre segment is deliberately dropped: a tenant lives in exactly one
 * Workday datacentre, so `alation:wd5:ExternalSite` and `alation:wd503:ExternalSite`
 * are the same board with one of them stale. Site names are case-insensitive on
 * Workday's CXS API (verified: External / external / EXTERNAL all return the same
 * 188 postings for frostbank), so case is dropped too.
 */

const WORKDAY_SLUG_RE = /^([a-z0-9_-]+):(wd\d{1,3}):([A-Za-z0-9_-]+)$/i
const WORKDAY_PATH_RE = /^([a-z0-9_-]+)\/([A-Za-z0-9_-]+)$/i
const WORKDAY_HOST_RE = /^([a-z0-9_-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/i
/** Workday's other careers host — tenant in the path, not the subdomain. */
const WORKDAY_SITE_HOST_RE = /^wd\d{1,3}\.myworkdaysite\.com$/i

function isLocaleSegment(segment: string): boolean {
  return /^[a-z]{2}(-[a-z]{2,3})?$/i.test(segment)
}

/**
 * Canonical `tenant/site` for a Workday board, or null if the value isn't one.
 * Accepts the adapter slug, the slash form, and a full board URL.
 */
export function workdayBoardKey(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null

  const slug = raw.match(WORKDAY_SLUG_RE)
  if (slug) return `${slug[1].toLowerCase()}/${slug[3].toLowerCase()}`

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      const hostname = url.hostname.toLowerCase()
      const parts = url.pathname.split("/").filter(Boolean)
      const start = parts.length > 0 && isLocaleSegment(parts[0]) ? 1 : 0

      const host = hostname.match(WORKDAY_HOST_RE)
      if (host) {
        const site = parts[start]
        if (!site || !/^[A-Za-z0-9_-]+$/.test(site)) return null
        return `${host[1].toLowerCase()}/${site.toLowerCase()}`
      }

      // wd5.myworkdaysite.com/recruiting/<tenant>/<site>
      if (WORKDAY_SITE_HOST_RE.test(hostname)) {
        if (parts[start]?.toLowerCase() !== "recruiting") return null
        const tenant = parts[start + 1]
        const site = parts[start + 2]
        if (!tenant || !site) return null
        if (!/^[a-z0-9_-]+$/i.test(tenant) || !/^[A-Za-z0-9_-]+$/.test(site)) return null
        return `${tenant.toLowerCase()}/${site.toLowerCase()}`
      }

      return null
    } catch {
      return null
    }
  }

  const path = raw.match(WORKDAY_PATH_RE)
  if (path) return `${path[1].toLowerCase()}/${path[2].toLowerCase()}`

  return null
}

/**
 * Comparison key for an (ats_type, ats_identifier) pair. Workday gets the
 * board-aware treatment above; every other provider just loses case, which is
 * enough to collapse the `Cisco_Careers` / `cisco_careers` class of duplicate.
 * Returns null when there is nothing meaningful to compare.
 */
export function atsIdentifierKey(
  atsType: string | null | undefined,
  atsIdentifier: string | null | undefined
): string | null {
  const type = atsType?.trim().toLowerCase()
  const identifier = atsIdentifier?.trim()
  if (!type || !identifier) return null
  if (type === "workday") return workdayBoardKey(identifier) ?? identifier.toLowerCase()
  return identifier.toLowerCase()
}

/**
 * SQL fragment producing the same key as {@link atsIdentifierKey} for a column.
 * Kept beside the TS implementation so the two cannot drift apart.
 */
export function atsIdentifierKeySql(column: string, atsType: string): string {
  if (atsType.trim().toLowerCase() === "workday") {
    // tenant[:wdNNN]:site  or  tenant/site  ->  tenant/site
    return `lower(regexp_replace(${column}, '^([^:/]+)(:wd[0-9]{1,3})?[:/]([A-Za-z0-9_-]+)$', '\\1/\\3'))`
  }
  return `lower(${column})`
}

/**
 * Same key, for queries that span providers and so cannot branch in TypeScript
 * (e.g. grouping every duplicate ATS pair in one pass).
 */
export function atsIdentifierKeySqlAnyType(typeColumn: string, identifierColumn: string): string {
  return `CASE WHEN lower(${typeColumn}) = 'workday'
            THEN ${atsIdentifierKeySql(identifierColumn, "workday")}
            ELSE lower(${identifierColumn}) END`
}

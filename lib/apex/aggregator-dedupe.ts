/**
 * Per-source dedupe + normalization helpers for /api/apex/jobs/ingest.
 *
 * Title normalization (per brief): lowercase, strip punctuation, drop common
 * suffixes like "(Remote)" / "(Hybrid)" / "I/II/III" roman numerals at end,
 * and any location parenthetical at the end.
 */

export type AggregatorSource = "linkedin" | "glassdoor" | "indeed" | "handshake"

const TRAILING_LOCATION_PARENS_RE = /\s*\([^)]{2,}\)\s*$/
const TRAILING_ROMAN_NUMERAL_RE = /\s+(?:i{1,3}|iv|v|vi{1,3}|ix|x)$/i

export function normalizeTitle(raw: string | null | undefined): string {
  if (!raw) return ""
  let t = raw.trim().toLowerCase()
  // Drop a trailing parenthetical (location/seniority/work-mode tag).
  t = t.replace(TRAILING_LOCATION_PARENS_RE, "")
  // Strip punctuation (keep alphanumerics + spaces + hyphen for "co-op").
  t = t.replace(/[^a-z0-9\s-]/g, " ")
  // Drop trailing roman numerals.
  t = t.replace(TRAILING_ROMAN_NUMERAL_RE, "")
  // Collapse whitespace.
  t = t.replace(/\s+/g, " ").trim()
  return t
}

/**
 * Reduce a location string like "San Francisco, CA, United States · Remote" to
 * "san francisco" — used for Indeed cross-city dedupe and Glassdoor cross-source
 * matching.
 */
export function normalizeLocationCity(raw: string | null | undefined): string {
  if (!raw) return ""
  const head = raw.split(/[·•|]/)[0] ?? raw
  const firstSegment = head.split(",")[0] ?? ""
  return firstSegment.trim().toLowerCase().replace(/\s+/g, " ")
}

export function postedAtDay(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

/** ms in 14 days, used for Glassdoor cross-source dedupe window. */
export const GLASSDOOR_CROSS_SOURCE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

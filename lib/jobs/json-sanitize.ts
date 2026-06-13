/**
 * Make external text safe to store as Postgres `jsonb`.
 *
 * Two failure modes PG's jsonb parser rejects, both common in scraped job/company
 * text:
 *   1. Lone UTF-16 surrogates — e.g. an emoji (U+1F3C6 🏆 = 🏆) sliced
 *      mid-pair by a fixed-length truncate, leaving a bare \uD83C. JSON.stringify
 *      emits it as an escaped "\ud83c", and PG errors: "Unicode low surrogate
 *      must follow a high surrogate."
 *   2. NUL and other C0/C1 control chars — invalid in jsonb string values.
 *
 * Extracted so every jsonb writer — the harvester, the ingest crons, and
 * description-enrichment — shares one source of truth.
 */

function toWellFormedSafe(input: string): string {
  // Node 20+ has String#toWellFormed (replaces lone surrogates with U+FFFD).
  const maybe = (input as string & { toWellFormed?: () => string }).toWellFormed
  if (typeof maybe === "function") return maybe.call(input)
  // Fallback: with the `u` flag, a valid surrogate pair is one astral code point,
  // so \p{Cs} matches only LONE surrogates — replace each with U+FFFD.
  return input.replace(/\p{Cs}/gu, "�")
}

export function sanitizeJsonString(input: string): string {
  return toWellFormedSafe(input).replace(/\p{Cc}/gu, (c) => {
    if (c === "\t" || c === "\n" || c === "\r") return c
    return c.charCodeAt(0) === 0 ? "" : " " // drop NUL, blank other control chars
  })
}

/** Recursively sanitize every string in a JSON-serializable value. */
export function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeJsonString(value)
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item))
  if (!value || typeof value !== "object") return value

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = sanitizeJsonValue(item)
  }
  return out
}

/** Drop-in replacement for JSON.stringify when the result is bound to a jsonb column. */
export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(sanitizeJsonValue(value))
}

/**
 * Scout display text utilities — shared by all Scout UI surfaces.
 *
 * Single source of truth for converting a raw `response.answer` string
 * into user-facing text.  No component should call `.answer` directly
 * without running it through `getScoutDisplayText` first.
 *
 * Rules (in order):
 *   1. Empty / whitespace → return ""
 *   2. Markdown code fence wrapping JSON → unwrap + extract `.answer`
 *   3. Whole string is a JSON object with an `.answer` string → extract it
 *   4. String starts with `{` or `[` (looks like JSON) → return fallback
 *   5. Anything else → return trimmed text
 */

function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i)
  return fenced ? fenced[1].trim() : text
}

function extractJsonCandidate(text: string): string | null {
  const cleaned = stripCodeFence(text.trim())
  const start = cleaned.indexOf("{")
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (escaped) { escaped = false; continue }
    if (c === "\\") { escaped = inString; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === "{") depth++
    if (c === "}") depth--
    if (depth === 0) return cleaned.slice(start, i + 1)
  }
  return null
}

const JSON_START_RE = /^\s*[{[]/

export function getScoutDisplayText(answer: string): string {
  if (!answer || !answer.trim()) return ""

  const trimmed = answer.trim()
  const candidate = extractJsonCandidate(trimmed)

  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        typeof (parsed as Record<string, unknown>).answer === "string"
      ) {
        const inner = ((parsed as Record<string, unknown>).answer as string).trim()
        if (inner && !JSON_START_RE.test(inner)) return inner
      }
    } catch {
      // malformed JSON — fall through
    }
  }

  // Whole string looks like JSON → never show it as prose
  if (JSON_START_RE.test(stripCodeFence(trimmed))) {
    return "Scout prepared a structured response — see the cards and actions below."
  }

  return trimmed
}

/**
 * Returns true when a string looks like raw JSON that should never be
 * displayed directly to the user.
 */
export function isRawJson(text: string): boolean {
  if (!text) return false
  return JSON_START_RE.test(stripCodeFence(text.trim()))
}

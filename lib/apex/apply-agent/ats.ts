/**
 * ATS resolution for bulk apply selection.
 *
 * The ATS a job belongs to is determined by its apply_url host — the same
 * signal the extension's autofill uses to pick a driver (guessAtsFromUrl) and
 * bulk-prepare uses to label the job (detectAtsFromApplyUrl). Filtering the
 * "top matched jobs" pool on apply_url host therefore selects exactly the jobs
 * a given ATS driver can actually fill.
 */

/** Canonical ATS slugs we can filter/queue by. */
export type AtsSlug =
  | "workday"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "icims"
  | "smartrecruiters"
  | "bamboohr"
  | "jazzhr"

/** Human label for chat/answer text. */
export const ATS_LABELS: Record<AtsSlug, string> = {
  workday:         "Workday",
  greenhouse:      "Greenhouse",
  lever:           "Lever",
  ashby:           "Ashby",
  icims:           "iCIMS",
  smartrecruiters: "SmartRecruiters",
  bamboohr:        "BambooHR",
  jazzhr:          "JazzHR",
}

export const APEX_APPLY_SUPPORTED_ATS: readonly AtsSlug[] = [
  "workday",
  "greenhouse",
  "lever",
  "ashby",
  "icims",
  "smartrecruiters",
  "bamboohr",
  "jazzhr",
]

/**
 * SQL ILIKE patterns matched against `jobs.apply_url`. Mirrors the host checks
 * in chrome-extension guessAtsFromUrl + bulk-prepare detectAtsFromApplyUrl.
 */
export const ATS_APPLY_URL_PATTERNS: Record<AtsSlug, string[]> = {
  workday:         ["%myworkdayjobs.com%", "%workday.com%"],
  greenhouse:      ["%greenhouse.io%"],
  lever:           ["%lever.co%"],
  ashby:           ["%ashbyhq.com%"],
  icims:           ["%icims.com%"],
  smartrecruiters: ["%smartrecruiters.com%"],
  bamboohr:        ["%bamboohr.com%"],
  // JazzHR serves applications on <tenant>.applytojob.com — a single-page form
  // the extension's generic loop drives like Greenhouse/Lever.
  jazzhr:          ["%applytojob.com%", "%jazzhr.com%"],
}

/**
 * Map free-form input ("Greenhouse", "smart recruiters", "ashbyhq", "bamboo")
 * to a canonical slug. Returns null when nothing recognized.
 */
export function canonicalizeAts(input: string | null | undefined): AtsSlug | null {
  if (!input) return null
  const k = input.toLowerCase().replace(/[^a-z]/g, "")
  if (!k) return null
  if (k.includes("greenhouse")) return "greenhouse"
  if (k.includes("workday")) return "workday"
  if (k.includes("ashby")) return "ashby"
  if (k.includes("icims")) return "icims"
  if (k.includes("smartrecruiter")) return "smartrecruiters"
  if (k.includes("bamboo")) return "bamboohr"
  if (k.includes("jazzhr") || k.includes("applytojob")) return "jazzhr"
  // "lever" last — it is a common English word, so only match the standalone
  // token to avoid false positives on words like "leverage".
  if (/(^|[^a-z])lever([^a-z]|$)/.test(input.toLowerCase())) return "lever"
  return null
}

/**
 * Scan a natural-language message for ATS mentions and return the canonical
 * slugs found, de-duplicated and in a stable order. Used to parse commands like
 * "apply to 3 top matched jobs with Greenhouse ATS".
 */
export function extractAtsSlugs(message: string): AtsSlug[] {
  const lower = message.toLowerCase()
  const found = new Set<AtsSlug>()
  const probes: Array<[RegExp, AtsSlug]> = [
    [/greenhouse/, "greenhouse"],
    [/workday/, "workday"],
    [/ashby(?:hq)?/, "ashby"],
    [/icims/, "icims"],
    [/smart\s*recruiters?/, "smartrecruiters"],
    [/bamboo(?:hr)?/, "bamboohr"],
    [/jazz\s*hr|applytojob/, "jazzhr"],
    [/(^|[^a-z])lever([^a-z]|$)/, "lever"],
  ]
  for (const [re, slug] of probes) {
    if (re.test(lower)) found.add(slug)
  }
  return Array.from(found)
}

/**
 * Build a SQL fragment + params filtering `<alias>.apply_url` to the given ATS
 * slugs. `startIndex` is the next positional-parameter number to use. Returns
 * null when no slugs resolve (caller skips the filter).
 */
export function buildAtsApplyUrlFilter(
  slugs: AtsSlug[],
  alias: string,
  startIndex: number,
): { clause: string; params: string[] } | null {
  const patterns = slugs.flatMap((slug) => ATS_APPLY_URL_PATTERNS[slug] ?? [])
  if (patterns.length === 0) return null
  const likes = patterns.map((_, i) => `${alias}.apply_url ILIKE $${startIndex + i}`)
  return { clause: `(${likes.join(" OR ")})`, params: patterns }
}

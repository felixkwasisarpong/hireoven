/**
 * Job title -> SOC code classification.
 *
 * Backed by `soc_title_lexicon`, which is derived from our own certified LCA filings
 * (employer-written title -> the SOC DOL accepted). See the rationale block in
 * scripts/migrations/add-oflc-wage-levels.sql -- the official DOL crosswalk carries only one
 * title per SOC and is useless against real req titles.
 *
 * Matching strategy: take the longest contiguous token phrase of the normalized title that
 * exists in the lexicon. "Sr. Software Engineer, Autonomy Services" normalizes to
 * "software engineer autonomy services", whose phrases include "software engineer" -> 15-1252.
 * Longest-first because a longer phrase is a more specific claim ("data scientist" beats
 * "data" and "machine learning engineer" beats "machine learning").
 *
 * Measured on 100k active jobs with a parsed salary band: exact-title matching resolves 11.0%,
 * this resolves 56.3%. The unresolved remainder is mostly retail/food/service work that is not
 * an H-1B specialty occupation and correctly gets no wage-level treatment.
 */

/** Phrase length bounds. 1-token phrases are far too ambiguous ("engineer", "manager"). */
const MIN_PHRASE_TOKENS = 2
const MAX_PHRASE_TOKENS = 5

/**
 * Seniority / level noise stripped before matching, so "Sr. Software Engineer III" and
 * "Software Engineer" reach the same lexicon entry.
 *
 * MUST stay in sync with the identical list in scripts/build-soc-lexicon.ts -- the lexicon keys
 * and the lookup keys have to be produced by the same normalizer or nothing matches.
 */
const NOISE_TOKENS = new Set([
  "sr", "snr", "senior", "jr", "junior", "staff", "principal", "lead", "associate",
  "asst", "assistant", "entry", "level", "mid", "expert", "advanced",
  "i", "ii", "iii", "iv", "v", "vi",
])

/** SOC major groups that are plausible H-1B specialty occupations. */
const SPECIALTY_MAJOR_GROUPS = new Set([
  "11", // Management
  "13", // Business and Financial Operations
  "15", // Computer and Mathematical
  "17", // Architecture and Engineering
  "19", // Life, Physical, and Social Science
  "21", // Community and Social Service
  "25", // Educational Instruction and Library
  "27", // Arts, Design, Entertainment, Sports, and Media
  "29", // Healthcare Practitioners and Technical
])

/**
 * Lowercase, strip punctuation and standalone digits, drop seniority tokens, collapse spaces.
 * Digits are dropped as whole tokens only, so "3d artist" keeps "3d" but "engineer 2" loses "2".
 */
export function normalizeJobTitle(title: string | null | undefined): string {
  const cleaned = (title ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

  if (!cleaned) return ""

  return cleaned
    .split(" ")
    .filter((tok) => tok && !NOISE_TOKENS.has(tok) && !/^\d+$/.test(tok))
    .join(" ")
}

/**
 * Every contiguous token phrase of the normalized title, longest first. The caller looks these
 * up in order and takes the first hit, which is the longest/most specific match.
 */
export function titlePhrases(normalizedTitle: string): string[] {
  const toks = normalizedTitle.split(" ").filter(Boolean)
  if (toks.length < MIN_PHRASE_TOKENS) return []

  const phrases: string[] = []
  const maxLen = Math.min(MAX_PHRASE_TOKENS, toks.length)
  for (let len = maxLen; len >= MIN_PHRASE_TOKENS; len--) {
    for (let i = 0; i + len <= toks.length; i++) {
      phrases.push(toks.slice(i, i + len).join(" "))
    }
  }
  // De-duplicate while preserving the longest-first ordering.
  return [...new Set(phrases)]
}

/** SOC major group ("15-1252" -> "15"). */
export function socMajorGroup(socCode: string): string {
  return socCode.slice(0, 2)
}

/**
 * Is this SOC a plausible H-1B specialty occupation? Gates the lottery/wage-level surfaces so we
 * never tell a retail cashier to negotiate for Level III.
 */
export function isSpecialtyOccupation(socCode: string | null | undefined): boolean {
  if (!socCode) return false
  return SPECIALTY_MAJOR_GROUPS.has(socMajorGroup(socCode))
}

/**
 * Strip the O*NET suffix DOL uses in filing data ('15-1252.00') down to the bare SOC ('15-1252')
 * that the published wage tables are keyed on. Joining the two forms without this matches
 * nothing -- lca_records stores the suffixed form, ALC_Export.csv the bare one.
 */
export function bareSocCode(socCode: string | null | undefined): string | null {
  const s = (socCode ?? "").trim()
  if (!s) return null
  const m = s.match(/^(\d{2}-\d{4})/)
  return m ? m[1] : null
}

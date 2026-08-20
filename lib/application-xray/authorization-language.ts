import type {
  AuthorizationConflictOutcome,
  PostingAuthorizationLanguageCategory,
  PostingAuthorizationRequirement,
  TemporalScopeMarker,
  XRayConfidence,
} from "./types"

export type AuthorizationMatrixColumn =
  | "YES_NO_FUTURE_ACTIONS"
  | "YES_FUTURE_ACTIONS"
  | "NEEDS_EMPLOYER_ACTION"
  | "NO"
  | "UNKNOWN"

export const POSTING_AUTHORIZATION_CATEGORIES: PostingAuthorizationLanguageCategory[] = [
  "SPONSORSHIP_SCOPE_AMBIGUOUS",
  "NO_CURRENT_SPONSORSHIP",
  "NO_FUTURE_SPONSORSHIP",
  "NO_CURRENT_OR_FUTURE_SPONSORSHIP",
  "UNRESTRICTED_AUTHORIZATION_REQUIRED",
  "CITIZENSHIP_REQUIRED",
  "CLEARANCE_REQUIRED",
  "AMBIGUOUS_GENERAL",
  "SPONSORSHIP_OFFERED",
]

export const AUTHORIZATION_MATRIX_COLUMNS: AuthorizationMatrixColumn[] = [
  "YES_NO_FUTURE_ACTIONS",
  "YES_FUTURE_ACTIONS",
  "NEEDS_EMPLOYER_ACTION",
  "NO",
  "UNKNOWN",
]

export const AUTHORIZATION_CONFLICT_MATRIX: Record<
  PostingAuthorizationLanguageCategory,
  Record<AuthorizationMatrixColumn, AuthorizationConflictOutcome>
> = {
  SPONSORSHIP_SCOPE_AMBIGUOUS: {
    YES_NO_FUTURE_ACTIONS: "no_conflict",
    YES_FUTURE_ACTIONS: "needs_clarification",
    NEEDS_EMPLOYER_ACTION: "needs_clarification",
    NO: "conflict_now",
    UNKNOWN: "needs_clarification",
  },
  NO_CURRENT_SPONSORSHIP: {
    YES_NO_FUTURE_ACTIONS: "no_conflict",
    YES_FUTURE_ACTIONS: "no_conflict",
    NEEDS_EMPLOYER_ACTION: "conflict_now",
    NO: "conflict_now",
    UNKNOWN: "needs_clarification",
  },
  NO_FUTURE_SPONSORSHIP: {
    YES_NO_FUTURE_ACTIONS: "no_conflict",
    YES_FUTURE_ACTIONS: "conflict_future",
    NEEDS_EMPLOYER_ACTION: "conflict_future",
    NO: "conflict_now",
    UNKNOWN: "needs_clarification",
  },
  NO_CURRENT_OR_FUTURE_SPONSORSHIP: {
    YES_NO_FUTURE_ACTIONS: "no_conflict",
    YES_FUTURE_ACTIONS: "conflict_future",
    NEEDS_EMPLOYER_ACTION: "conflict_now",
    NO: "conflict_now",
    UNKNOWN: "needs_clarification",
  },
  UNRESTRICTED_AUTHORIZATION_REQUIRED: {
    YES_NO_FUTURE_ACTIONS: "no_conflict",
    YES_FUTURE_ACTIONS: "conflict_now",
    NEEDS_EMPLOYER_ACTION: "conflict_now",
    NO: "conflict_now",
    UNKNOWN: "needs_clarification",
  },
  CITIZENSHIP_REQUIRED: {
    YES_NO_FUTURE_ACTIONS: "no_conflict",
    YES_FUTURE_ACTIONS: "conflict_now",
    NEEDS_EMPLOYER_ACTION: "conflict_now",
    NO: "conflict_now",
    UNKNOWN: "needs_clarification",
  },
  CLEARANCE_REQUIRED: {
    YES_NO_FUTURE_ACTIONS: "needs_clarification",
    YES_FUTURE_ACTIONS: "needs_clarification",
    NEEDS_EMPLOYER_ACTION: "needs_clarification",
    NO: "needs_clarification",
    UNKNOWN: "needs_clarification",
  },
  AMBIGUOUS_GENERAL: {
    YES_NO_FUTURE_ACTIONS: "no_conflict",
    YES_FUTURE_ACTIONS: "needs_clarification",
    NEEDS_EMPLOYER_ACTION: "needs_clarification",
    NO: "needs_clarification",
    UNKNOWN: "needs_clarification",
  },
  SPONSORSHIP_OFFERED: {
    YES_NO_FUTURE_ACTIONS: "no_conflict",
    YES_FUTURE_ACTIONS: "no_conflict",
    NEEDS_EMPLOYER_ACTION: "no_conflict",
    NO: "no_conflict",
    UNKNOWN: "no_conflict",
  },
}

const VISA_NAME_RE = /\b(?:f-?1|opt|cpt|stem|h-?1b|h-?2|tn|temporary visas?)\b/i

function firstSentenceContaining(text: string, pattern: RegExp): string | null {
  return splitSentences(text).find((sentence) => pattern.test(sentence)) ?? null
}

/**
 * Sentence-level negation applied to a sponsorship phrase.
 *
 * The offered-sponsorship patterns are substrings of their own negations:
 * "sponsorship available" sits inside "NO sponsorship available", and
 * "offer sponsorship" inside "we cannot offer sponsorship". Matching them
 * without checking for negation classified an explicit refusal as an explicit
 * offer — the worst possible direction for a candidate who needs sponsorship,
 * because it turns a job that excludes them into one that welcomes them.
 *
 * Scoped to the sentence, so "We offer sponsorship. No exceptions." is not
 * negated by a later sentence.
 */
function hasSponsorshipNegation(sentence: string): boolean {
  const lower = sentence.toLowerCase()
  return (
    // "no sponsorship", "no visa sponsorship available"
    /\bno\b[^.]{0,40}\bsponsor(?:ship)?\b/.test(lower) ||
    // "not able to / unable to / cannot / won't / do not ... sponsor"
    /\b(?:not able to|unable to|cannot|can not|can't|won'?t|will not|do(?:es)? not|isn'?t|is not|aren'?t|are not|never)\b[^.]{0,80}\bsponsor(?:ship)?\b/.test(lower) ||
    // "sponsorship is not available / will not be provided / unavailable"
    /\bsponsor(?:ship)?\b[^.]{0,60}\b(?:not available|unavailable|not provided|not offered|not possible|not considered|will not be)\b/.test(lower) ||
    // "without sponsorship"
    /\bwithout\b[^.]{0,40}\bsponsor(?:ship)?\b/.test(lower)
  )
}

/**
 * "Sponsor" and "sponsorship" have common non-immigration senses that must not
 * produce a visa requirement in either direction:
 *   - advertising / commercial  ("sponsorship integrations", "sponsors and advertisers")
 *   - mentorship / management   ("mentor, coach, and sponsor a team of 4-6 engineers")
 * Both appear verbatim in live postings in this database.
 */
function isNonVisaSponsorshipSense(sentence: string): boolean {
  const lower = sentence.toLowerCase()
  return (
    /\bsponsor(?:ship|ed|ing)?s?\b[^.]{0,60}\b(?:integration|deal|package|revenue|opportunit|activation|inventory|advertiser|advertising|brand|campaign|broadcast|media|stadium|league|sport|event|booth|conference|podcast|newsletter)/.test(lower) ||
    /\b(?:advertis\w*|marketing|brand|event|title|media|commercial)\s+sponsor(?:ship)?/.test(lower) ||
    // "mentor, coach, and sponsor a team" — people-development sense
    /\bsponsor\b[^.]{0,30}\b(?:a\s+)?(?:team|teams|squad|group|mentee|report|direct report)/.test(lower) ||
    /\b(?:mentor|coach|develop|grow|champion)\b[^.]{0,40}\bsponsor\b/.test(lower)
  )
}

function firstSentenceContainingWhere(
  text: string,
  pattern: RegExp,
  predicate: (sentence: string) => boolean,
): string | null {
  return splitSentences(text).find((sentence) => pattern.test(sentence) && predicate(sentence)) ?? null
}

/**
 * Abbreviations whose trailing period is not a sentence boundary. Without this
 * guard, "Applicants must be U.S. citizens." splits after "U.S." and the
 * citizenship pattern — which needs "u.s." and "citizens" in the same sentence
 * — never matches. That is the commonest citizenship phrasing in the corpus,
 * so the whole CITIZENSHIP_REQUIRED path was effectively dead on it.
 */
const SENTENCE_SAFE_ABBREVIATIONS = [
  "u.s.", "u.s.a.", "e.g.", "i.e.", "etc.", "inc.", "ltd.", "co.", "corp.",
  "vs.", "approx.", "dept.", "est.", "no.", "mr.", "ms.", "mrs.", "dr.", "st.",
]

export function splitSentences(text: string): string[] {
  let working = text.replace(/\s+/g, " ")
  // Protect abbreviation periods behind a sentinel before splitting.
  for (const abbr of SENTENCE_SAFE_ABBREVIATIONS) {
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    working = working.replace(new RegExp(escaped, "gi"), (m) => m.replace(/\./g, "\u0000"))
  }
  // Also protect single-letter initials such as "J. Smith".
  working = working.replace(/\b([A-Z])\.(?=\s+[A-Z])/g, "$1\u0000")
  return working
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\u0000/g, ".").trim())
    .filter(Boolean)
}

function scopeForSentence(sentence: string): {
  category: PostingAuthorizationLanguageCategory
  temporalScope: TemporalScopeMarker
} {
  const lower = sentence.toLowerCase()
  if (/\b(?:now|current(?:ly)?|at this time|at present|right now)\b[^.]{0,80}\b(?:future|later)\b|\b(?:now|currently|at this time|at present|right now)\s+or\s+(?:in\s+the\s+)?future\b|\bcurrent\s+or\s+future\b/.test(lower)) {
    return { category: "NO_CURRENT_OR_FUTURE_SPONSORSHIP", temporalScope: "now_or_in_the_future" }
  }
  if (/\b(?:in the future|future sponsorship|future visa sponsorship|future employment sponsorship)\b/.test(lower)) {
    return { category: "NO_FUTURE_SPONSORSHIP", temporalScope: "in_the_future" }
  }
  if (/\b(?:begin|start|commence)\s+(?:work|employment)\b[^.]{0,80}\bwithout\b[^.]{0,40}\bsponsorship\b|\binitial\s+(?:work|employment)\s+authorization\b[^.]{0,80}\b(?:without|no)\b[^.]{0,40}\bsponsorship\b/.test(lower)) {
    return { category: "NO_CURRENT_SPONSORSHIP", temporalScope: "start_employment" }
  }
  if (/\bno\s+sponsorship\s+(?:is\s+)?available\s+for\s+initial\s+work\s+authorization\b/.test(lower)) {
    return { category: "NO_CURRENT_SPONSORSHIP", temporalScope: "initial_work_authorization" }
  }
  // A categorical eligibility bar states a property of the ROLE, not a timing
  // constraint: "this position is ineligible for immigration sponsorship" is
  // true now and later. There is no temporal marker to find, but that does not
  // make the scope ambiguous — and treating it as ambiguous made the conflict
  // matrix answer "needs_clarification" to precisely the candidates the posting
  // rules out. temporalScope stays "none_present" because no marker was in fact
  // present; only the semantic verdict is sharpened.
  if (
    /\b(?:in\s?eligible|not\s+eligible|ineligible)\b[^.]{0,40}\b(?:immigration|visa|employment|work)\s+sponsorship\b/.test(lower) ||
    /\b(?:this|the)\s+(?:position|role|job|opening|req(?:uisition)?)\b[^.]{0,60}\b(?:in\s?eligible|not\s+eligible|ineligible)\b[^.]{0,60}\bsponsor(?:ship)?\b/.test(lower)
  ) {
    return { category: "NO_CURRENT_OR_FUTURE_SPONSORSHIP", temporalScope: "none_present" }
  }

  return { category: "SPONSORSHIP_SCOPE_AMBIGUOUS", temporalScope: "none_present" }
}

function namesVisaCategories(sentence: string): string[] {
  const names = new Set<string>()
  const lower = sentence.toLowerCase()
  for (const [pattern, name] of [
    [/\bf-?1\b/, "F-1"],
    [/\bopt\b/, "OPT"],
    [/\bcpt\b/, "CPT"],
    [/\bstem\b/, "STEM"],
    [/\bh-?1b\b/, "H-1B"],
    [/\btn\b/, "TN"],
    [/\btemporary visas?\b/, "temporary visas"],
  ] as const) {
    if (pattern.test(lower)) names.add(name)
  }
  return [...names].sort()
}

export function categorizePostingAuthorizationLanguage(input: {
  text: string | null | undefined
  sourceFactId?: string
  confidence?: XRayConfidence
}): PostingAuthorizationRequirement[] {
  const text = input.text?.trim()
  if (!text) return []
  const sourceFactId = input.sourceFactId ?? "posting-auth-language"
  const confidence = input.confidence ?? "high"

  const offered = firstSentenceContainingWhere(
    text,
    /\b(?:(?:visa|work|employment)?\s*sponsorship\s+(?:is\s+)?available|will\s+sponsor|(?:offers?|provides?|supports?)\s+(?:visa\s+|work\s+|employment\s+)?sponsorship|sponsorship\s+(?:is\s+)?(?:offered|provided|supported))\b/i,
    (sentence) => !hasSponsorshipNegation(sentence) && !isNonVisaSponsorshipSense(sentence),
  )
  if (offered) {
    return [{
      category: "SPONSORSHIP_OFFERED",
      excerpt: offered,
      sourceFactId,
      confidence,
      deterministicMatch: true,
      temporalScope: "none_present",
      namesVisaCategories: namesVisaCategories(offered),
    }]
  }

  const citizenship = firstSentenceContaining(
    text,
    /\b(?:must be (?:a\s+|an\s+)?u\.?\s?s\.?\s+citizens?|citizenship\s+(?:is\s+)?required|u\.?\s?s\.?\s+persons?\s+only)\b/i,
  )
  if (citizenship) {
    return [{
      category: "CITIZENSHIP_REQUIRED",
      excerpt: citizenship,
      sourceFactId,
      confidence,
      deterministicMatch: true,
      temporalScope: "none_present",
      namesVisaCategories: namesVisaCategories(citizenship),
    }]
  }

  const clearance = firstSentenceContaining(
    text,
    /\b(?:ts\s*\/\s*sci|top[\s-]?secret|secret|public[\s-]?trust|security\s+clearance|full[\s-]?scope\s+poly|ci\s+poly)\b/i,
  )
  if (clearance) {
    return [{
      category: "CLEARANCE_REQUIRED",
      excerpt: clearance,
      sourceFactId,
      confidence,
      deterministicMatch: true,
      temporalScope: "none_present",
      namesVisaCategories: namesVisaCategories(clearance),
    }]
  }

  const unrestricted = firstSentenceContaining(
    text,
    // "unrestricted work authorization" was the only phrasing covered, so the
    // equally common "unrestricted right to work" / "unrestricted authorization
    // to work" slipped through — a hard exclusion reading as no signal at all.
    /\bunrestricted\b[^.]{0,80}\b(?:(?:work|employment)\s+authorization|right\s+to\s+work|authorization\s+to\s+work)\b|(?:temporary visas?|f-?1|opt|cpt|stem|h-?1b|tn)[^.]{0,120}\bwill\s+not\s+be\s+considered\b/i,
  )
  if (unrestricted) {
    return [{
      category: "UNRESTRICTED_AUTHORIZATION_REQUIRED",
      excerpt: unrestricted,
      sourceFactId,
      confidence,
      deterministicMatch: true,
      temporalScope: "none_present",
      namesVisaCategories: namesVisaCategories(unrestricted),
    }]
  }

  const sponsorshipBar = firstSentenceContainingWhere(
    text,
    // "(in)eligible for ... sponsorship" carries no negation VERB, so the
    // negation-word alternation below could never reach it: "not eligible" is
    // not "not able to", and "ineligible" contains no negation token at all.
    // These are among the most explicit refusals a posting can carry, and both
    // were scoring as no signal.
    /\b(?:in\s?eligible|not\s+eligible|ineligible)\b[^.]{0,60}\bsponsor(?:ship)?\b|\bsponsor(?:ship)?\b[^.]{0,60}\b(?:is\s+)?(?:in\s?eligible|not\s+eligible|ineligible)\b|\b(?:without|no|not able to|unable to|cannot|can not|won'?t|will not|do(?:es)? not|sponsorship\s+(?:is|will)?\s*(?:not|unavailable|not available))\b[^.]{0,120}\bsponsor(?:ship)?\b|\bsponsorship\s+(?:is|will\s+be)\s+(?:unavailable|not available)\b|\bsponsorship\b[^.]{0,80}\bwill\s+not\s+be\s+(?:provided|available|offered)\b|\b(?:candidate|applicant|individual)s?\s+(?:who\s+)?(?:require|requiring|requires)\s+sponsorship[^.]{0,120}\bwill\s+not\s+be\s+considered\b|\btemporary\s+visas?\b[^.]{0,180}\bwill\s+not\s+be\s+considered\b/i,
    (sentence) => !isNonVisaSponsorshipSense(sentence),
  )
  if (sponsorshipBar) {
    const scoped = scopeForSentence(sponsorshipBar)
    return [{
      category: scoped.category,
      excerpt: sponsorshipBar,
      sourceFactId,
      confidence,
      deterministicMatch: true,
      temporalScope: scoped.temporalScope,
      namesVisaCategories: namesVisaCategories(sponsorshipBar),
    }]
  }

  const general = firstSentenceContaining(
    text,
    /\b(?:authorized|authorization|legally permitted|legally able)\b[^.]{0,80}\b(?:work|employment)\b|\b(?:work|employment)\b[^.]{0,80}\b(?:authorized|authorization|legally permitted|legally able)\b/i,
  )
  if (general && !/\bunrestricted\b/i.test(general) && !VISA_NAME_RE.test(general)) {
    return [{
      category: "AMBIGUOUS_GENERAL",
      excerpt: general,
      sourceFactId,
      confidence,
      deterministicMatch: true,
      temporalScope: "none_present",
      namesVisaCategories: [],
    }]
  }

  return []
}

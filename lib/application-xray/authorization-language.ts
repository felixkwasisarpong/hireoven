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
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
  return sentences.find((sentence) => pattern.test(sentence)) ?? null
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

  const offered = firstSentenceContaining(
    text,
    /\b(?:visa sponsorship (?:is )?available|will sponsor|sponsorship available)\b/i,
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
    /\bunrestricted\b[^.]{0,80}\b(?:work|employment)\s+authorization\b|(?:temporary visas?|f-?1|opt|cpt|stem|h-?1b|tn)[^.]{0,120}\bwill\s+not\s+be\s+considered\b/i,
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

  const sponsorshipBar = firstSentenceContaining(
    text,
    /\b(?:without|no|not able to|unable to|cannot|can not|won'?t|will not|do(?:es)? not|sponsorship\s+(?:is|will)?\s*(?:not|unavailable|not available))\b[^.]{0,120}\bsponsor(?:ship)?\b|\bsponsorship\s+(?:is|will\s+be)\s+(?:unavailable|not available)\b|\bsponsorship\b[^.]{0,80}\bwill\s+not\s+be\s+(?:provided|available|offered)\b|\b(?:candidate|applicant|individual)s?\s+(?:who\s+)?(?:require|requiring|requires)\s+sponsorship[^.]{0,120}\bwill\s+not\s+be\s+considered\b|\btemporary\s+visas?\b[^.]{0,180}\bwill\s+not\s+be\s+considered\b/i,
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

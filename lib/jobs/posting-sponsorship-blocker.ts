/**
 * Posting-level sponsorship blockers.
 *
 * Employer-level verification answers "does this company sponsor?" from DOL and
 * USCIS filings, and it answers it well. But sponsorship is decided per
 * requisition, not per company, and the two answers routinely disagree: Jack
 * Henry & Associates files LCAs and scores 91% as an employer, while carrying
 * "This position is ineligible for immigration sponsorship and support" on
 * active engineering roles. Scored on employer data alone, a listing that rules
 * the candidate out reads as one of their best matches.
 *
 * That inversion is the bug this closes. The signal that should disqualify a
 * listing lives in the posting text, where no employer-level check can see it.
 *
 * Detection itself is delegated to `categorizePostingAuthorizationLanguage`,
 * which already has the hard-won parts — sentence-scoped negation so a refusal
 * is not read as an offer, non-immigration senses of "sponsor" filtered out,
 * abbreviation-safe sentence splitting. This module only maps its categories
 * onto the blocker shape the visa-fit scorer consumes.
 *
 * Pure module — no DB, no network, no model calls.
 */

import { categorizePostingAuthorizationLanguage } from "@/lib/application-xray/authorization-language"
import type { PostingAuthorizationLanguageCategory } from "@/lib/application-xray/types"
import type {
  IntelligenceConfidence,
  IntelligenceRiskLevel,
  SponsorshipBlocker,
  SponsorshipBlockerKind,
} from "@/types"

/**
 * Postings without sentence punctuation (bullet lists, stripped newlines) can
 * make the sentence splitter return one very long run-on. Quoting that back
 * whole would bury the actual clause and dump kilobytes into the UI, so the
 * excerpt is capped — the evidence has to be readable to be evidence.
 */
const MAX_EXCERPT_CHARS = 320

function trimExcerpt(sentence: string): string {
  const clean = sentence.replace(/\s+/g, " ").trim()
  return clean.length <= MAX_EXCERPT_CHARS ? clean : `${clean.slice(0, MAX_EXCERPT_CHARS - 1).trimEnd()}…`
}

interface CategoryMapping {
  kind: SponsorshipBlockerKind
  severity: IntelligenceRiskLevel
  confidence: IntelligenceConfidence
}

/**
 * Only categories that actually rule a sponsorship-needing candidate out become
 * blockers.
 *
 * `AMBIGUOUS_GENERAL` is deliberately absent. It fires on the ordinary I-9 line
 * ("must be authorized to work in the US"), which an F-1 OPT holder satisfies —
 * treating it as a blocker would hide every sponsoring employer that states the
 * legal minimum, the same inversion pointing the other way.
 */
const BLOCKING_CATEGORIES: Partial<Record<PostingAuthorizationLanguageCategory, CategoryMapping>> = {
  NO_CURRENT_OR_FUTURE_SPONSORSHIP: {
    kind: "no_sponsorship_statement",
    severity: "high",
    confidence: "high",
  },
  NO_CURRENT_SPONSORSHIP: {
    kind: "no_sponsorship_statement",
    severity: "high",
    confidence: "high",
  },
  NO_FUTURE_SPONSORSHIP: {
    // Survivable for someone with runway now, fatal at the H-1B step. Flagged
    // rather than treated as an immediate bar.
    kind: "no_sponsorship_statement",
    severity: "medium",
    confidence: "high",
  },
  UNRESTRICTED_AUTHORIZATION_REQUIRED: {
    kind: "requires_unrestricted_work_authorization",
    severity: "high",
    confidence: "high",
  },
  CITIZENSHIP_REQUIRED: {
    kind: "citizenship_or_clearance_required",
    severity: "high",
    confidence: "high",
  },
  CLEARANCE_REQUIRED: {
    kind: "citizenship_or_clearance_required",
    severity: "high",
    confidence: "medium",
  },
  SPONSORSHIP_SCOPE_AMBIGUOUS: {
    // A refusal whose scope is unstated — "we will not sponsor" with no
    // timeframe. Real, but not asserted as hard as a categorical bar.
    kind: "no_sponsorship_statement",
    severity: "medium",
    confidence: "medium",
  },
}

/**
 * Detect a sponsorship blocker in a posting's own text.
 *
 * Returns null when the posting says nothing disqualifying — including when it
 * explicitly offers sponsorship, which must never be inverted into a bar.
 */
export function detectPostingSponsorshipBlocker(
  description: string | null | undefined,
): SponsorshipBlocker | null {
  const requirements = categorizePostingAuthorizationLanguage({ text: description })
  if (requirements.length === 0) return null

  for (const requirement of requirements) {
    const mapping = BLOCKING_CATEGORIES[requirement.category]
    if (!mapping) continue
    return {
      detected: true,
      kind: mapping.kind,
      severity: mapping.severity,
      // The sentence is quoted back so the user can check the claim rather than
      // trust a score. A blocker with no evidence is not actionable.
      evidence: [trimExcerpt(requirement.excerpt)],
      source: "job_description",
      confidence: mapping.confidence,
    }
  }

  return null
}

/**
 * Whether a posting's text rules out a candidate who needs sponsorship at any
 * point. Used to disqualify a listing outright regardless of employer score.
 */
export function postingExcludesSponsorship(description: string | null | undefined): boolean {
  const blocker = detectPostingSponsorshipBlocker(description)
  return blocker?.severity === "high"
}

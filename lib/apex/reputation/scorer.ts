/**
 * Reputation Guard
 *
 * Scores a company on employer honesty before you apply.
 * Pulls from whatever structured data we have + Claude inference.
 *
 * Score components (100 pts total):
 *   offer_integrity    25 — do they honor offers? exploding offers? bait-and-switch?
 *   interview_quality  25 — respectful process? ghosting? feedback given?
 *   tc_accuracy        25 — does posted comp match reality? equity bait?
 *   culture_honesty    25 — do stated values match real employee signals?
 */

export type ReputationDimension =
  | "offer_integrity"
  | "interview_quality"
  | "tc_accuracy"
  | "culture_honesty"

export type ReputationSignal = {
  type: "green" | "red" | "neutral"
  label: string
  detail: string
  source: "glassdoor_inferred" | "blind_inferred" | "job_posting" | "apex_model" | "public_data"
}

export type ReputationScoreBreakdown = {
  [K in ReputationDimension]: {
    score: number      // 0–25
    label: string
    signals: ReputationSignal[]
  }
}

export type ReputationGuardResult = {
  companyName: string
  overallScore: number            // 0–100
  overallVerdict: "trusted" | "caution" | "red_flag" | "unknown"
  verdictSummary: string
  breakdown: ReputationScoreBreakdown
  watchouts: string[]             // ordered by severity
  greenLights: string[]
  researchLinks: {label: string; url: string}[]
  confidence: number              // 0–1 — how much data we actually have
  analyzedAt: string
}

export function buildEmptyBreakdown(): ReputationScoreBreakdown {
  return {
    offer_integrity:   { score: 12, label: "Offer Integrity",   signals: [] },
    interview_quality: { score: 12, label: "Interview Quality", signals: [] },
    tc_accuracy:       { score: 12, label: "TC Accuracy",       signals: [] },
    culture_honesty:   { score: 12, label: "Culture Honesty",   signals: [] },
  }
}

export function scoreFromBreakdown(b: ReputationScoreBreakdown): number {
  return Object.values(b).reduce((sum, dim) => sum + dim.score, 0)
}

export function verdictFromScore(score: number): ReputationGuardResult["overallVerdict"] {
  if (score >= 75) return "trusted"
  if (score >= 55) return "caution"
  if (score >= 30) return "red_flag"
  return "unknown"
}

export function buildResearchLinks(companyName: string): ReputationGuardResult["researchLinks"] {
  const encoded = encodeURIComponent(companyName)
  return [
    { label: "Glassdoor reviews", url: `https://www.glassdoor.com/Reviews/${encoded}-Reviews-E.htm` },
    { label: "Blind company page", url: `https://www.teamblind.com/company/${encoded}` },
    { label: "H-1B sponsorship data", url: `https://h1bdata.info/index.php?em=${encoded}` },
    { label: "LinkedIn life page",  url: `https://www.linkedin.com/company/${encoded}/life/` },
  ]
}

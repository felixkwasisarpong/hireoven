import { calculateLcaSalaryIntelligence } from "@/lib/jobs/lca-salary-intelligence"
import { calculateVisaFitScore } from "@/lib/jobs/visa-fit-score"
import type {
  IntelligenceConfidence,
  IntelligenceRiskLevel,
  OfferRiskAnalysis,
  OfferRiskCompanySnapshot,
  OfferRiskInput,
  OfferRiskLabel,
  SponsorshipBlocker,
} from "@/types"

export const OFFER_RISK_DISCLAIMER =
  "This is job-search risk guidance, not legal advice. Verify immigration and employment decisions with the employer, your DSO, or an immigration attorney."

const AUTH_NEEDS_SUPPORT = new Set([
  "F1_OPT",
  "F1_STEM_OPT",
  "H1B",
  "needs_future_sponsorship",
  "unknown",
])

const BLOCKER_PATTERNS: Array<{ pattern: RegExp; evidence: string }> = [
  {
    pattern: /(?:no|not|unable to|cannot|can't)\s+(?:provide|offer|support|sponsor).{0,40}(?:visa|sponsorship|h-?1b|work authorization)/i,
    evidence: "Offer language suggests the employer may not provide visa sponsorship.",
  },
  {
    pattern: /must\s+(?:be\s+)?(?:authorized|eligible)\s+to\s+work.{0,50}(?:without|no).{0,35}(?:sponsorship|visa)/i,
    evidence: "Offer language asks for work authorization without sponsorship.",
  },
  {
    pattern: /(?:u\.?s\.?\s+citizen|citizenship|required clearance|security clearance required)/i,
    evidence: "Offer language may include citizenship or clearance restrictions.",
  },
]

function clamp(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)))
}

function normalize(value: string | null | undefined) {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? ""
}

function stateFromLocation(location: string | null | undefined) {
  const parts = location?.split(",").map((part) => part.trim()).filter(Boolean) ?? []
  const last = parts.at(-1)
  if (!last) return null
  const maybeState = last.toUpperCase()
  return /^[A-Z]{2}$/.test(maybeState) ? maybeState : null
}

function inferRoleFamily(title: string | null | undefined) {
  const t = normalize(title)
  if (!t) return null
  if (/data scientist|machine learning|ml engineer|ai engineer|research scientist/.test(t)) return "Data Science / Machine Learning"
  if (/data engineer|analytics engineer|etl|pipeline/.test(t)) return "Data Engineering"
  if (/devops|site reliability|sre|platform|cloud|infrastructure/.test(t)) return "Cloud / DevOps"
  if (/software|frontend|backend|full stack|developer|application engineer|web engineer/.test(t)) return "Software Engineering"
  if (/product|program|project manager/.test(t)) return "Product / Program"
  return null
}

function detectSponsorshipBlocker(statement: string | null | undefined): SponsorshipBlocker | null {
  const text = statement?.trim()
  if (!text) return null

  const evidence = BLOCKER_PATTERNS
    .filter((item) => item.pattern.test(text))
    .map((item) => item.evidence)

  if (!evidence.length) return null

  return {
    detected: true,
    kind: /citizen|clearance/i.test(text)
      ? "citizenship_or_clearance_required"
      : "requires_unrestricted_work_authorization",
    severity: "high",
    evidence,
    source: "system",
    confidence: "medium",
  }
}

function roleFamilyCount(input: OfferRiskInput) {
  const roleFamily = inferRoleFamily(input.jobTitle)
  if (!roleFamily) return null

  const familyKey = normalize(roleFamily)
  return (input.lcaRecords ?? []).filter((record) => {
    const title = normalize(record.jobTitle)
    const explicitFamily = normalize(record.roleFamily)
    return explicitFamily.includes(familyKey) || familyKey.split(" ").some((part) => part.length > 4 && title.includes(part))
  }).length
}

function locationCount(input: OfferRiskInput) {
  const state = stateFromLocation(input.location)
  if (!state) return null
  return (input.lcaRecords ?? []).filter((record) => record.worksiteState?.toUpperCase() === state).length
}

function confidenceFromCoverage(parts: Array<unknown>): IntelligenceConfidence {
  const known = parts.filter((part) => part !== null && part !== undefined && part !== "unknown").length
  if (known >= 6) return "high"
  if (known >= 3) return "medium"
  if (known >= 1) return "low"
  return "unknown"
}

function h1bTimingRisk(input: OfferRiskInput): IntelligenceRiskLevel {
  const needsH1B =
    input.needsH1B ||
    input.needsFutureSponsorship ||
    input.workAuthorizationStatus === "H1B" ||
    input.workAuthorizationStatus === "needs_future_sponsorship"

  if (!needsH1B) return "low"
  if (!input.offerStartDate) return "unknown"

  const start = new Date(input.offerStartDate)
  if (Number.isNaN(start.getTime())) return "unknown"

  const month = start.getUTCMonth() + 1
  const day = start.getUTCDate()
  if (month < 4) return "high"
  if (month >= 4 && (month < 10 || (month === 10 && day < 1))) return "medium"
  return "low"
}

function riskLabel(score: number | null, confidence: IntelligenceConfidence): OfferRiskLabel {
  if (score === null || confidence === "unknown") return "Unknown"
  if (score >= 70) return "High"
  if (score >= 40) return "Medium"
  return "Low"
}

function dedupe(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function formatCompanySignal(company: OfferRiskCompanySnapshot | null | undefined) {
  if (!company) return null
  if (company.sponsorsH1b) {
    const count = company.recentH1BCount ?? company.totalLcaCount
    return count != null
      ? `${company.companyName ?? "Employer"} has historical H-1B/LCA filing signal (${count.toLocaleString()} recent or total records available).`
      : `${company.companyName ?? "Employer"} has a historical sponsorship signal.`
  }
  if (company.sponsorsH1b === false) return "Employer is not currently marked as an H-1B sponsor in Hireoven data."
  return null
}

export function calculateOfferRisk(input: OfferRiskInput): OfferRiskAnalysis {
  const salaryMin = input.salaryMin ?? input.salary ?? null
  const salaryMax = input.salaryMax ?? input.salary ?? null
  const company = input.companySnapshot ?? null
  const roleFamily = inferRoleFamily(input.jobTitle)
  const blocker = detectSponsorshipBlocker(input.sponsorshipStatement)
  const roleCount = roleFamilyCount(input)
  const sameLocationCount = locationCount(input)

  const salaryIntelligence = calculateLcaSalaryIntelligence({
    salaryMin,
    salaryMax,
    jobTitle: input.jobTitle,
    companyName: input.company,
    location: input.location ?? null,
    roleFamily,
    records: input.lcaRecords ?? [],
  })

  const timingRisk = h1bTimingRisk(input)
  const requiresSupport =
    input.needsOptStemSupport ||
    input.needsH1B ||
    input.needsFutureSponsorship ||
    AUTH_NEEDS_SUPPORT.has(input.workAuthorizationStatus)

  const visaFit = calculateVisaFitScore({
    jobTitle: input.jobTitle,
    companyName: input.company,
    sponsorsH1b: company?.sponsorsH1b ?? null,
    sponsorshipScore: company?.sponsorshipConfidence ?? null,
    priorLcaCount: company?.totalLcaCount ?? null,
    recentLcaCount: company?.recentH1BCount ?? null,
    roleFamilyLcaCount: roleCount,
    locationLcaCount: sameLocationCount,
    wageLevelSignal:
      salaryIntelligence.comparisonLabel === "Aligned"
        ? "strong"
        : salaryIntelligence.comparisonLabel === "Below Market"
          ? "weak"
          : "unknown",
    eVerify: company?.eVerifyLikely ?? null,
    sponsorshipBlocker: blocker,
  })

  let score = 35
  const keyConcerns: string[] = []
  const positiveSignals: string[] = []
  const missingData: string[] = []

  if (requiresSupport && blocker?.detected) {
    score += 35
    keyConcerns.push("The offer or recruiter language appears to conflict with future sponsorship or work-authorization support.")
  }

  if (requiresSupport && visaFit.label === "Weak") score += 14
  if (requiresSupport && visaFit.label === "Blocked") score += 26
  if (requiresSupport && (visaFit.label === "Strong" || visaFit.label === "Very Strong")) {
    score -= 12
    positiveSignals.push("Employer sponsorship signals are stronger than average for this offer context.")
  }

  if (company?.sponsorsH1b) {
    score -= 10
    const signal = formatCompanySignal(company)
    if (signal) positiveSignals.push(signal)
  } else if (requiresSupport && company?.sponsorsH1b === false) {
    score += 12
    keyConcerns.push("The company is not currently marked as an H-1B sponsor in available Hireoven data.")
  }

  if (roleCount != null && roleCount > 0) {
    score -= 8
    positiveSignals.push("Comparable sponsored role history was found for this role family.")
  } else if (requiresSupport && roleCount === 0) {
    score += 10
    keyConcerns.push("No comparable sponsored role-family history was found in available LCA records.")
  }

  if (sameLocationCount != null && sameLocationCount > 0) {
    score -= 5
    positiveSignals.push("Historical LCA records exist for the same worksite state.")
  } else if (sameLocationCount === 0 && input.workMode !== "remote") {
    score += 6
    keyConcerns.push("No same-location LCA history was found for the stated worksite.")
  }

  if (salaryIntelligence.comparisonLabel === "Below Market") {
    score += 14
    keyConcerns.push("The offered salary appears below comparable historical LCA wage ranges.")
  } else if (salaryIntelligence.comparisonLabel === "Aligned") {
    score -= 8
    positiveSignals.push("The offered salary overlaps comparable historical LCA wage ranges.")
  } else if (salaryIntelligence.comparisonLabel === "Unknown") {
    missingData.push("Comparable LCA wage data or a clear salary value is missing.")
  }

  if (input.needsOptStemSupport || input.workAuthorizationStatus === "F1_STEM_OPT") {
    if (company?.eVerifyLikely === true || visaFit.stemOptReadiness.eVerifyLikely === true) {
      score -= 7
      positiveSignals.push("E-Verify/STEM OPT readiness signal is present, but still needs employer confirmation.")
    } else {
      score += 8
      keyConcerns.push("E-Verify and STEM OPT employer support are not confirmed.")
    }
  }

  if (timingRisk === "high") {
    score += 12
    keyConcerns.push("The start date may create H-1B timing questions that should be verified before relying on the offer.")
  } else if (timingRisk === "medium") {
    score += 6
    keyConcerns.push("H-1B timing should be clarified because the start date falls before the typical October start window.")
  }

  if (!input.company.trim()) missingData.push("Company name is missing.")
  if (!input.jobTitle.trim()) missingData.push("Job title is missing.")
  if (!input.location?.trim()) missingData.push("Worksite location is missing.")
  if (!salaryMin && !salaryMax) missingData.push("Salary is missing.")
  if (!input.sponsorshipStatement?.trim()) missingData.push("Sponsorship statement or HR response was not provided.")
  if (!company) missingData.push("Company sponsorship history could not be matched yet.")
  if (!(input.lcaRecords?.length)) missingData.push("Historical LCA records were not available for this analysis.")

  const coreDataMissing = !input.company.trim() || !input.jobTitle.trim()
  const confidence = coreDataMissing ? "unknown" : confidenceFromCoverage([
    input.company,
    input.jobTitle,
    input.location,
    salaryMin,
    company?.sponsorsH1b,
    company?.recentH1BCount,
    input.lcaRecords?.length ? "known" : null,
    input.sponsorshipStatement,
  ])

  const finalScore = confidence === "unknown" ? null : clamp(score)
  const label = riskLabel(finalScore, confidence)

  const questionsToAskRecruiter = dedupe([
    "Can you confirm whether this role can support my current work authorization and any future sponsorship needs?",
    "Is the employer enrolled in E-Verify, and can the team support STEM OPT/I-983 documentation if applicable?",
    "Who owns immigration coordination after offer acceptance: HR, legal, outside counsel, or the hiring team?",
    "Is the listed worksite, remote/hybrid arrangement, and start date final for immigration paperwork purposes?",
    "Has this role family or location previously had sponsored employees at the company?",
    blocker?.detected ? "The offer language says sponsorship may not be supported. Can you clarify whether that applies to this role and candidate profile?" : "",
  ])

  const documentationChecklist = dedupe([
    "Written offer letter with title, salary, start date, worksite, and work mode.",
    "Recruiter or HR confirmation about sponsorship/work-authorization support.",
    "E-Verify and I-983 support confirmation if STEM OPT is relevant.",
    "Employer immigration contact, outside counsel contact, or HR owner.",
    "Any remote-work policy that affects worksite reporting.",
    "Copies of current authorization documents and timeline dates for your DSO or attorney review.",
  ])

  const summary =
    label === "Low"
      ? "This offer has several positive signals, but key immigration and employer-support details should still be confirmed in writing."
      : label === "Medium"
        ? "This offer has mixed signals. Treat it as workable only after HR, DSO, or counsel clarifies the open questions."
        : label === "High"
          ? "This offer has notable verification risk. Focus on clarifying sponsorship, timing, worksite, and documentation before relying on it."
          : "There is not enough confirmed data to label the offer risk confidently. Use the questions below to close the gaps."

  return {
    riskLabel: label,
    riskScore: finalScore,
    confidence,
    summary,
    keyConcerns: dedupe(keyConcerns.length ? keyConcerns : ["No major concern was detected, but several details still need confirmation."]),
    positiveSignals: dedupe(positiveSignals.length ? positiveSignals : ["No strong positive signal was confirmed yet."]),
    questionsToAskRecruiter,
    documentationChecklist,
    missingData: dedupe([...missingData, ...visaFit.dataGaps]),
    salaryIntelligence,
    visaFit: {
      score: visaFit.score,
      label: visaFit.label,
      reasons: visaFit.reasons,
      warnings: visaFit.warnings,
      dataGaps: visaFit.dataGaps,
    },
    h1bTimingRisk: timingRisk,
    sponsorshipConflictDetected: Boolean(blocker?.detected),
    disclaimer: OFFER_RISK_DISCLAIMER,
  }
}

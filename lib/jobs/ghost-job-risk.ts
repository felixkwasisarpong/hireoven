import type { AtsType, GhostJobRisk, IntelligenceRiskLevel, IntelligenceSignal } from "@/types"

export type ApplyUrlStatus = "ok" | "dead" | "redirect" | "unknown"

export type GhostJobRiskLabel = "Low" | "Medium" | "High" | "Unknown"

export type CalculateGhostJobRiskInput = {
  postedAt?: string | Date | null
  lastVerifiedAt?: string | Date | null
  applyUrlStatus?: ApplyUrlStatus | string | null
  timesSeen?: number | null
  repostCount?: number | null
  locationCount?: number | null
  duplicateCount?: number | null
  description?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
  atsType?: AtsType | string | null
  applyUrl?: string | null
  companyDomain?: string | null
  isRemote?: boolean | null
  /** True when an active hiring freeze signal exists for this employer. */
  hasHiringFreeze?: boolean | null
  /** Confidence level of the freeze — drives how much risk weight is applied. */
  freezeConfidence?: "confirmed" | "likely" | "possible" | null
  now?: Date
}

/**
 * Probe the apply URL to determine liveness.
 * Uses a HEAD request with a 5-second timeout.
 * Never throws — returns "unknown" on any error.
 */
export async function probeApplyUrl(url: string | null | undefined): Promise<ApplyUrlStatus> {
  if (!url) return "unknown"
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    let status: number
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
      })
      status = res.status
    } finally {
      clearTimeout(timer)
    }
    if (status === 200 || status === 204) return "ok"
    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) return "redirect"
    if (status === 404 || status === 410 || status === 403 || status === 401) return "dead"
    return "unknown"
  } catch {
    return "unknown"
  }
}

export type GhostJobRiskResult = {
  riskScore: number | null
  label: GhostJobRiskLabel
  riskLevel: IntelligenceRiskLevel
  freshnessDays: number | null
  repostCount: number | null
  reasons: string[]
  recommendedAction: string
  signals: IntelligenceSignal[]
  summary: string | null
}

const HIGH_RELIABILITY_ATS = new Set(["greenhouse", "lever", "ashby", "workday", "icims", "jobvite"])

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))

const parseDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

const daysBetween = (from: Date | null, to: Date): number | null => {
  if (!from) return null
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000))
}

const normalizeStatus = (status: CalculateGhostJobRiskInput["applyUrlStatus"]): ApplyUrlStatus => {
  if (status === "ok" || status === "dead" || status === "redirect" || status === "unknown") return status
  const text = typeof status === "string" ? status.toLowerCase() : ""
  if (/404|410|dead|expired|closed|not_found|not found/.test(text)) return "dead"
  if (/200|ok|active|valid|reachable/.test(text)) return "ok"
  if (/redirect|301|302/.test(text)) return "redirect"
  return "unknown"
}

const clampCount = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
  return Math.floor(value)
}

const hostFromUrl = (url: string | null | undefined): string | null => {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return null
  }
}

const isDirectCompanyLink = (applyUrl: string | null | undefined, companyDomain: string | null | undefined): boolean => {
  const applyHost = hostFromUrl(applyUrl)
  const companyHost = companyDomain?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]?.toLowerCase()
  return Boolean(applyHost && companyHost && (applyHost === companyHost || applyHost.endsWith(`.${companyHost}`)))
}

const isKnownAtsLink = (applyUrl: string | null | undefined, atsType: string | null | undefined): boolean => {
  const host = hostFromUrl(applyUrl)
  const ats = atsType?.toLowerCase() ?? ""
  if (!host) return false
  return (
    /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|icims\.com|jobvite\.com/.test(host) ||
    HIGH_RELIABILITY_ATS.has(ats)
  )
}

const descriptionQualityPenalty = (description: string | null | undefined): { penalty: number; reason: string | null } => {
  const text = description?.replace(/\s+/g, " ").trim() ?? ""
  if (!text) return { penalty: 10, reason: "Job description is missing or unavailable." }
  if (text.length < 280) return { penalty: 8, reason: "Job description is unusually short." }
  const vagueTerms = ["fast-paced", "rockstar", "ninja", "wear many hats", "self starter", "competitive salary"]
  const vagueCount = vagueTerms.filter((term) => text.toLowerCase().includes(term)).length
  if (vagueCount >= 2) return { penalty: 5, reason: "Description uses multiple vague or generic hiring phrases." }
  return { penalty: 0, reason: null }
}

const labelForScore = (score: number | null): GhostJobRiskLabel => {
  if (score == null) return "Unknown"
  if (score >= 70) return "High"
  if (score >= 40) return "Medium"
  return "Low"
}

const riskLevelForLabel = (label: GhostJobRiskLabel): IntelligenceRiskLevel =>
  label === "High" ? "high" : label === "Medium" ? "medium" : label === "Low" ? "low" : "unknown"

const actionForLabel = (label: GhostJobRiskLabel): string => {
  if (label === "High") return "Verify the role on the company careers page before spending time tailoring an application."
  if (label === "Medium") return "Apply only after checking that the posting is still active and not duplicated elsewhere."
  if (label === "Low") return "Looks reasonably fresh. Apply normally, but still confirm details on the source posting."
  return "Not enough freshness or source data yet. Confirm the job on the employer site before applying."
}

export function calculateGhostJobRisk(input: CalculateGhostJobRiskInput): GhostJobRiskResult {
  const now = input.now ?? new Date()
  const postedDate = parseDate(input.postedAt)
  const verifiedDate = parseDate(input.lastVerifiedAt)
  const freshnessDays = daysBetween(postedDate, now)
  const verifiedDays = daysBetween(verifiedDate, now)
  const repostCount = clampCount(input.repostCount ?? input.timesSeen)
  const locationCount = clampCount(input.locationCount)
  const duplicateCount = clampCount(input.duplicateCount)
  const applyStatus = normalizeStatus(input.applyUrlStatus)
  const directCompanyLink = isDirectCompanyLink(input.applyUrl, input.companyDomain)
  const knownAtsLink = isKnownAtsLink(input.applyUrl, input.atsType)
  const reasons: string[] = []
  const positiveSignals: string[] = []
  let score = 25
  let coverage = 0

  if (freshnessDays !== null) {
    coverage += 1
    if (freshnessDays <= 14) {
      score -= 12
      positiveSignals.push("Posting is recently detected.")
    } else if (freshnessDays <= 45) {
      score += 4
    } else if (freshnessDays <= 90) {
      score += 16
      reasons.push(`Posting is ${freshnessDays} days old.`)
    } else {
      score += 28
      reasons.push(`Posting is very old (${freshnessDays} days).`)
    }
  }

  if (verifiedDays !== null) {
    coverage += 1
    if (verifiedDays <= 7) {
      score -= 12
      positiveSignals.push("Posting was recently verified.")
    } else if (verifiedDays > 30) {
      score += 10
      reasons.push(`Posting has not been verified in ${verifiedDays} days.`)
    }
  }

  if (applyStatus !== "unknown") {
    coverage += 1
    if (applyStatus === "dead") {
      score += 35
      reasons.push("Apply URL appears closed, expired, or unreachable.")
    } else if (applyStatus === "ok") {
      score -= 12
      positiveSignals.push("Apply URL appears reachable.")
    } else if (applyStatus === "redirect") {
      score += 4
      reasons.push("Apply URL redirects; verify that it still lands on the correct role.")
    }
  }

  if (repostCount !== null) {
    coverage += 1
    if (repostCount >= 5) {
      score += 18
      reasons.push(`Role has been seen or reposted ${repostCount} times.`)
    } else if (repostCount >= 3) {
      score += 10
      reasons.push(`Role has appeared multiple times (${repostCount}).`)
    }
  }

  if (locationCount !== null) {
    coverage += 1
    if (locationCount >= 8 && !input.isRemote) {
      score += 12
      reasons.push(`Same role appears across ${locationCount} locations without a clear remote/national signal.`)
    } else if (locationCount >= 8 && input.isRemote) {
      score += 2
      positiveSignals.push("Many locations appear tied to a remote or national role.")
    }
  }

  if (duplicateCount !== null) {
    coverage += 1
    if (duplicateCount >= 5) {
      score += 18
      reasons.push(`Detected ${duplicateCount} similar title/company/location records.`)
    } else if (duplicateCount >= 2) {
      score += 8
      reasons.push("Similar duplicate records were detected.")
    }
  }

  const quality = descriptionQualityPenalty(input.description)
  if (quality.reason) reasons.push(quality.reason)
  score += quality.penalty

  if (input.salaryMin == null && input.salaryMax == null) {
    score += 3
    reasons.push("Salary is not listed. This is a weak signal by itself.")
  }

  if (directCompanyLink) {
    coverage += 1
    score -= 10
    positiveSignals.push("Apply link points to the company domain.")
  } else if (knownAtsLink) {
    coverage += 1
    score -= 8
    positiveSignals.push("Apply link points to a known ATS source.")
  } else if (input.applyUrl) {
    coverage += 1
    score += 4
    reasons.push("Apply link is not clearly tied to the company domain or a known ATS.")
  }

  const ats = input.atsType?.toLowerCase() ?? null
  if (ats) {
    coverage += 1
    if (HIGH_RELIABILITY_ATS.has(ats)) {
      score -= 6
      positiveSignals.push(`${input.atsType} source is generally reliable for live postings.`)
    } else if (ats === "custom") {
      score += 3
      reasons.push("Custom ATS source has less standardized freshness data.")
    }
  }

  if (input.hasHiringFreeze) {
    coverage += 1
    const freezeWeight =
      input.freezeConfidence === "confirmed" ? 20 :
      input.freezeConfidence === "likely" ? 16 : 10
    score += freezeWeight
    const confidenceLabel =
      input.freezeConfidence === "confirmed" ? " (WARN Act verified)" :
      input.freezeConfidence === "likely" ? " (layoffs.fyi reported)" : ""
    reasons.push(`Company may have an active hiring freeze${confidenceLabel} — role may not be actively filling.`)
  }

  if (coverage === 0 && !input.description && !input.applyUrl) {
    return {
      riskScore: null,
      label: "Unknown",
      riskLevel: "unknown",
      freshnessDays,
      repostCount,
      reasons: ["Not enough source or freshness signals to estimate ghost-job risk."],
      recommendedAction: actionForLabel("Unknown"),
      signals: [],
      summary: "Ghost-job risk is unknown because freshness and source signals are missing.",
    }
  }

  const riskScore = clampScore(score)
  const label = labelForScore(riskScore)
  const riskLevel = riskLevelForLabel(label)
  const signals: IntelligenceSignal[] = [
    ...positiveSignals.map((label) => ({
      label,
      detail: null,
      impact: "positive" as const,
      source: "system" as const,
      confidence: "medium" as const,
    })),
    ...reasons.map((label) => ({
      label,
      detail: null,
      impact: "negative" as const,
      source: "system" as const,
      confidence: "medium" as const,
    })),
  ]

  return {
    riskScore,
    label,
    riskLevel,
    freshnessDays,
    repostCount,
    reasons,
    recommendedAction: actionForLabel(label),
    signals,
    summary: `${label} ghost-job risk based on freshness, source, duplication, and description signals.`,
  }
}

export function ghostJobRiskResultToIntelligence(result: GhostJobRiskResult, lastSeenAt: string | null): GhostJobRisk {
  return {
    score: result.riskScore,
    riskLevel: result.riskLevel,
    freshnessDays: result.freshnessDays,
    repostCount: result.repostCount,
    lastSeenAt,
    reasons: result.reasons,
    recommendedAction: result.recommendedAction,
    signals: result.signals,
    summary: result.summary,
  }
}

import type { CapExemptSignal, Company, IntelligenceConfidence, Job } from "@/types"

export type CapExemptDetectionCategory = CapExemptSignal["category"]

export type CapExemptDetectionResult = {
  possibleCapExempt: boolean
  category: CapExemptDetectionCategory
  confidence: IntelligenceConfidence
  reasons: string[]
  warnings: string[]
}

type CompanyLike = Partial<Company> | null | undefined
type JobLike = Partial<Job> | null | undefined

type Candidate = {
  category: Exclude<CapExemptDetectionCategory, "unknown">
  confidence: IntelligenceConfidence
  reason: string
  warning?: string
  weight: number
}

const normalize = (value: unknown): string =>
  typeof value === "string" ? value.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim() : ""

const stringifyRecord = (value: unknown): string => {
  if (!value || typeof value !== "object") return ""
  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

const confidenceRank: Record<IntelligenceConfidence, number> = {
  high: 4,
  medium: 3,
  low: 2,
  unknown: 1,
}

const pickBest = (candidates: Candidate[]): Candidate | null => {
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight
    return confidenceRank[b.confidence] - confidenceRank[a.confidence]
  })[0]
}

export function detectCapExemptSignal(company?: CompanyLike, job?: JobLike): CapExemptDetectionResult {
  const companyText = normalize(
    [
      company?.name,
      company?.domain,
      company?.industry,
      company?.careers_url,
      company?.notes,
      stringifyRecord(company?.raw_ats_config),
    ]
      .filter(Boolean)
      .join(" ")
  )
  const jobText = normalize([job?.title, job?.department, job?.description, job?.location].filter(Boolean).join(" "))
  const text = `${companyText} ${jobText}`.trim()
  const candidates: Candidate[] = []

  if (!text) {
    return {
      possibleCapExempt: false,
      category: "unknown",
      confidence: "unknown",
      reasons: [],
      warnings: ["Insufficient employer text to evaluate cap-exempt-friendly patterns."],
    }
  }

  if (/\b(university|college|school of medicine|academic institution)\b/.test(text)) {
    candidates.push({
      category: "higher_education",
      confidence: "high",
      reason: "Employer text includes a university, college, or academic institution pattern.",
      weight: 95,
    })
  }

  if (/\b(national laboratory|national lab|federal laboratory|government research)\b/.test(text)) {
    candidates.push({
      category: "national_laboratory",
      confidence: "high",
      reason: "Employer text includes a national laboratory or government research pattern.",
      weight: 92,
    })
  }

  if (/\b(research foundation|nonprofit research|not-for-profit research|non-profit research)\b/.test(text)) {
    candidates.push({
      category: "nonprofit_research",
      confidence: "medium",
      reason: "Employer text includes a nonprofit research organization pattern.",
      warning: "Nonprofit research status should be verified from employer records before relying on it.",
      weight: 82,
    })
  }

  if (/\b(research institute|institute for|institute of|research center|research centre)\b/.test(text)) {
    candidates.push({
      category: "nonprofit_research",
      confidence: "medium",
      reason: "Employer text includes a research institute or research center pattern.",
      warning: "Research institute wording is a discovery signal only; nonprofit affiliation is not confirmed.",
      weight: 74,
    })
  }

  const hasHospitalPattern = /\b(children's hospital|childrens hospital|children hospital|medical center|academic medical center|university hospital|hospital)\b/.test(text)
  const hasUniversityAffiliation = /\b(university affiliated|affiliated with .*university|university .*hospital|academic medical center|school of medicine)\b/.test(text)

  if (hasHospitalPattern && hasUniversityAffiliation) {
    candidates.push({
      category: "academic_medical_center",
      confidence: "medium",
      reason: "Employer text suggests a hospital or medical center with academic/university affiliation.",
      warning: "Hospital affiliation should be verified; not every hospital-related role is cap-exempt.",
      weight: 78,
    })
  } else if (hasHospitalPattern) {
    candidates.push({
      category: "academic_medical_center",
      confidence: "low",
      reason: "Employer text includes a hospital or medical center pattern.",
      warning: "Hospital wording alone does not confirm a cap-exempt pathway; university affiliation is not confirmed.",
      weight: 48,
    })
  }

  if (/\b(affiliated nonprofit|university affiliate|university-affiliated nonprofit)\b/.test(text)) {
    candidates.push({
      category: "affiliated_nonprofit",
      confidence: "medium",
      reason: "Employer text includes an affiliated nonprofit pattern.",
      warning: "Affiliation should be verified before treating this as a cap-exempt path.",
      weight: 76,
    })
  }

  const best = pickBest(candidates)
  if (!best) {
    return {
      possibleCapExempt: false,
      category: "unknown",
      confidence: "unknown",
      reasons: [],
      warnings: ["No cap-exempt-friendly employer pattern was detected from available text."],
    }
  }

  return {
    possibleCapExempt: true,
    category: best.category,
    confidence: best.confidence,
    reasons: candidates
      .sort((a, b) => b.weight - a.weight)
      .map((candidate) => candidate.reason),
    warnings: candidates.map((candidate) => candidate.warning).filter((warning): warning is string => Boolean(warning)),
  }
}

export function capExemptDetectionToSignal(result: CapExemptDetectionResult): CapExemptSignal {
  const likelihood: CapExemptSignal["likelihood"] =
    result.possibleCapExempt
      ? result.confidence === "high"
        ? "likely"
        : "possible"
      : result.confidence === "unknown"
        ? "unknown"
        : "unlikely"

  return {
    likelihood,
    source: result.possibleCapExempt ? "inferred" : "none",
    isLikelyCapExempt: result.possibleCapExempt ? true : null,
    category: result.category,
    confidence: result.confidence,
    evidence: result.reasons,
    summary: result.possibleCapExempt
      ? "Cap-exempt likelihood inferred from employer naming or affiliation signals. This is not a legal conclusion."
      : "Cap-exempt likelihood is unknown from available data.",
  }
}

import type {
  IntelligenceConfidence,
  LcaSalaryComparisonLabel,
  LcaSalaryIntelligence,
  LcaSalaryPosition,
  LcaWageRecord,
} from "@/types"

export type CalculateLcaSalaryIntelligenceInput = {
  salaryMin?: number | null
  salaryMax?: number | null
  jobTitle?: string | null
  companyName?: string | null
  location?: string | null
  roleFamily?: string | null
  records?: LcaWageRecord[] | null
}

const ANNUALIZATION_FACTORS: Record<string, number> = {
  year: 1,
  yr: 1,
  annual: 1,
  hour: 2_080,
  hourly: 2_080,
  month: 12,
  monthly: 12,
  week: 52,
  weekly: 52,
  "bi-weekly": 26,
  biweekly: 26,
}

const MARKET_TOLERANCE = 0.05

const clampScore = (value: number): number => Math.min(100, Math.max(0, Math.round(value)))

const normalizeText = (value: string | null | undefined): string =>
  value?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? ""

const isFinitePositive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0

const annualizeWageValue = (value: number | null | undefined, unit: string | null | undefined): number | null => {
  if (!isFinitePositive(value)) {
    return null
  }

  const normalizedUnit = normalizeText(unit ?? "year")
  const factor = ANNUALIZATION_FACTORS[normalizedUnit] ?? 1
  return Math.round(value * factor)
}

const annualizeWageRange = (record: LcaWageRecord): { low: number; high: number; midpoint: number } | null => {
  const low = isFinitePositive(record.wageRateFrom)
    ? record.wageRateFrom
    : isFinitePositive(record.prevailingWage)
      ? record.prevailingWage
      : null

  if (low === null) {
    return null
  }

  const high = isFinitePositive(record.wageRateTo) ? record.wageRateTo : low
  const annualLow = annualizeWageValue(low, record.wageUnit)
  const annualHigh = annualizeWageValue(high, record.wageUnit)

  if (annualLow === null || annualHigh === null) {
    return null
  }

  return {
    low: Math.min(annualLow, annualHigh),
    high: Math.max(annualLow, annualHigh),
    midpoint: Math.round((annualLow + annualHigh) / 2),
  }
}

const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

const mode = (values: Array<string | null | undefined>): string | null => {
  const counts = new Map<string, number>()

  for (const raw of values) {
    const value = raw?.trim()
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  let best: string | null = null
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }

  return best
}

const recordMatchesContext = (
  record: LcaWageRecord,
  input: CalculateLcaSalaryIntelligenceInput
): boolean => {
  const company = normalizeText(input.companyName)
  const roleFamily = normalizeText(input.roleFamily)
  const location = normalizeText(input.location)
  const title = normalizeText(input.jobTitle)

  const recordCompany = normalizeText(record.employerName)
  const recordRole = normalizeText(record.roleFamily)
  const recordTitle = normalizeText(record.jobTitle)
  const recordLocation = normalizeText(record.location ?? record.worksiteState)

  const companyMatches = !company || !recordCompany || recordCompany.includes(company) || company.includes(recordCompany)
  const roleMatches =
    !roleFamily ||
    (recordRole.length > 0 && (recordRole.includes(roleFamily) || roleFamily.includes(recordRole))) ||
    (recordTitle.length > 0 && recordTitle.includes(roleFamily)) ||
    title
      .split(" ")
      .filter((part) => part.length > 3)
      .some((part) => recordTitle.includes(part))
  const locationMatches = !location || !recordLocation || location.includes(recordLocation) || recordLocation.includes(location)

  return companyMatches && roleMatches && locationMatches
}

const confidenceFor = (recordCount: number, hasSalary: boolean, latestYear: number | null): IntelligenceConfidence => {
  if (!hasSalary || recordCount === 0) {
    return "low"
  }

  const currentYear = new Date().getFullYear()
  const isRecent = latestYear !== null && currentYear - latestYear <= 2

  if (recordCount >= 10 && isRecent) {
    return "high"
  }

  if (recordCount >= 3 || isRecent) {
    return "medium"
  }

  return "low"
}

const compareSalary = (
  listedMin: number | null,
  listedMax: number | null,
  historicalMin: number,
  historicalMax: number
): { label: LcaSalaryComparisonLabel; position: LcaSalaryPosition; score: number } => {
  const listedLow = listedMin ?? listedMax
  const listedHigh = listedMax ?? listedMin

  if (!isFinitePositive(listedLow) || !isFinitePositive(listedHigh)) {
    return { label: "Unknown", position: "unknown", score: 50 }
  }

  if (listedHigh < historicalMin * (1 - MARKET_TOLERANCE)) {
    return { label: "Below Market", position: "below_range", score: 30 }
  }

  if (listedLow > historicalMax * (1 + MARKET_TOLERANCE)) {
    return { label: "Above Market", position: "above_range", score: 78 }
  }

  return { label: "Aligned", position: "within_range", score: 70 }
}

const baseResult = (
  input: CalculateLcaSalaryIntelligenceInput,
  explanation: string
): LcaSalaryIntelligence => ({
  salaryFitScore: null,
  position: "unknown",
  offeredSalaryMin: input.salaryMin ?? null,
  offeredSalaryMax: input.salaryMax ?? null,
  historicalRangeMin: null,
  historicalRangeMax: null,
  medianWage: null,
  commonWageLevel: null,
  comparisonLabel: "Unknown",
  prevailingWage: null,
  lcaWagePercentile: null,
  comparableLcaCount: 0,
  wageLevel: null,
  socCode: null,
  socTitle: null,
  worksiteState: null,
  confidence: "low",
  explanation,
  summary: explanation,
})

export const calculateLcaSalaryIntelligence = (
  input: CalculateLcaSalaryIntelligenceInput
): LcaSalaryIntelligence => {
  const hasListedSalary = isFinitePositive(input.salaryMin) || isFinitePositive(input.salaryMax)

  if (!hasListedSalary) {
    return baseResult(input, "Listed salary is missing, so LCA wage alignment cannot be compared yet.")
  }

  const allRecords = input.records ?? []
  const matchedRecords = allRecords.filter((record) => recordMatchesContext(record, input))
  const recordsToUse = matchedRecords.length > 0 ? matchedRecords : allRecords
  const wageRanges = recordsToUse.map(annualizeWageRange).filter((range): range is NonNullable<typeof range> => Boolean(range))

  if (wageRanges.length === 0) {
    return baseResult(input, "No comparable LCA wage records are available for this company, role, or location yet.")
  }

  const historicalRangeMin = Math.min(...wageRanges.map((range) => range.low))
  const historicalRangeMax = Math.max(...wageRanges.map((range) => range.high))
  const medianWage = median(wageRanges.map((range) => range.midpoint))
  const commonWageLevel = mode(recordsToUse.map((record) => record.wageLevel))
  const latestYear = recordsToUse.reduce<number | null>((latest, record) => {
    if (!isFinitePositive(record.fiscalYear)) return latest
    return latest === null || record.fiscalYear > latest ? record.fiscalYear : latest
  }, null)
  const comparison = compareSalary(
    input.salaryMin ?? null,
    input.salaryMax ?? null,
    historicalRangeMin,
    historicalRangeMax
  )
  const confidence = confidenceFor(wageRanges.length, hasListedSalary, latestYear)
  const explanation =
    comparison.label === "Aligned"
      ? "Listed salary overlaps the historical LCA wage range for comparable sponsored roles."
      : comparison.label === "Below Market"
        ? "Listed salary is below the historical LCA wage range for comparable sponsored roles."
        : comparison.label === "Above Market"
          ? "Listed salary is above the historical LCA wage range for comparable sponsored roles."
          : "LCA wage alignment is unknown."

  return {
    salaryFitScore: clampScore(comparison.score + (confidence === "high" ? 8 : confidence === "medium" ? 3 : 0)),
    position: comparison.position,
    offeredSalaryMin: input.salaryMin ?? null,
    offeredSalaryMax: input.salaryMax ?? null,
    historicalRangeMin,
    historicalRangeMax,
    medianWage,
    commonWageLevel,
    comparisonLabel: comparison.label,
    prevailingWage: medianWage,
    lcaWagePercentile: null,
    comparableLcaCount: wageRanges.length,
    wageLevel: commonWageLevel,
    socCode: null,
    socTitle: null,
    worksiteState: mode(recordsToUse.map((record) => record.worksiteState)),
    confidence,
    explanation,
    summary: explanation,
  }
}


import {
  createCompanyHiringHealthFallback,
  createCompanyImmigrationProfileFallback,
} from "@/lib/jobs/intelligence"
import { capExemptDetectionToSignal, detectCapExemptSignal } from "@/lib/jobs/cap-exempt-signal"
import type {
  CapExemptSignal,
  Company,
  CompanyHiringHealth,
  CompanyImmigrationProfile,
  CompanyImmigrationProfileSummary,
  CompanyLcaRoleFamily,
  CompanyLcaWorksite,
  CompanySalaryIntelligenceSummary,
  CompanyStemOptReadinessSummary,
  IntelligenceConfidence,
} from "@/types"

type JsonRecord = Record<string, unknown>

export type CompanyProfileLcaStats = {
  total_applications: number | null
  total_certified: number | null
  total_denied: number | null
  certification_rate: number | null
  approval_trend: string | null
  has_high_denial_rate: boolean | null
  top_job_titles: unknown
  top_states: unknown
  stats_by_wage_level: unknown
}

export type CompanyProfileSalaryStats = {
  sample_size: number | null
  median_wage: number | null
  wage_min: number | null
  wage_max: number | null
  common_wage_level: string | null
}

export type CompanyProfileJobSignal = {
  activeJobCount: number
  recentJobCount: number
  stemRoleCount: number
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const asPercent = (value: number | null | undefined): number | null => {
  if (value == null || !Number.isFinite(value)) return null
  return value > 1 ? Math.round(value) : Math.round(value * 100)
}

const confidenceFromCount = (count: number | null | undefined): IntelligenceConfidence => {
  if (count == null || count <= 0) return "unknown"
  if (count >= 25) return "high"
  if (count >= 5) return "medium"
  return "low"
}

const normalizeTopItems = (
  value: unknown,
  labelKeys: string[],
  countKeys: string[],
  max = 6
): Array<{ label: string; count: number | null }> => {
  const array = Array.isArray(value) ? value : []
  return array
    .map((item) => {
      if (typeof item === "string") return { label: item, count: null }
      if (!isRecord(item)) return null
      const label = labelKeys.map((key) => asString(item[key])).find(Boolean) ?? null
      if (!label) return null
      const count = countKeys.map((key) => asNumber(item[key])).find((n) => n != null) ?? null
      return { label, count }
    })
    .filter((item): item is { label: string; count: number | null } => Boolean(item))
    .slice(0, max)
}

export function buildCompanyImmigrationProfile(input: {
  company: Company
  lcaStats: CompanyProfileLcaStats | null
  salaryStats: CompanyProfileSalaryStats | null
  jobSignal: CompanyProfileJobSignal
  similarCompanyIds?: string[]
}): CompanyImmigrationProfile {
  const { company, lcaStats, salaryStats, jobSignal } = input
  const storedProfile = company.immigration_profile_summary ?? null
  const baseProfile = createCompanyImmigrationProfileFallback(company)
  const totalLca = lcaStats?.total_applications ?? storedProfile?.totalLcaApplications ?? baseProfile.totalLcaApplications
  const recentH1B =
    storedProfile?.recentH1BPetitions ?? company.h1b_sponsor_count_1yr ?? baseProfile.recentH1BPetitions
  const certificationRate =
    lcaStats?.certification_rate ?? storedProfile?.lcaCertificationRate ?? baseProfile.lcaCertificationRate
  const sponsorsH1b = storedProfile?.sponsorsH1b ?? company.sponsors_h1b ?? null
  const sponsorshipConfidence =
    storedProfile?.sponsorshipConfidence ?? company.sponsorship_confidence ?? baseProfile.sponsorshipConfidence

  const topTitles = normalizeTopItems(lcaStats?.top_job_titles, ["title", "job_title", "label", "name"], ["count", "total"])
  const roleFamilies: CompanyLcaRoleFamily[] = topTitles.map((item) => ({
    label: item.label,
    count: item.count,
    share: totalLca && item.count ? Math.round((item.count / totalLca) * 100) : null,
    recentFiscalYear: null,
    confidence: confidenceFromCount(item.count),
  }))

  const topStates = normalizeTopItems(lcaStats?.top_states, ["state", "label", "name", "worksite_state"], ["count", "total"])
  const worksites: CompanyLcaWorksite[] = topStates.map((item) => ({
    label: item.label,
    state: item.label.length <= 2 ? item.label.toUpperCase() : null,
    count: item.count,
    share: totalLca && item.count ? Math.round((item.count / totalLca) * 100) : null,
    confidence: confidenceFromCount(item.count),
  }))

  const salarySampleSize = salaryStats?.sample_size ?? null
  const salaryIntelligence: CompanySalaryIntelligenceSummary = {
    medianWage: salaryStats?.median_wage ?? null,
    rangeMin: salaryStats?.wage_min ?? null,
    rangeMax: salaryStats?.wage_max ?? null,
    commonWageLevel: salaryStats?.common_wage_level ?? null,
    sampleSize: salarySampleSize,
    confidence: confidenceFromCount(salarySampleSize),
    summary:
      salarySampleSize && salaryStats?.median_wage
        ? "Historical LCA wage data is available for prior sponsored roles at this employer."
        : "Salary intelligence is unknown until comparable LCA wage records are connected.",
  }

  const hasStemRoleHistory = jobSignal.stemRoleCount > 0 || roleFamilies.some((r) => /software|data|engineer|scientist|analyst|developer/i.test(r.label))
  const stemOptReadiness: CompanyStemOptReadinessSummary = {
    likelyEVerify: null,
    hasStemRoleHistory: hasStemRoleHistory || null,
    readiness: hasStemRoleHistory ? "possible" : "unknown",
    confidence: hasStemRoleHistory ? "low" : "unknown",
    summary: hasStemRoleHistory
      ? "This employer has technology or STEM-adjacent role signals. E-Verify and I-983 support are not confirmed."
      : "STEM OPT readiness is unknown because E-Verify and training-plan signals are not connected yet.",
  }

  const hiringHealth: CompanyHiringHealth = company.hiring_health ?? {
    ...createCompanyHiringHealthFallback(company),
    activeJobCount: jobSignal.activeJobCount,
    recentJobCount: jobSignal.recentJobCount,
    status: jobSignal.activeJobCount >= 20 ? "growing" : jobSignal.activeJobCount > 0 ? "steady" : "unknown",
    sponsorshipTrend:
      lcaStats?.approval_trend === "improving" || lcaStats?.approval_trend === "declining"
        ? lcaStats.approval_trend
        : lcaStats?.approval_trend === "stable"
          ? "stable"
          : "unknown",
    lcaCertificationRate: certificationRate,
    summary:
      jobSignal.activeJobCount > 0
        ? `${company.name} currently has ${jobSignal.activeJobCount} open role${jobSignal.activeJobCount === 1 ? "" : "s"} tracked by Hireoven.`
        : "No active hiring signal is currently confirmed.",
  }

  const sponsorshipHistory: CompanyImmigrationProfileSummary = {
    sponsorsH1b,
    sponsorshipConfidence,
    recentH1BPetitions: recentH1B,
    totalLcaApplications: totalLca,
    lcaCertificationRate: certificationRate,
    commonSocCodes: storedProfile?.commonSocCodes ?? [],
    commonJobTitles: storedProfile?.commonJobTitles?.length ? storedProfile.commonJobTitles : roleFamilies.map((r) => r.label),
    commonWorksiteStates: storedProfile?.commonWorksiteStates?.length ? storedProfile.commonWorksiteStates : worksites.map((w) => w.label),
    riskFlags: [
      ...(storedProfile?.riskFlags ?? []),
      ...(lcaStats?.has_high_denial_rate ? ["Elevated denial-rate signal in historical LCA data."] : []),
    ],
    lastUpdatedAt: storedProfile?.lastUpdatedAt ?? null,
    summary:
      storedProfile?.summary ??
      (totalLca && totalLca > 0
        ? `${company.name} has historical LCA records on file. Sponsorship is a historical signal, not a promise for future roles.`
        : `Hireoven has not confirmed a meaningful LCA history for ${company.name} yet.`),
  }

  const rolesText = roleFamilies.length > 0
    ? roleFamilies.slice(0, 4).map((role) => role.label).join(", ")
    : "not enough role-family data is available yet"

  return {
    companyId: company.id,
    companyName: company.name,
    overviewSummary: `${company.name} is tracked by Hireoven for open roles, sponsorship history, salary signals, and hiring activity. Immigration signals are based on historical public data where available and are not confirmation of current sponsorship policy.`,
    sponsorshipHistory,
    roleFamilies,
    worksites,
    salaryIntelligence,
    stemOptReadiness,
    capExempt: capExemptDetectionToSignal(detectCapExemptSignal(company)),
    hiringHealth,
    similarCompanyIds: input.similarCompanyIds ?? [],
    faq: {
      h1b:
        sponsorsH1b === true || (sponsorshipConfidence ?? 0) >= 60
          ? `${company.name} has a historical H-1B/LCA sponsorship signal. This does not confirm that every current role sponsors.`
          : `Hireoven has not confirmed a strong H-1B sponsorship signal for ${company.name} yet.`,
      opt: `${company.name} may hire OPT students when a role and work-authorization policy fit. Hireoven has not confirmed OPT support unless the job posting or employer data says so.`,
      stemOpt:
        stemOptReadiness.readiness === "possible"
          ? `${company.name} has STEM-adjacent role signals, but STEM OPT support depends on E-Verify status and training-plan support.`
          : `STEM OPT support at ${company.name} is unknown from the current data.`,
      sponsoredRoles: `Historically sponsored role families for ${company.name}: ${rolesText}.`,
    },
  }
}

export function getProfileConfidenceLabel(confidence: IntelligenceConfidence): string {
  return confidence === "high"
    ? "High confidence"
    : confidence === "medium"
      ? "Medium confidence"
      : confidence === "low"
        ? "Low confidence"
        : "Unknown confidence"
}

export function formatProfilePercent(value: number | null | undefined): string {
  const percent = asPercent(value)
  return percent == null ? "Unknown" : `${percent}%`
}

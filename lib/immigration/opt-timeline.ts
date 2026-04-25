import type {
  OptTimelineDashboard,
  OptTimelineEmploymentStatus,
  OptTimelineFallbackCategory,
  OptTimelineImmigrationStatus,
  OptTimelineSettings,
  OptTimelineUrgencyLevel,
  Profile,
  VisaStatus,
} from "@/types"

const MS_PER_DAY = 24 * 60 * 60 * 1000
const OPT_UNEMPLOYMENT_LIMIT_DAYS = 90
const STEM_OPT_UNEMPLOYMENT_LIMIT_DAYS = 150
const DEFAULT_WEEKLY_APPLICATION_GOAL = 20

const DISCLAIMER =
  "This timeline is job-search planning guidance, not legal advice. Confirm dates and unemployment calculations with your DSO or immigration counsel."

export type CalculateOptTimelineInput = OptTimelineSettings & {
  asOf?: Date | string
}

const clampNonNegativeInt = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value))
}

const toDateOnly = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

const daysUntil = (endDate: string | null, asOf: Date): number | null => {
  const end = toDateOnly(endDate)
  if (!end) return null
  const today = toDateOnly(asOf)
  if (!today) return null
  return Math.max(0, Math.ceil((end.getTime() - today.getTime()) / MS_PER_DAY))
}

const getCurrentAuthorizationPeriod = (
  status: OptTimelineImmigrationStatus,
  asOf: Date,
  input: Pick<OptTimelineSettings, "optStartDate" | "optEndDate" | "stemOptStartDate" | "stemOptEndDate">
): OptTimelineDashboard["currentAuthorizationPeriod"] => {
  if (status === "F1_STEM_OPT") return "STEM_OPT"
  if (status === "F1_OPT") return "OPT"
  if (status !== "Other") return "not_tracked"

  const today = toDateOnly(asOf)
  const optStart = toDateOnly(input.optStartDate)
  const optEnd = toDateOnly(input.optEndDate)
  const stemStart = toDateOnly(input.stemOptStartDate)
  const stemEnd = toDateOnly(input.stemOptEndDate)

  if (today && stemStart && stemEnd && today >= stemStart && today <= stemEnd) return "STEM_OPT"
  if (today && optStart && optEnd && today >= optStart && today <= optEnd) return "OPT"
  return "unknown"
}

const getAuthorizationEndDate = (
  period: OptTimelineDashboard["currentAuthorizationPeriod"],
  input: Pick<OptTimelineSettings, "optEndDate" | "stemOptEndDate">
): string | null => {
  if (period === "STEM_OPT") return input.stemOptEndDate
  if (period === "OPT") return input.optEndDate
  return null
}

const unemploymentLimitFor = (
  period: OptTimelineDashboard["currentAuthorizationPeriod"]
): number | null => {
  if (period === "STEM_OPT") return STEM_OPT_UNEMPLOYMENT_LIMIT_DAYS
  if (period === "OPT") return OPT_UNEMPLOYMENT_LIMIT_DAYS
  return null
}

const calculateUrgency = ({
  daysRemaining,
  unemploymentDaysRemaining,
  employmentStatus,
}: {
  daysRemaining: number | null
  unemploymentDaysRemaining: number | null
  employmentStatus: OptTimelineEmploymentStatus
}): OptTimelineUrgencyLevel => {
  if (
    (daysRemaining != null && daysRemaining <= 14) ||
    (unemploymentDaysRemaining != null && unemploymentDaysRemaining <= 7)
  ) {
    return "Emergency"
  }

  if (
    (daysRemaining != null && daysRemaining <= 45) ||
    (unemploymentDaysRemaining != null && unemploymentDaysRemaining <= 21)
  ) {
    return "High"
  }

  if (
    (daysRemaining != null && daysRemaining <= 90) ||
    (unemploymentDaysRemaining != null && unemploymentDaysRemaining <= 45) ||
    employmentStatus === "unemployed"
  ) {
    return "Medium"
  }

  return "Low"
}

const recommendWeeklyTarget = (
  urgency: OptTimelineUrgencyLevel,
  targetWeeklyApplicationGoal: number | null
): number => {
  const base = clampNonNegativeInt(targetWeeklyApplicationGoal) ?? DEFAULT_WEEKLY_APPLICATION_GOAL
  const floorByUrgency: Record<OptTimelineUrgencyLevel, number> = {
    Low: 12,
    Medium: 25,
    High: 40,
    Emergency: 60,
  }
  return Math.max(base, floorByUrgency[urgency])
}

const recommendStrategy = (urgency: OptTimelineUrgencyLevel): string => {
  switch (urgency) {
    case "Emergency":
      return "Prioritize fast-moving, high-confidence roles, contact warm referrals daily, and review timeline assumptions with your DSO before making decisions."
    case "High":
      return "Focus on sponsor-friendly employers, roles matching your strongest skills, and applications where you can reach a recruiter or referral quickly."
    case "Medium":
      return "Keep a consistent weekly application rhythm while improving resume targeting and building a shortlist of employers with stronger work-authorization signals."
    case "Low":
    default:
      return "Maintain steady applications, build referrals, and track sponsor-friendly employers before the timeline becomes urgent."
  }
}

const recommendFallbackCategories = (
  urgency: OptTimelineUrgencyLevel,
  status: OptTimelineImmigrationStatus
): OptTimelineFallbackCategory[] => {
  if (status === "Citizen" || status === "GC") return ["non_visa_sensitive_roles"]

  const common: OptTimelineFallbackCategory[] = [
    "sponsor_friendly_employers",
    "e_verified_employers",
    "dso_or_immigration_review",
  ]

  if (urgency === "Emergency" || urgency === "High") {
    return [
      ...common,
      "contract_or_temp_roles",
      "staffing_or_consulting_firms",
      "university_or_cap_exempt_roles",
      "bridge_education_options",
    ]
  }

  return [...common, "university_or_cap_exempt_roles"]
}

export const calculateOptTimelineDashboard = (
  input: CalculateOptTimelineInput
): OptTimelineDashboard => {
  const asOf = toDateOnly(input.asOf ?? new Date()) ?? new Date()
  const currentAuthorizationPeriod = getCurrentAuthorizationPeriod(input.immigrationStatus, asOf, input)
  const authorizationEndDate = getAuthorizationEndDate(currentAuthorizationPeriod, input)
  const unemploymentDaysLimit = unemploymentLimitFor(currentAuthorizationPeriod)

  const computedDaysRemaining = daysUntil(authorizationEndDate, asOf)
  const unemploymentDaysUsed =
    clampNonNegativeInt(input.manualOverrides?.unemploymentDaysUsed) ??
    clampNonNegativeInt(input.unemploymentDaysUsed)

  const computedUnemploymentDaysRemaining =
    unemploymentDaysLimit == null || unemploymentDaysUsed == null
      ? null
      : Math.max(0, unemploymentDaysLimit - unemploymentDaysUsed)

  const daysRemaining =
    clampNonNegativeInt(input.manualOverrides?.daysRemaining) ?? computedDaysRemaining
  const estimatedUnemploymentDaysRemaining =
    clampNonNegativeInt(input.manualOverrides?.unemploymentDaysRemaining) ??
    computedUnemploymentDaysRemaining

  const computedUrgency = calculateUrgency({
    daysRemaining,
    unemploymentDaysRemaining: estimatedUnemploymentDaysRemaining,
    employmentStatus: input.currentEmploymentStatus,
  })
  const urgencyLevel = input.manualOverrides?.urgencyLevel ?? computedUrgency

  const dataGaps: string[] = []
  const warnings: string[] = []
  const assumptions: string[] = []

  if (currentAuthorizationPeriod === "OPT" && !input.optEndDate) {
    dataGaps.push("OPT end date is missing.")
  }
  if (currentAuthorizationPeriod === "STEM_OPT" && !input.stemOptEndDate) {
    dataGaps.push("STEM OPT end date is missing.")
  }
  if (unemploymentDaysUsed == null && unemploymentDaysLimit != null) {
    dataGaps.push("Unemployment days used has not been entered.")
  }
  if (input.immigrationStatus === "F1_STEM_OPT" && !input.stemOptStartDate) {
    dataGaps.push("STEM OPT start date is missing.")
  }
  if (input.manualOverrides && Object.values(input.manualOverrides).some((value) => value != null)) {
    assumptions.push("Manual override values were used for this estimate.")
  }
  if (input.currentEmploymentStatus === "unemployed" && estimatedUnemploymentDaysRemaining != null) {
    warnings.push("Unemployment-day usage may continue while unemployed; verify the count with your DSO.")
  }
  if (urgencyLevel === "Emergency") {
    warnings.push("Timeline appears very tight. Treat this as a planning signal and verify the underlying dates.")
  }
  if (currentAuthorizationPeriod === "not_tracked") {
    assumptions.push("This dashboard is optimized for OPT/STEM OPT timelines; this status is not timeline-tracked here.")
  }

  return {
    immigrationStatus: input.immigrationStatus,
    currentAuthorizationPeriod,
    daysRemaining,
    unemploymentDaysUsed,
    estimatedUnemploymentDaysRemaining,
    unemploymentDaysLimit,
    urgencyLevel,
    recommendedWeeklyApplicationTarget: recommendWeeklyTarget(
      urgencyLevel,
      input.targetWeeklyApplicationGoal
    ),
    recommendedJobSearchStrategy: recommendStrategy(urgencyLevel),
    recommendedFallbackCategories: recommendFallbackCategories(urgencyLevel, input.immigrationStatus),
    warnings,
    dataGaps,
    assumptions,
    disclaimer: DISCLAIMER,
    calculatedAt: asOf.toISOString(),
  }
}

const mapVisaStatusToTimelineStatus = (
  visaStatus: VisaStatus | null | undefined,
  isInternational: boolean
): OptTimelineImmigrationStatus => {
  switch (visaStatus) {
    case "opt":
      return "F1_OPT"
    case "stem_opt":
      return "F1_STEM_OPT"
    case "h1b":
      return "H1B"
    case "green_card":
      return "GC"
    case "citizen":
      return "Citizen"
    case "other":
      return "Other"
    default:
      return isInternational ? "Other" : "Citizen"
  }
}

export const createOptTimelineSettingsFromProfile = (
  profile: Pick<Profile, "is_international" | "visa_status" | "opt_end_date" | "opt_timeline_settings">
): OptTimelineSettings => {
  const existing = profile.opt_timeline_settings

  return {
    immigrationStatus:
      existing?.immigrationStatus ??
      mapVisaStatusToTimelineStatus(profile.visa_status, profile.is_international),
    optStartDate: existing?.optStartDate ?? null,
    optEndDate: existing?.optEndDate ?? profile.opt_end_date ?? null,
    stemOptStartDate: existing?.stemOptStartDate ?? null,
    stemOptEndDate: existing?.stemOptEndDate ?? null,
    unemploymentDaysUsed: existing?.unemploymentDaysUsed ?? null,
    currentEmploymentStatus: existing?.currentEmploymentStatus ?? "unknown",
    targetWeeklyApplicationGoal: existing?.targetWeeklyApplicationGoal ?? null,
    manualOverrides: existing?.manualOverrides ?? null,
    updatedAt: existing?.updatedAt ?? null,
  }
}

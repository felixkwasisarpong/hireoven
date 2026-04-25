import type {
  ApplicationVerdict,
  Company,
  CompanyHiringHealth,
  CompanyImmigrationProfileSummary,
  GhostJobRisk,
  IntelligenceConfidence,
  IntelligenceRiskLevel,
  IntelligenceSource,
  Job,
  JobApplication,
  JobIntelligence,
  JobMatchScore,
  LcaSalaryIntelligence,
  MatchScoreBreakdown,
  SponsorshipBlocker,
  StemOptReadiness,
  VisaIntelligence,
} from "@/types"
import { applicationVerdictResultToIntelligence, calculateApplicationVerdict } from "@/lib/jobs/application-verdict"
import { capExemptDetectionToSignal, detectCapExemptSignal } from "@/lib/jobs/cap-exempt-signal"
import { calculateGhostJobRisk, ghostJobRiskResultToIntelligence } from "@/lib/jobs/ghost-job-risk"
import { calculateLcaSalaryIntelligence } from "@/lib/jobs/lca-salary-intelligence"
import { calculateVisaFitScore } from "@/lib/jobs/visa-fit-score"

const INTELLIGENCE_SCHEMA_VERSION = "2026-04-24" satisfies JobIntelligence["schemaVersion"]

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const clampIntelligenceScore = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }

  return Math.min(100, Math.max(0, Math.round(value)))
}

export const toIntelligenceConfidence = (
  value: unknown,
  fallback: IntelligenceConfidence = "unknown"
): IntelligenceConfidence => {
  return value === "high" || value === "medium" || value === "low" || value === "unknown"
    ? value
    : fallback
}

export const toIntelligenceRiskLevel = (
  value: unknown,
  fallback: IntelligenceRiskLevel = "unknown"
): IntelligenceRiskLevel => {
  return value === "low" || value === "medium" || value === "high" || value === "unknown"
    ? value
    : fallback
}

export const createSponsorshipBlockerFallback = (
  overrides: Partial<SponsorshipBlocker> = {}
): SponsorshipBlocker => ({
  detected: false,
  kind: null,
  severity: "unknown",
  source: "system",
  confidence: "unknown",
  ...overrides,
  evidence: overrides.evidence ?? [],
})

export const createVisaIntelligenceFallback = (
  job?: (Partial<Job> & { company?: Partial<Company> | null }) | null
): VisaIntelligence => {
  const blocker = job?.requires_authorization
    ? [
        createSponsorshipBlockerFallback({
          detected: true,
          kind: "requires_unrestricted_work_authorization",
          severity: "medium",
          source: "job_description",
          confidence: "medium",
        }),
      ]
    : []
  const company = job?.company
  const companyProfile = getCompanyImmigrationProfile(company)
  const capExemptSignal = capExemptDetectionToSignal(detectCapExemptSignal(company, job))
  const fit = calculateVisaFitScore({
    jobTitle: job?.title ?? job?.normalized_title ?? null,
    jobDescription: job?.description ?? null,
    companyName: company?.name ?? null,
    sponsorsH1b: job?.sponsors_h1b ?? company?.sponsors_h1b ?? null,
    sponsorshipScore: job?.sponsorship_score ?? company?.sponsorship_confidence ?? null,
    priorLcaCount: companyProfile.totalLcaApplications ?? company?.h1b_sponsor_count_3yr ?? null,
    recentLcaCount: companyProfile.recentH1BPetitions ?? company?.h1b_sponsor_count_1yr ?? null,
    roleFamilyLcaCount: null,
    locationLcaCount: null,
    wageLevelSignal: "unknown",
    eVerify: null,
    capExempt: capExemptSignal,
    sponsorshipBlocker: blocker[0] ?? null,
    dataRecencyDays: null,
  })

  return {
    visaFitScore: fit.score,
    label: fit.label,
    verdict:
      fit.label === "Blocked"
        ? "blocked"
        : fit.label === "Very Strong" || fit.label === "Strong"
          ? "strong_fit"
          : fit.label === "Medium"
            ? "possible_fit"
            : "needs_review",
    confidence: fit.confidence,
    requiresSponsorship: null,
    employerLikelySponsors: job?.sponsors_h1b ?? company?.sponsors_h1b ?? null,
    sponsorshipScore: clampIntelligenceScore(job?.sponsorship_score ?? company?.sponsorship_confidence),
    h1bPrediction: job?.h1b_prediction ?? null,
    blockers: blocker,
    positiveSignals: fit.reasons.map((reason) => ({
      label: reason,
      detail: null,
      impact: "positive",
      source: "system",
      confidence: fit.confidence,
    })),
    riskSignals: fit.warnings.map((warning) => ({
      label: warning,
      detail: null,
      impact: "negative",
      source: "system",
      confidence: fit.confidence,
    })),
    capExempt: fit.capExempt,
    summary: fit.dataGaps.length > 0 ? `Missing signals: ${fit.dataGaps.join(", ")}` : null,
  }
}

export const createLcaSalaryIntelligenceFallback = (
  job?: (Partial<Job> & { company?: Partial<Company> | null }) | null
): LcaSalaryIntelligence =>
  calculateLcaSalaryIntelligence({
    salaryMin: job?.salary_min ?? null,
    salaryMax: job?.salary_max ?? null,
    jobTitle: job?.title ?? job?.normalized_title ?? null,
    companyName: job?.company?.name ?? null,
    location: job?.location ?? null,
    roleFamily: job?.normalized_title ?? null,
    records: [],
  })

export const createStemOptReadinessFallback = (): StemOptReadiness => ({
  eligible: null,
  score: null,
  eVerifyLikely: null,
  stemRelatedRole: null,
  employerTrainingPlanRisk: "unknown",
  missingSignals: [],
  summary: null,
})

export const createGhostJobRiskFallback = (
  job?: (Partial<Job> & { company?: Partial<Company> | null }) | null,
  now: Date = new Date()
): GhostJobRisk => {
  const raw = isRecord(job?.raw_data) ? job.raw_data : {}
  const toNumber = (...values: unknown[]): number | null => {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) return value
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
      }
    }
    return null
  }
  const toString = (...values: unknown[]): string | null => {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value
    }
    return null
  }
  const locationCount =
    toNumber(raw.location_count, raw.locationCount, raw.location_variants, raw.locationVariants) ??
    (Array.isArray(raw.locations) ? raw.locations.length : null)

  const result = calculateGhostJobRisk({
    postedAt: job?.first_detected_at ?? null,
    lastVerifiedAt: job?.last_seen_at ?? null,
    applyUrlStatus: toString(raw.apply_url_status, raw.applyUrlStatus, raw.apply_status, raw.applyStatus),
    timesSeen: toNumber(raw.times_seen, raw.timesSeen, raw.seen_count, raw.seenCount),
    repostCount: toNumber(raw.repost_count, raw.repostCount),
    locationCount,
    duplicateCount: toNumber(raw.duplicate_count, raw.duplicateCount, raw.same_job_count, raw.sameJobCount),
    description: job?.description ?? null,
    salaryMin: job?.salary_min ?? null,
    salaryMax: job?.salary_max ?? null,
    atsType: job?.company?.ats_type ?? null,
    applyUrl: job?.apply_url ?? null,
    companyDomain: job?.company?.domain ?? null,
    isRemote: job?.is_remote ?? null,
    now,
  })

  return ghostJobRiskResultToIntelligence(result, job?.last_seen_at ?? null)
}

export const createCompanyHiringHealthFallback = (
  company?: Pick<Company, "job_count"> | null
): CompanyHiringHealth => ({
  score: null,
  status: "unknown",
  activeJobCount: company?.job_count ?? null,
  recentJobCount: null,
  hiringVelocity: null,
  sponsorshipTrend: "unknown",
  lcaCertificationRate: null,
  lastUpdatedAt: null,
  signals: [],
  summary: null,
})

export const createCompanyImmigrationProfileFallback = (
  company?: Pick<
    Company,
    "sponsors_h1b" | "sponsorship_confidence" | "h1b_sponsor_count_1yr" | "h1b_sponsor_count_3yr"
  > | null
): CompanyImmigrationProfileSummary => ({
  sponsorsH1b: company?.sponsors_h1b ?? null,
  sponsorshipConfidence: clampIntelligenceScore(company?.sponsorship_confidence),
  recentH1BPetitions: company?.h1b_sponsor_count_1yr ?? null,
  totalLcaApplications: null,
  lcaCertificationRate: null,
  commonSocCodes: [],
  commonJobTitles: [],
  commonWorksiteStates: [],
  riskFlags: [],
  lastUpdatedAt: null,
  summary: null,
})

export const createApplicationVerdictFallback = (
  application?: Pick<JobApplication, "match_score" | "created_at" | "updated_at"> | null
): ApplicationVerdict => ({
  verdict: "Unknown",
  recommendation: "unknown",
  confidence: "unknown",
  score: clampIntelligenceScore(application?.match_score),
  priorityScore: clampIntelligenceScore(application?.match_score),
  reasons: [],
  warnings: [],
  blockers: [],
  recommendedNextAction: null,
  nextBestAction: null,
  computedAt: application?.updated_at ?? application?.created_at ?? null,
})

export const createMatchScoreBreakdownFallback = (
  score?: Partial<JobMatchScore> | null
): MatchScoreBreakdown => ({
  overallScore: clampIntelligenceScore(score?.overall_score),
  skillsScore: clampIntelligenceScore(score?.skills_score),
  experienceScore: null,
  seniorityScore: clampIntelligenceScore(score?.seniority_score),
  locationScore: clampIntelligenceScore(score?.location_score),
  employmentTypeScore: clampIntelligenceScore(score?.employment_type_score),
  sponsorshipScore: clampIntelligenceScore(score?.sponsorship_score),
  visaFitScore: null,
  freshnessScore: null,
  matchedSkills: [],
  missingSkills: [],
  totalRequiredSkills: score?.total_required_skills ?? null,
  scoreMethod: score?.score_method ?? "fast",
  confidence: score ? "medium" : "unknown",
  concerns: [],
  computedAt: score?.computed_at ?? null,
})

export const getPostedFreshness = (
  job?: Pick<Job, "first_detected_at" | "last_seen_at"> | null,
  now: Date = new Date()
): NonNullable<JobIntelligence["postedFreshness"]> => {
  const firstDetectedAt = job?.first_detected_at ?? null
  const firstDetectedDate = firstDetectedAt ? new Date(firstDetectedAt) : null
  const freshnessDays =
    firstDetectedDate && Number.isFinite(firstDetectedDate.getTime())
      ? Math.max(0, Math.floor((now.getTime() - firstDetectedDate.getTime()) / 86_400_000))
      : null

  return {
    firstDetectedAt,
    lastSeenAt: job?.last_seen_at ?? null,
    freshnessDays,
    label: freshnessDays === null ? null : freshnessDays === 0 ? "Posted today" : `${freshnessDays}d old`,
    score: freshnessDays === null ? null : clampIntelligenceScore(100 - freshnessDays * 4),
  }
}

export const createJobIntelligenceFallback = (
  job?: (Partial<Job> & { company?: Partial<Company> | null; match_score?: Partial<JobMatchScore> | null }) | null,
  options: { sources?: IntelligenceSource[]; now?: Date } = {}
): JobIntelligence => {
  const sources = options.sources ?? ["system"]
  const visa = createVisaIntelligenceFallback(job)
  const lcaSalary = createLcaSalaryIntelligenceFallback(job)
  const ghostJobRisk = createGhostJobRiskFallback(job, options.now)
  const companyHiringHealth = createCompanyHiringHealthFallback(job?.company as Company | null)
  const matchScore = createMatchScoreBreakdownFallback(job?.match_score)
  const applicationVerdict = applicationVerdictResultToIntelligence(
    calculateApplicationVerdict({
      resumeMatchScore: matchScore.overallScore,
      visaFitScore: visa.visaFitScore,
      visaRelevant: Boolean(job?.sponsors_h1b || job?.company?.sponsors_h1b || job?.requires_authorization),
      sponsorshipBlocker: visa.blockers.find((blocker) => blocker.detected) ?? null,
      salaryAlignment: lcaSalary?.comparisonLabel ?? null,
      ghostJobRisk,
      jobFreshnessDays: ghostJobRisk.freshnessDays,
      companyHiringHealth,
    }),
    null
  )

  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    computedAt: null,
    sources,
    visa,
    sponsorshipBlockers: [],
    lcaSalary,
    stemOpt: createStemOptReadinessFallback(),
    capExempt: visa.capExempt,
    ghostJobRisk,
    companyHiringHealth,
    applicationVerdict,
    matchScore,
    postedFreshness: getPostedFreshness(job as Job | null, options.now),
    companyImmigrationProfile: createCompanyImmigrationProfileFallback(job?.company as Company | null),
    summary: null,
  }
}

export const getJobIntelligence = (
  job?: (Partial<Job> & { company?: Partial<Company> | null; match_score?: Partial<JobMatchScore> | null }) | null
): JobIntelligence => {
  if (isRecord(job?.job_intelligence)) {
    return {
      ...createJobIntelligenceFallback(job),
      ...(job.job_intelligence as Partial<JobIntelligence>),
    }
  }

  return createJobIntelligenceFallback(job)
}

export const getCompanyImmigrationProfile = (
  company?: Partial<Company> | null
): CompanyImmigrationProfileSummary => {
  if (isRecord(company?.immigration_profile_summary)) {
    return {
      ...createCompanyImmigrationProfileFallback(company as Company),
      ...(company.immigration_profile_summary as Partial<CompanyImmigrationProfileSummary>),
    }
  }

  return createCompanyImmigrationProfileFallback(company as Company | null)
}

export const getCompanyHiringHealth = (company?: Partial<Company> | null): CompanyHiringHealth => {
  if (isRecord(company?.hiring_health)) {
    return {
      ...createCompanyHiringHealthFallback(company as Company),
      ...(company.hiring_health as Partial<CompanyHiringHealth>),
    }
  }

  return createCompanyHiringHealthFallback(company as Company | null)
}


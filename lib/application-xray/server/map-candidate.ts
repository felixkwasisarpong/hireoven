import { buildCandidateAuthorizationTimeline } from "../authorization-timeline"
import type {
  CandidateAuthorizationTimeline,
  EmployerActionFeasibility,
  FutureEmployerActionType,
  PostingAuthorizationRequirement,
  SponsorshipHistorySignal,
  VisaStatus,
  WorkAuthorization,
} from "../types"
import type {
  JsonRecord,
  XRayAutofillRow,
  XRayCompanyRow,
  XRayJobRow,
  XRayProfileRow,
} from "./records"

export function mapCandidateAuthorization(input: {
  profile: XRayProfileRow | null
  autofillProfile: XRayAutofillRow | null
  job: XRayJobRow | null
  now: string
}): CandidateAuthorizationTimeline {
  const profileVisa = normalizeVisaStatus(input.profile?.visa_status)
  const autofillAuth = normalizeWorkAuthorization(input.autofillProfile?.work_authorization)
  const visaStatus = profileVisa ?? visaFromWorkAuthorization(autofillAuth)
  const workAuthorization = autofillAuth ?? workAuthorizationFromVisa(profileVisa)
  const readFrom: CandidateAuthorizationTimeline["readFrom"] = []
  if (profileVisa) readFrom.push("profiles.visa_status")
  if (autofillAuth) readFrom.push("autofill_profiles.work_authorization")

  const derivedFromDefaultsOnly = !profileVisa && !autofillAuth
  const optEndDate = input.profile?.opt_end_date ?? null
  const optStillCurrent = !optEndDate || Date.parse(optEndDate) >= Date.parse(input.now)

  return buildCandidateAuthorizationTimeline({
    visaStatus,
    workAuthorization,
    authorizationEndDate: optEndDate,
    roleRelatedToDegree: visaStatus === "opt" && optStillCurrent ? true : "unknown",
    stemDegreeEligible: visaStatus === "opt" ? true : "unknown",
    derivedFromDefaultsOnly,
    readFrom,
  })
}

export function mapSponsorshipHistory(input: {
  company: XRayCompanyRow | null | undefined
  employerActionFeasibility: EmployerActionFeasibility[]
  now: string
}): SponsorshipHistorySignal | null {
  const company = input.company
  if (!company) return null

  const recentPetitionCount = numberOrNull(company.h1b_sponsor_count_1yr)
  const totalLcaCount = numberOrNull(company.h1b_sponsor_count_3yr)
  const hasHistory =
    company.sponsors_h1b === true ||
    (typeof recentPetitionCount === "number" && recentPetitionCount > 0) ||
    (typeof totalLcaCount === "number" && totalLcaCount > 0)

  const eVerify = eVerifyFromCompany(company, input.employerActionFeasibility)
  const hasAnySignal = hasHistory || eVerify.participation !== "UNKNOWN" || company.updated_at
  if (!hasAnySignal) return null

  return {
    employerHasSponsored: hasHistory ? true : "unknown",
    recentPetitionCount,
    totalLcaCount,
    roleFamilyLcaCount: null,
    roleFamilyMatchMethod: "unknown",
    worksiteLcaCount: null,
    dataAsOf: stringOrNull(company.updated_at) ?? stringOrNull(company.e_verify_synced_at),
    dataStale: false,
    eVerify,
    notARolePromise: true,
  }
}

export function mapEmployerActionFeasibility(input: {
  job: XRayJobRow | null
  candidate: CandidateAuthorizationTimeline
  postingRequirements: PostingAuthorizationRequirement[]
}): EmployerActionFeasibility[] {
  const job = input.job
  const company = job?.company
  const actions = new Set(input.candidate.futureEmployerActions.map((action) => action.type))
  const output: EmployerActionFeasibility[] = []
  const rawItems = readRawEmployerActionItems(job?.raw_data)

  for (const item of rawItems) {
    output.push(item)
  }

  if (actions.has("STEM_OPT_EVERIFY_PARTICIPATION")) {
    const rawOverride = output.find((item) => item.actionType === "STEM_OPT_EVERIFY_PARTICIPATION")
    if (!rawOverride) {
      output.push({
        actionType: "STEM_OPT_EVERIFY_PARTICIPATION",
        status: eVerifyEmployerActionStatus(company),
        employerStatementExcerpt: null,
        candidateRequiresAction: candidateRequires(input.candidate, "STEM_OPT_EVERIFY_PARTICIPATION"),
        sourceFactIds: company?.e_verify_synced_at ? ["company-everify-source"] : [],
        confidence: company?.e_verify_synced_at ? "medium" : "unknown",
      })
    }
  }

  return output.sort((a, b) => a.actionType.localeCompare(b.actionType))
}

function eVerifyEmployerActionStatus(company: XRayCompanyRow | null | undefined): EmployerActionFeasibility["status"] {
  if (company?.is_e_verify === true || company?.e_verify_status === "enrolled") return "AVAILABLE"
  if (company?.e_verify_synced_at) return "NOT_FOUND"
  return "UNKNOWN"
}

function eVerifyFromCompany(
  company: XRayCompanyRow,
  feasibility: EmployerActionFeasibility[],
): SponsorshipHistorySignal["eVerify"] {
  const refused = feasibility.find(
    (item) => item.actionType === "STEM_OPT_EVERIFY_PARTICIPATION" && item.status === "REFUSED_CONFIRMED",
  )
  if (refused) {
    return {
      participation: "CONFIRMED_NOT_ENROLLED",
      sourceName: "employer statement",
      sourceCoverageNote: refused.employerStatementExcerpt,
      observedAt: null,
      confidence: refused.confidence,
    }
  }
  if (company.is_e_verify === true || company.e_verify_status === "enrolled") {
    return {
      participation: "CONFIRMED_PARTICIPATING",
      sourceName: "stored E-Verify employer data",
      sourceCoverageNote: null,
      observedAt: stringOrNull(company.e_verify_synced_at),
      confidence: "medium",
    }
  }
  if (company.e_verify_synced_at) {
    return {
      participation: "NOT_FOUND_IN_SOURCE",
      sourceName: "stored E-Verify employer data",
      sourceCoverageNote: "The source is incomplete; a miss is not a confirmed refusal.",
      observedAt: company.e_verify_synced_at,
      confidence: "medium",
    }
  }
  return {
    participation: "UNKNOWN",
    sourceName: null,
    sourceCoverageNote: null,
    observedAt: null,
    confidence: "unknown",
  }
}

function readRawEmployerActionItems(raw: JsonRecord | null | undefined): EmployerActionFeasibility[] {
  const value = raw?.xray_employer_action_feasibility ?? raw?.employer_action_feasibility
  if (!Array.isArray(value)) return []
  const out: EmployerActionFeasibility[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const record = item as JsonRecord
    const actionType = normalizeFutureActionType(record.actionType ?? record.action_type)
    const status = normalizeEmployerActionStatus(record.status)
    if (!actionType || !status) continue
    out.push({
      actionType,
      status,
      employerStatementExcerpt: stringOrNull(record.employerStatementExcerpt ?? record.employer_statement_excerpt),
      candidateRequiresAction: record.candidateRequiresAction === true || record.candidate_requires_action === true
        ? true
        : record.candidateRequiresAction === false || record.candidate_requires_action === false
          ? false
          : "unknown",
      sourceFactIds: Array.isArray(record.sourceFactIds)
        ? record.sourceFactIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        : Array.isArray(record.source_fact_ids)
          ? record.source_fact_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          : [],
      confidence: record.confidence === "high" || record.confidence === "medium" || record.confidence === "low"
        ? record.confidence
        : "unknown",
    })
  }
  return out
}

function candidateRequires(
  candidate: CandidateAuthorizationTimeline,
  type: FutureEmployerActionType,
): EmployerActionFeasibility["candidateRequiresAction"] {
  const action = candidate.futureEmployerActions.find((item) => item.type === type)
  if (!action) return "unknown"
  return action.status === "REQUIRED" ? true : "unknown"
}

function normalizeVisaStatus(value: unknown): VisaStatus | null {
  if (value === "opt" || value === "stem_opt" || value === "h1b" || value === "citizen" || value === "green_card" || value === "other") return value
  return null
}

function normalizeWorkAuthorization(value: unknown): WorkAuthorization | null {
  if (
    value === "us_citizen" ||
    value === "green_card" ||
    value === "h1b" ||
    value === "opt" ||
    value === "stem_opt" ||
    value === "tn_visa" ||
    value === "other" ||
    value === "require_sponsorship"
  ) {
    return value
  }
  return null
}

function visaFromWorkAuthorization(value: WorkAuthorization | null): VisaStatus | null {
  if (value === "us_citizen") return "citizen"
  if (value === "green_card") return "green_card"
  if (value === "h1b" || value === "opt" || value === "stem_opt") return value
  if (value === "require_sponsorship" || value === "other" || value === "tn_visa") return "other"
  return null
}

function workAuthorizationFromVisa(value: VisaStatus | null): WorkAuthorization | null {
  if (value === "citizen") return "us_citizen"
  if (value === "green_card") return "green_card"
  if (value === "h1b" || value === "opt" || value === "stem_opt") return value
  if (value === "other") return "other"
  return null
}

function normalizeFutureActionType(value: unknown): FutureEmployerActionType | null {
  if (
    value === "STEM_OPT_EVERIFY_PARTICIPATION" ||
    value === "STEM_OPT_I983" ||
    value === "H1B_PETITION" ||
    value === "H1B_TRANSFER" ||
    value === "OTHER" ||
    value === "UNKNOWN"
  ) {
    return value
  }
  return null
}

function normalizeEmployerActionStatus(value: unknown): EmployerActionFeasibility["status"] | null {
  if (value === "AVAILABLE" || value === "REFUSED_CONFIRMED" || value === "NOT_FOUND" || value === "UNKNOWN") return value
  return null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

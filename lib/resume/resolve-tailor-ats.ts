import { detectAtsFromUrl, type AtsType } from "@/lib/companies/detect-ats"
import type { KnownATS } from "@/lib/resume/ats-tailor"

type TailorAtsSource =
  | "request"
  | "job_apply_url"
  | "company_ats_type"
  | "company_careers_url"
  | "generic"

type ResolveTailorAtsInput = {
  requestAts?: string | null
  jobApplyUrl?: string | null
  companyAtsType?: string | null
  companyCareersUrl?: string | null
}

export type ResolvedTailorAts = {
  ats: KnownATS
  source: TailorAtsSource
}

function mapToKnownAts(value: string | null | undefined): KnownATS | null {
  switch ((value ?? "").trim().toLowerCase()) {
    case "workday":
    case "greenhouse":
    case "lever":
    case "ashby":
    case "icims":
    case "smartrecruiters":
    case "bamboohr":
      return value!.trim().toLowerCase() as KnownATS
    default:
      return null
  }
}

function mapDetectedAts(value: AtsType | null | undefined): KnownATS | null {
  if (!value) return null
  return mapToKnownAts(value)
}

export function resolveTailorAts({
  requestAts,
  jobApplyUrl,
  companyAtsType,
  companyCareersUrl,
}: ResolveTailorAtsInput): ResolvedTailorAts {
  const directRequest = mapToKnownAts(requestAts)
  if (directRequest) {
    return { ats: directRequest, source: "request" }
  }

  const fromApplyUrl = mapDetectedAts(jobApplyUrl ? detectAtsFromUrl(jobApplyUrl)?.atsType ?? null : null)
  if (fromApplyUrl) {
    return { ats: fromApplyUrl, source: "job_apply_url" }
  }

  const fromCompanyAtsType = mapToKnownAts(companyAtsType)
  if (fromCompanyAtsType) {
    return { ats: fromCompanyAtsType, source: "company_ats_type" }
  }

  const fromCareersUrl = mapDetectedAts(companyCareersUrl ? detectAtsFromUrl(companyCareersUrl)?.atsType ?? null : null)
  if (fromCareersUrl) {
    return { ats: fromCareersUrl, source: "company_careers_url" }
  }

  return { ats: "generic", source: "generic" }
}

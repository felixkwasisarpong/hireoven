import type {
  EmploymentType,
  Job,
  SeniorityLevel,
} from "@/types"

export const JOB_NORMALIZATION_VERSION = "job_normalization_v2"

export type SourceAdapterKind =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "icims"
  | "bamboohr"
  | "jobvite"
  | "oracle"
  | "phenom"
  | "google"
  | "generic_html"
  | "unknown"

export type CanonicalSectionKey =
  | "header"
  | "compensation"
  | "visa"
  | "about_role"
  | "responsibilities"
  | "requirements"
  | "preferred_qualifications"
  | "benefits"
  | "company_info"
  | "application_info"
  | "other"

export type NormalizationMethod =
  | "structured"
  | "heading"
  | "heuristic"
  | "fallback"
  | "legacy"

export type ValidationSeverity = "error" | "warning"

export type FieldProvenance = {
  adapter: SourceAdapterKind
  method: NormalizationMethod
  source_path?: string
  source_heading?: string | null
  source_excerpt?: string | null
}

export type CanonicalField<T> = {
  value: T | null
  confidence: number
  provenance: FieldProvenance[]
}

export type CanonicalSection = {
  key: CanonicalSectionKey
  label: string
  items: string[]
  confidence: number
  provenance: FieldProvenance[]
  is_fallback: boolean
}

export type CanonicalJobHeader = {
  title: CanonicalField<string>
  normalized_title: CanonicalField<string>
  location: CanonicalField<string>
  apply_url: CanonicalField<string>
  employment_type: CanonicalField<EmploymentType>
  seniority_level: CanonicalField<SeniorityLevel>
  is_remote: CanonicalField<boolean>
  is_hybrid: CanonicalField<boolean>
  posted_at: CanonicalField<string>
}

export type CanonicalCompensation = {
  salary_min: CanonicalField<number>
  salary_max: CanonicalField<number>
  salary_currency: CanonicalField<string>
  pay_text: CanonicalField<string>
}

export type CanonicalVisa = {
  sponsors_h1b: CanonicalField<boolean>
  requires_authorization: CanonicalField<boolean>
  sponsorship_score: CanonicalField<number>
  visa_language: CanonicalField<string>
}

export type ValidationIssue = {
  code: string
  severity: ValidationSeverity
  message: string
  field?: string
}

export type NormalizationValidation = {
  completeness_score: number
  confidence_score: number
  requires_review: boolean
  issues: ValidationIssue[]
}

export type CanonicalJob = {
  schema_version: typeof JOB_NORMALIZATION_VERSION
  normalized_at: string
  source: {
    adapter: SourceAdapterKind
    external_id: string | null
    crawl_url: string
  }
  header: CanonicalJobHeader
  compensation: CanonicalCompensation
  visa: CanonicalVisa
  skills: CanonicalField<string[]>
  sections: Record<CanonicalSectionKey, CanonicalSection>
  validation: NormalizationValidation
}

export type JobPageSectionView = {
  key: CanonicalSectionKey
  label: string
  items: string[]
  confidence: number
  is_fallback: boolean
}

export type JobPageViewModel = {
  schema_version: typeof JOB_NORMALIZATION_VERSION
  title: string
  normalized_title: string | null
  location: string | null
  apply_url: string
  employment_label: string | null
  seniority_label: string | null
  salary_label: string | null
  sponsorship_label: string
  posted_at_label: string | null
  sections: Record<CanonicalSectionKey, JobPageSectionView>
  ordered_sections: JobPageSectionView[]
  highlights: string[]
  skills: string[]
  confidence_score: number
  requires_review: boolean
}

export type JobCardViewModel = {
  title: string
  location: string | null
  salary_label: string | null
  employment_label: string | null
  seniority_label: string | null
  preview_description: string | null
  skills: string[]
  sponsorship_badge: "sponsors" | "no_sponsorship" | "likely" | null
}

export type PersistedJobForNormalization = Pick<
  Job,
  | "id"
  | "title"
  | "normalized_title"
  | "location"
  | "apply_url"
  | "external_id"
  | "description"
  | "employment_type"
  | "seniority_level"
  | "is_remote"
  | "is_hybrid"
  | "salary_min"
  | "salary_max"
  | "salary_currency"
  | "sponsors_h1b"
  | "sponsorship_score"
  | "requires_authorization"
  | "visa_language_detected"
  | "skills"
  | "first_detected_at"
  | "raw_data"
>

export type SourceRawJobInput = {
  externalId?: string
  title: string
  url: string
  description?: string
  location?: string
  postedAt?: string
}

export type NormalizationResult = {
  canonical: CanonicalJob
  pageView: JobPageViewModel
  cardView: JobCardViewModel
  nextColumns: {
    normalized_title: string
    description: string | null
    location: string | null
    employment_type: EmploymentType | null
    seniority_level: SeniorityLevel | null
    is_remote: boolean
    is_hybrid: boolean
    salary_min: number | null
    salary_max: number | null
    salary_currency: string
    sponsors_h1b: boolean | null
    sponsorship_score: number
    requires_authorization: boolean
    visa_language_detected: string | null
    skills: string[]
  }
  rawSnapshot: Record<string, unknown>
}

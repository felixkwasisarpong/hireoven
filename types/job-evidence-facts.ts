export type EvidenceSource =
  | "ats_metadata"
  | "job_description"
  | "company_careers_page"
  | "salary_parser"
  | "geo_parser"
  | "derived"

export type JobFactConfidence = "high" | "medium" | "low"

export type EvidenceBackedJobFact<T> = {
  value: T | null
  confidence: JobFactConfidence
  source: EvidenceSource
  evidence: string[]
  reason?: string
}

export type NormalizedSalary = {
  kind: "posted" | "estimated" | "not_found"
  min?: number
  max?: number
  currency: "USD"
  period: "year" | "hour" | "month" | "unknown"
}

export type JobEvidenceFacts = {
  location: EvidenceBackedJobFact<string[]>
  workMode: EvidenceBackedJobFact<"remote" | "hybrid" | "onsite" | "unknown">
  employmentType: EvidenceBackedJobFact<
    "full_time" | "part_time" | "contract" | "internship" | "temporary" | "unknown"
  >
  salary: EvidenceBackedJobFact<NormalizedSalary>
}

export type WorkModeValue = "remote" | "hybrid" | "onsite" | "unknown"
export type EmploymentTypeValue =
  | "full_time"
  | "part_time"
  | "contract"
  | "internship"
  | "temporary"
  | "unknown"

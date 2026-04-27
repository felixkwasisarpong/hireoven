import { getPostedFreshness } from "@/lib/jobs/intelligence"
import type { Job } from "@/types"
import type { JobEvidenceFacts } from "@/types/job-evidence-facts"

function toRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

/**
 * When ATS or enrichment store an applicant or pipeline count on `raw_data`, it can feed opportunity badges.
 * Absence of a value does not block other signals (posting recency, match).
 */
export function readOptionalApplicantCountFromJobRaw(job: Job): number | null {
  const r = toRecord(job.raw_data)
  if (!r) return null
  for (const key of ["applicant_count", "applicants", "application_count", "applicantCount"] as const) {
    const v = r[key]
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v
    if (typeof v === "string" && v.trim()) {
      const n = Number.parseInt(v, 10)
      if (Number.isFinite(n) && n >= 0) return n
    }
  }
  return null
}

export function buildTopApplicantOpportunityBadgeTitle(
  job: Job,
  matchScore: number | null
): { show: boolean; title: string } {
  const pf = getPostedFreshness(job)
  const d = pf.freshnessDays
  const applicants = readOptionalApplicantCountFromJobRaw(job)
  const parts: string[] = []
  if (d != null) {
    parts.push(
      d === 0
        ? "Posting was first seen today."
        : d === 1
          ? "Posting was first seen in the last day."
          : `Posting is about ${d} day${d === 1 ? "" : "s"} old (first seen date in metadata).`
    )
  }
  if (applicants != null) {
    parts.push(
      `Applicant or pipeline count from job metadata: ${applicants} (low numbers are early window signals; treat as a hint, not a guarantee).`
    )
  } else {
    parts.push("No live applicant count is stored for this job; timing is from first-seen date only.")
  }
  if (matchScore != null) {
    parts.push(`Match score: ${matchScore} (from your profile vs this role).`)
  }

  const freshEnough = d != null && d <= 1
  const goodMatch = matchScore != null && matchScore >= 60
  const fewApplicants = applicants != null && applicants < 20
  const show = freshEnough && (goodMatch || fewApplicants)

  return {
    show,
    title: parts.join(" "),
  }
}

/**
 * "Salary strong" is only shown when the evidence-backed fact has an explicit posted or estimated pay signal.
 * It does not invent numbers; see `buildJobEvidenceFacts`.
 */
export function shouldShowSalaryStrongBadge(facts: JobEvidenceFacts): boolean {
  const v = facts.salary.value
  if (v == null) return false
  if (v.kind === "not_found") return false
  return v.kind === "posted" || v.kind === "estimated"
}

export function buildSalaryStrongBadgeTitle(facts: JobEvidenceFacts): string {
  const v = facts.salary.value
  if (v == null || v.kind === "not_found") {
    return "No reliable compensation signal is available to compare."
  }
  if (v.kind === "estimated") {
    return "A labeled estimate (not employer-posted) is available; treat as directional only."
  }
  return "A concrete pay range was parsed from the posting or structured job fields (USD, annual or hourly as labeled)."
}

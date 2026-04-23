import type {
  CanonicalJob,
  NormalizationValidation,
  ValidationIssue,
} from "@/lib/jobs/normalization/types"

function pushIssue(
  issues: ValidationIssue[],
  issue: ValidationIssue
) {
  issues.push(issue)
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function validateCanonicalJob(job: CanonicalJob): NormalizationValidation {
  const issues: ValidationIssue[] = []

  const title = job.header.title.value?.trim() ?? ""
  const applyUrl = job.header.apply_url.value?.trim() ?? ""

  if (!title) {
    pushIssue(issues, {
      code: "missing_title",
      severity: "error",
      field: "header.title",
      message: "Job title is missing after normalization",
    })
  }

  if (!applyUrl) {
    pushIssue(issues, {
      code: "missing_apply_url",
      severity: "error",
      field: "header.apply_url",
      message: "Apply URL is missing after normalization",
    })
  } else {
    try {
      new URL(applyUrl)
    } catch {
      pushIssue(issues, {
        code: "invalid_apply_url",
        severity: "error",
        field: "header.apply_url",
        message: "Apply URL is not a valid URL",
      })
    }
  }

  const hasAboutRole = job.sections.about_role.items.length > 0
  const hasResponsibilities = job.sections.responsibilities.items.length > 0
  const hasRequirements = job.sections.requirements.items.length > 0

  if (!hasAboutRole && !hasResponsibilities && !hasRequirements) {
    pushIssue(issues, {
      code: "missing_core_sections",
      severity: "warning",
      field: "sections",
      message: "Role overview, responsibilities, and requirements are all empty",
    })
  }

  const min = job.compensation.salary_min.value
  const max = job.compensation.salary_max.value
  if (min != null && max != null && min > max) {
    pushIssue(issues, {
      code: "salary_range_invalid",
      severity: "error",
      field: "compensation",
      message: "salary_min is greater than salary_max",
    })
  }

  if (job.visa.sponsorship_score.value != null) {
    const score = job.visa.sponsorship_score.value
    if (score < 0 || score > 100) {
      pushIssue(issues, {
        code: "sponsorship_score_out_of_range",
        severity: "error",
        field: "visa.sponsorship_score",
        message: "Sponsorship score must be between 0 and 100",
      })
    }
  }

  const completenessFactors = [
    title ? 1 : 0,
    applyUrl ? 1 : 0,
    job.header.location.value ? 1 : 0,
    hasAboutRole ? 1 : 0,
    hasResponsibilities ? 1 : 0,
    hasRequirements ? 1 : 0,
    job.sections.preferred_qualifications.items.length > 0 ? 1 : 0,
    job.sections.benefits.items.length > 0 ? 1 : 0,
    job.sections.company_info.items.length > 0 ? 1 : 0,
  ]

  const completenessScore =
    completenessFactors.reduce((sum, value) => sum + value, 0) /
    completenessFactors.length

  const confidenceFactors = [
    job.header.title.confidence,
    job.header.apply_url.confidence,
    job.header.location.confidence,
    job.header.employment_type.confidence,
    job.header.seniority_level.confidence,
    job.sections.about_role.confidence,
    job.sections.responsibilities.confidence,
    job.sections.requirements.confidence,
    job.sections.benefits.confidence,
    job.sections.company_info.confidence,
    job.compensation.pay_text.confidence,
    job.visa.sponsorship_score.confidence,
    job.skills.confidence,
  ]

  const confidenceScore =
    confidenceFactors.reduce((sum, value) => sum + clampScore(value), 0) /
    confidenceFactors.length

  const hasError = issues.some((issue) => issue.severity === "error")
  const requiresReview =
    hasError || confidenceScore < 0.62 || completenessScore < 0.52

  return {
    completeness_score: Number(completenessScore.toFixed(4)),
    confidence_score: Number(confidenceScore.toFixed(4)),
    requires_review: requiresReview,
    issues,
  }
}

import {
  CANONICAL_SECTION_ORDER,
} from "@/lib/jobs/normalization/section-taxonomy"
import type {
  CanonicalJob,
  CanonicalSectionKey,
  JobCardViewModel,
  JobPageSectionView,
  JobPageViewModel,
} from "@/lib/jobs/normalization/types"

export function formatEmploymentLabel(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === "fulltime") return "Full-time"
  if (value === "parttime") return "Part-time"
  if (value === "internship") return "Internship"
  if (value === "contract") return "Contract"
  return value
}

export function formatSeniorityLabel(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === "staff") return "Staff+"
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function formatSalaryLabel(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined
): string | null {
  if (min == null || max == null) return null
  const symbol = currency === "USD" || !currency ? "$" : `${currency} `
  const left = Math.round(min / 1000)
  const right = Math.round(max / 1000)
  return `${symbol}${left}k-${symbol}${right}k`
}

export function formatDetectedTime(value: string | null | undefined, now = Date.now()): string | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return null

  const minutes = Math.max(1, Math.floor((now - timestamp) / 60_000))
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`

  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function sponsorshipLabel(job: CanonicalJob): string {
  if (job.visa.sponsors_h1b.value === true) return "H1B sponsorship available"
  if (job.visa.requires_authorization.value === true) return "Work authorization required"

  const sponsorshipScore = job.visa.sponsorship_score.value ?? 0
  if (sponsorshipScore >= 65) return "Likely sponsorship"

  return "Sponsorship not specified"
}

function deriveHighlights(job: CanonicalJob, salaryLabel: string | null): string[] {
  const out: string[] = []

  if (job.header.is_remote.value) out.push("Remote-friendly role")
  if (job.header.is_hybrid.value) out.push("Hybrid work model")
  if (job.header.location.value) out.push(`${job.header.location.value} location`)

  const employmentLabel = formatEmploymentLabel(job.header.employment_type.value)
  if (employmentLabel) out.push(`${employmentLabel} position`)

  if (salaryLabel) out.push(`${salaryLabel} compensation band`)
  if (job.sections.benefits.items.length > 0) {
    const cleanBenefits = job.sections.benefits.items.filter((item) => {
      if (item.length > 140) return false
      if (
        /\b(apply for this role|apply now|application process|office locations?|job type|we're looking for people)\b/i.test(
          item
        )
      ) {
        return false
      }
      return true
    })
    out.push(...cleanBenefits.slice(0, 2))
  }

  const deduped: string[] = []
  for (const item of out) {
    if (deduped.some((existing) => existing.toLowerCase() === item.toLowerCase())) continue
    deduped.push(item)
    if (deduped.length >= 5) break
  }

  return deduped
}

function toPageSection(
  job: CanonicalJob,
  key: CanonicalSectionKey
): JobPageSectionView {
  const section = job.sections[key]
  return {
    key,
    label: section.label,
    items: section.items,
    confidence: section.confidence,
    is_fallback: section.is_fallback,
  }
}

export function mapCanonicalToJobPageView(job: CanonicalJob): JobPageViewModel {
  const salaryLabel = formatSalaryLabel(
    job.compensation.salary_min.value,
    job.compensation.salary_max.value,
    job.compensation.salary_currency.value
  )

  const sections = {} as Record<CanonicalSectionKey, JobPageSectionView>
  for (const key of CANONICAL_SECTION_ORDER) {
    sections[key] = toPageSection(job, key)
  }

  const ordered_sections = [
    sections.about_role,
    sections.responsibilities,
    sections.requirements,
    sections.preferred_qualifications,
    sections.benefits,
    sections.company_info,
    sections.application_info,
    sections.compensation,
    sections.visa,
    sections.other,
  ]

  return {
    schema_version: job.schema_version,
    title: job.header.title.value ?? "Untitled role",
    normalized_title: job.header.normalized_title.value,
    location: job.header.location.value,
    apply_url: job.header.apply_url.value ?? "",
    employment_label: formatEmploymentLabel(job.header.employment_type.value),
    seniority_label: formatSeniorityLabel(job.header.seniority_level.value),
    salary_label: salaryLabel,
    sponsorship_label: sponsorshipLabel(job),
    posted_at_label: formatDetectedTime(job.header.posted_at.value),
    sections,
    ordered_sections,
    highlights: deriveHighlights(job, salaryLabel),
    skills: job.skills.value ?? [],
    confidence_score: job.validation.confidence_score,
    requires_review: job.validation.requires_review,
  }
}

export function mapCanonicalToJobCardView(job: CanonicalJob): JobCardViewModel {
  const sponsorshipScore = job.visa.sponsorship_score.value ?? 0

  return {
    title: job.header.title.value ?? "Untitled role",
    location: job.header.location.value,
    salary_label: formatSalaryLabel(
      job.compensation.salary_min.value,
      job.compensation.salary_max.value,
      job.compensation.salary_currency.value
    ),
    employment_label: formatEmploymentLabel(job.header.employment_type.value),
    seniority_label: formatSeniorityLabel(job.header.seniority_level.value),
    preview_description:
      job.sections.about_role.items[0] ??
      job.sections.responsibilities.items[0] ??
      job.sections.requirements.items[0] ??
      null,
    skills: (job.skills.value ?? []).slice(0, 8),
    sponsorship_badge:
      job.visa.sponsors_h1b.value === true
        ? "sponsors"
        : job.visa.requires_authorization.value === true
          ? "no_sponsorship"
          : sponsorshipScore >= 65
            ? "likely"
            : null,
  }
}

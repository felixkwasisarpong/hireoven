import {
  CANONICAL_SECTION_ORDER,
  sectionLabel,
} from "@/lib/jobs/normalization/section-taxonomy"
import { decodeHtmlEntities } from "@/lib/jobs/description"
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
  const explicit = job.visa.explicit_sponsorship_status?.value
  if (explicit === "sponsors" || job.visa.sponsors_h1b.value === true) {
    return "H1B sponsorship available"
  }
  if (explicit === "no_sponsorship") return "No sponsorship"
  if (job.visa.requires_authorization.value === true) {
    // Work authorization required — does NOT mean no sponsorship; visa type unclear.
    return "Work authorization required"
  }
  return "Sponsorship not specified"
}

/**
 * Strict visa card label — derived ONLY from explicit JD text detection.
 * null means no data; the calling UI must hide all visa display.
 *
 * Note: requires_authorization is intentionally excluded. A description can
 * require work authorization (accepting OPT, TN, etc.) without refusing to
 * sponsor H-1B. Using it here would produce false "No sponsorship" labels.
 * Company H1B records ("Historical sponsorship signal") are added by the UI
 * layer which has access to the full company row.
 */
function deriveVisaCardLabel(
  job: CanonicalJob
): "Sponsors" | "No sponsorship" | "Historical sponsorship signal" | null {
  // explicit_sponsorship_status was added after initial schema — may be absent on
  // canonical jobs deserialized from raw_data that predate the field.
  const explicit = job.visa.explicit_sponsorship_status?.value
  if (explicit === "sponsors" || job.visa.sponsors_h1b.value === true) return "Sponsors"
  if (explicit === "no_sponsorship") return "No sponsorship"
  return null
}

function deriveShowVisaDrawer(job: CanonicalJob): boolean {
  const label = deriveVisaCardLabel(job)
  // Only open the drawer when we have positive sponsorship evidence.
  return label === "Sponsors" || label === "Historical sponsorship signal"
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

// Mirrors the extraction-time cleanup so cached canonical (which was extracted
// before bullet-stripping / numeric-entity decoding shipped) renders cleanly
// without requiring a re-normalize pass.
const VIEW_LEADING_BULLET_RE =
  /^(?:[•●◦▪▫‣⁃∙·⁌⁍‧․\-*]|\s| )+/

const VIEW_HEADING_MARKER_RE =
  /^[A-Z][A-Z\s,&/()'-]{2,}:?$/

function cleanCachedItem(item: string): string {
  return decodeHtmlEntities(item)
    .replace(VIEW_LEADING_BULLET_RE, "")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanCachedItems(items: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const cleaned = cleanCachedItem(raw)
    if (cleaned.length < 3) continue
    if (VIEW_HEADING_MARKER_RE.test(cleaned)) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
  }
  return out
}

function toPageSection(
  job: CanonicalJob,
  key: CanonicalSectionKey
): JobPageSectionView {
  const section = job.sections[key]
  // Always recompute the label from the current taxonomy so renames (e.g.
  // "Preferred qualifications" → "Nice to have") apply to cached canonical
  // payloads without requiring a re-normalize pass.
  return {
    key,
    label: sectionLabel(key),
    items: cleanCachedItems(section.items),
    confidence: section.confidence,
    is_fallback: section.is_fallback,
  }
}

const ABOUT_FALLBACK_HEADING_RE =
  /^(responsibilit|requirements?|minimum (qualifications?|requirements?)|basic qualifications?|required qualifications?|preferred qualifications?|qualifications?|nice to have|benefits?|perks?|compensation|salary|what we offer|how to apply|application process|equal opportunity|eeo|skills?|technical skills?|technologies)\b[\s:.-]*$/i

const ABOUT_FALLBACK_NOISE_RE =
  /\b(equal opportunity|eeo employer|reasonable accommodation|protected veteran|affirmative action|cookie|privacy notice|terms of (service|use))\b/i

/**
 * Page-level fallback for the "About the role" section. When the extractor's
 * about_role bucket is empty (cached canonical, low-signal description, etc.),
 * pull the first 1–2 prose paragraphs from the cleaned description so the
 * detail page never renders a placeholder.
 */
export function deriveAboutRoleParagraphs(
  extracted: string[],
  cleanDescription: string | null
): string[] {
  if (extracted.length > 0) return extracted

  if (!cleanDescription) return []

  const paragraphs = cleanDescription
    .split(/\n{2,}/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 60 && line.length <= 700)
    .filter((line) => !ABOUT_FALLBACK_HEADING_RE.test(line))
    .filter((line) => !ABOUT_FALLBACK_NOISE_RE.test(line))

  return paragraphs.slice(0, 2)
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

  // The canonical schema retains a `qualifications` bucket for back-compat with
  // jobs cached before the requirements/qualifications merge. At the view-model
  // boundary we fold it into `requirements` so renderers only deal with one
  // bucket. Order is preserved (requirements first, then any qualifications-only
  // items the extractor missed). De-dup is case-insensitive on whitespace-normalized text.
  const seen = new Set<string>()
  const mergedRequirements: string[] = []
  for (const item of [...sections.requirements.items, ...sections.qualifications.items]) {
    const key = item.toLowerCase().replace(/\s+/g, " ").trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    mergedRequirements.push(item)
  }
  sections.requirements = {
    ...sections.requirements,
    items: mergedRequirements,
  }
  sections.qualifications = {
    ...sections.qualifications,
    items: [],
  }

  const ordered_sections = [
    sections.about_role,
    sections.responsibilities,
    sections.requirements,
    sections.preferred_qualifications,
    sections.skills,
    sections.benefits,
    sections.compensation,
    sections.company_info,
    sections.equal_opportunity,
    sections.application_info,
    sections.visa,
    sections.other,
  ]

  const visaCardLabel = deriveVisaCardLabel(job)
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
    clean_description: job.descriptions?.clean ?? null,
    sections,
    ordered_sections,
    highlights: deriveHighlights(job, salaryLabel),
    skills: job.skills.value ?? [],
    skill_groups: job.skill_groups,
    confidence_score: job.validation.confidence_score,
    requires_review: job.validation.requires_review,
    visa_card_label: visaCardLabel,
    show_visa_drawer: deriveShowVisaDrawer(job),
  }
}

export function mapCanonicalToJobCardView(job: CanonicalJob): JobCardViewModel {
  const sponsorshipScore = job.visa.sponsorship_score.value ?? 0
  const explicit = job.visa.explicit_sponsorship_status?.value
  const visaCardLabel = deriveVisaCardLabel(job)

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
    skill_groups: job.skill_groups,
    // Backward compat: kept for sponsorship-employer-signal.ts
    sponsorship_badge:
      explicit === "sponsors" || job.visa.sponsors_h1b.value === true  // explicit may be undefined on old canonical
        ? "sponsors"
        : explicit === "no_sponsorship" || job.visa.requires_authorization.value === true
          ? "no_sponsorship"
          : sponsorshipScore >= 65
            ? "likely"
            : null,
    visa_card_label: visaCardLabel,
    show_visa_drawer: deriveShowVisaDrawer(job),
  }
}

import {
  mapCanonicalToJobCardView,
  mapCanonicalToJobPageView,
  formatEmploymentLabel,
  formatSalaryLabel,
  formatSeniorityLabel,
} from "@/lib/jobs/normalization/view-model"
import { extractSkillsFromText } from "@/lib/jobs/text-normalizer"
import { JOB_NORMALIZATION_VERSION } from "@/lib/jobs/normalization/types"
import {
  normalizePersistedJobRecord,
  readCanonicalFromRawData,
} from "@/lib/jobs/normalization/normalize"
import { cleanJobDescription } from "@/lib/jobs/description"
import { extractSalaryRange } from "@/lib/jobs/metadata"
import { cleanJobTitle } from "@/lib/jobs/title"
import { categorizeSkills, emptyCategorizedSkills } from "@/lib/skills/taxonomy"
import type {
  CanonicalJob,
  CanonicalSectionKey,
  JobCardViewModel,
  JobPageViewModel,
  PersistedJobForNormalization,
} from "@/lib/jobs/normalization/types"

export type ResolvedJobNormalization = {
  canonical: CanonicalJob
  pageView: JobPageViewModel
  cardView: JobCardViewModel
  source: "stored" | "fallback"
}

function shouldRecomputeFromCurrentRow(
  job: PersistedJobForNormalization,
  stored: CanonicalJob
) {
  const requiredSections: CanonicalSectionKey[] = [
    "about_role",
    "responsibilities",
    "requirements",
    "qualifications",
    "preferred_qualifications",
    "skills",
    "benefits",
    "company_info",
    "equal_opportunity",
    "application_info",
    "visa",
    "other",
    "header",
    "compensation",
  ]

  const sections =
    (stored as unknown as { sections?: Record<string, { items?: unknown[] }> })
      .sections

  const sectionHasItemsArray = (key: CanonicalSectionKey) =>
    Array.isArray(sections?.[key]?.items)
  const sectionLength = (key: CanonicalSectionKey) =>
    sectionHasItemsArray(key) ? (sections?.[key]?.items?.length ?? 0) : 0

  // Older normalized payloads can be missing some section keys even with the same schema_version.
  // Recompute from the live row whenever canonical section structure is incomplete.
  const hasCompleteSections = requiredSections.every(sectionHasItemsArray)
  if (!hasCompleteSections) return true

  const hasCoreFieldShape = Boolean(
    stored.header?.title &&
    stored.header?.normalized_title &&
    stored.header?.location &&
    stored.header?.apply_url &&
    stored.header?.employment_type &&
    stored.header?.seniority_level &&
    stored.header?.is_remote &&
    stored.header?.is_hybrid &&
    stored.header?.posted_at &&
    stored.compensation?.salary_min &&
    stored.compensation?.salary_max &&
    stored.compensation?.salary_currency &&
    stored.compensation?.pay_text &&
    stored.visa?.sponsors_h1b &&
    stored.visa?.requires_authorization &&
    stored.visa?.sponsorship_score &&
    stored.visa?.visa_language
  )
  if (!hasCoreFieldShape) return true

  // `extractCanonicalSections` always returns every key as a CanonicalSection object
  // (never null/undefined), so we check `.items.length` to detect empty sections.
  const missingStructure =
    sectionLength("qualifications") === 0 &&
    sectionLength("skills") === 0 &&
    sectionLength("equal_opportunity") === 0 &&
    !stored.skill_groups

  if (missingStructure) return true

  const cleanedDescription = cleanJobDescription(job.description)
  const hasCurrentDescription = Boolean(cleanedDescription && cleanedDescription.length >= 120)

  const storedCoreSectionCount =
    sectionLength("about_role") +
    sectionLength("responsibilities") +
    sectionLength("requirements")

  const hasCurrentSalary = job.salary_min != null && job.salary_max != null
  const storedHasSalary =
    stored.compensation.salary_min.value != null &&
    stored.compensation.salary_max.value != null

  if (hasCurrentDescription && storedCoreSectionCount === 0) {
    return true
  }

  if (hasCurrentSalary && !storedHasSalary) {
    return true
  }

  return false
}

export function resolveJobNormalization(
  job: PersistedJobForNormalization
): ResolvedJobNormalization {
  const rawData =
    job.raw_data && typeof job.raw_data === "object"
      ? (job.raw_data as Record<string, unknown>)
      : null

  const fromRaw = readCanonicalFromRawData(rawData)
  if (fromRaw && !shouldRecomputeFromCurrentRow(job, fromRaw)) {
    return {
      canonical: fromRaw,
      pageView: mapCanonicalToJobPageView(fromRaw),
      cardView: mapCanonicalToJobCardView(fromRaw),
      source: "stored",
    }
  }

  const normalized = normalizePersistedJobRecord(job)
  return {
    canonical: normalized.canonical,
    pageView: normalized.pageView,
    cardView: normalized.cardView,
    source: "fallback",
  }
}

function readStoredCardView(
  rawData: Record<string, unknown> | null
): JobCardViewModel | null {
  if (!rawData) return null
  const normalized = rawData.normalized
  if (normalized && typeof normalized === "object") {
    const schema = (normalized as Record<string, unknown>).schema_version
    if (typeof schema === "string" && schema !== JOB_NORMALIZATION_VERSION) {
      return null
    }
  }

  const view = rawData.view
  if (!view || typeof view !== "object") return null
  const card = (view as Record<string, unknown>).card
  if (!card || typeof card !== "object") return null

  const payload = card as Record<string, unknown>
  if (typeof payload.title !== "string") return null

  return {
    title: payload.title,
    location: typeof payload.location === "string" ? payload.location : null,
    salary_label:
      typeof payload.salary_label === "string" ? payload.salary_label : null,
    employment_label:
      typeof payload.employment_label === "string"
        ? payload.employment_label
        : null,
    seniority_label:
      typeof payload.seniority_label === "string" ? payload.seniority_label : null,
    preview_description:
      typeof payload.preview_description === "string"
        ? payload.preview_description
        : null,
    skills: Array.isArray(payload.skills)
      ? payload.skills.filter((skill): skill is string => typeof skill === "string")
      : [],
    skill_groups:
      payload.skill_groups && typeof payload.skill_groups === "object"
        ? {
            ...emptyCategorizedSkills(),
            ...(payload.skill_groups as Record<string, string[]>),
          }
        : emptyCategorizedSkills(),
    sponsorship_badge:
      payload.sponsorship_badge === "sponsors" ||
      payload.sponsorship_badge === "no_sponsorship" ||
      payload.sponsorship_badge === "likely"
        ? payload.sponsorship_badge
        : null,
    visa_card_label:
      payload.visa_card_label === "Sponsors" ||
      payload.visa_card_label === "No sponsorship" ||
      payload.visa_card_label === "Historical sponsorship signal"
        ? payload.visa_card_label
        : null,
    show_visa_drawer: payload.show_visa_drawer === true,
  }
}

type JobCardFallbackInput = Pick<
  PersistedJobForNormalization,
  | "title"
  | "location"
  | "salary_min"
  | "salary_max"
  | "salary_currency"
  | "employment_type"
  | "seniority_level"
  | "description"
  | "skills"
  | "sponsors_h1b"
  | "requires_authorization"
  | "sponsorship_score"
  | "raw_data"
>

export function resolveJobCardView(job: JobCardFallbackInput): JobCardViewModel {
  const rawData =
    job.raw_data && typeof job.raw_data === "object"
      ? (job.raw_data as Record<string, unknown>)
      : null

  const cleanedDescription = cleanJobDescription(job.description)
  const descriptionSalary = extractSalaryRange(cleanedDescription ?? job.description)
  const liveSalaryLabel =
    formatSalaryLabel(job.salary_min, job.salary_max, job.salary_currency) ??
    formatSalaryLabel(
      descriptionSalary?.min ?? null,
      descriptionSalary?.max ?? null,
      descriptionSalary?.currency ?? null
    )

  const stored = readStoredCardView(rawData)
  const liveSkills = extractSkillsFromText(cleanJobTitle(job.title), cleanedDescription ?? job.description)
  if (stored) {
    const livePreview = cleanedDescription?.slice(0, 220) ?? null

    // If stored data predates the visa fields, compute them from DB columns.
    const visaCardLabel =
      stored.visa_card_label ??
      (job.sponsors_h1b === true
        ? "Sponsors"
        : job.requires_authorization === true
          ? "No sponsorship"
          : null)

    return {
      ...stored,
      location: stored.location ?? job.location,
      salary_label: stored.salary_label ?? liveSalaryLabel,
      employment_label: stored.employment_label ?? formatEmploymentLabel(job.employment_type),
      seniority_label: stored.seniority_label ?? formatSeniorityLabel(job.seniority_level),
      preview_description: stored.preview_description ?? livePreview,
      skills: stored.skills.length > 0 ? stored.skills : liveSkills.slice(0, 8),
      skill_groups:
        stored.skills.length > 0
          ? stored.skill_groups
          : categorizeSkills(liveSkills.slice(0, 8)),
      visa_card_label: visaCardLabel,
      show_visa_drawer: stored.show_visa_drawer ?? visaCardLabel === "Sponsors",
    }
  }

  const sponsorshipScore = job.sponsorship_score ?? 0

  // Compute strict visa_card_label from explicit DB columns only — no score invention.
  const fallbackVisaCardLabel =
    job.sponsors_h1b === true
      ? "Sponsors"
      : job.requires_authorization === true
        ? "No sponsorship"
        : null

  return {
    title: cleanJobTitle(job.title),
    location: job.location,
    salary_label: liveSalaryLabel,
    employment_label: formatEmploymentLabel(job.employment_type),
    seniority_label: formatSeniorityLabel(job.seniority_level),
    preview_description: cleanedDescription?.slice(0, 220) ?? null,
    skills: liveSkills.slice(0, 8),
    skill_groups: categorizeSkills(liveSkills.slice(0, 8)),
    sponsorship_badge:
      job.sponsors_h1b
        ? "sponsors"
        : job.requires_authorization
          ? "no_sponsorship"
          : sponsorshipScore >= 65
            ? "likely"
            : null,
    visa_card_label: fallbackVisaCardLabel,
    show_visa_drawer: fallbackVisaCardLabel === "Sponsors",
  }
}

import {
  cleanJobTitle,
  extractSkillsFromText,
  normalizeJobTitle,
} from "@/lib/jobs/text-normalizer"
import {
  extractSalaryRange,
  inferJobMetadata,
  inferRequiresAuthorization,
} from "@/lib/jobs/metadata"
import { extractCanonicalSections } from "@/lib/jobs/normalization/sections"
import { validateCanonicalJob } from "@/lib/jobs/normalization/validator"
import { adaptPersistedJob, adaptRawCrawlerJob } from "@/lib/jobs/normalization/source-adapters"
import {
  formatSalaryLabel,
  mapCanonicalToJobCardView,
  mapCanonicalToJobPageView,
} from "@/lib/jobs/normalization/view-model"
import {
  JOB_NORMALIZATION_VERSION,
} from "@/lib/jobs/normalization/types"
import type {
  CanonicalField,
  CanonicalJob,
  FieldProvenance,
  NormalizationResult,
  PersistedJobForNormalization,
  SourceRawJobInput,
} from "@/lib/jobs/normalization/types"
import type { EmploymentType, SeniorityLevel } from "@/types"

type ExistingJobState = {
  description: string | null
  employment_type: EmploymentType | null
  seniority_level: SeniorityLevel | null
  is_remote: boolean | null
  is_hybrid: boolean | null
  requires_authorization: boolean | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  sponsors_h1b: boolean | null
  sponsorship_score: number | null
  visa_language_detected: string | null
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function field<T>(
  value: T | null,
  confidence: number,
  provenance: FieldProvenance | FieldProvenance[]
): CanonicalField<T> {
  return {
    value,
    confidence: clampConfidence(confidence),
    provenance: Array.isArray(provenance) ? provenance : [provenance],
  }
}

function pickConfidence(
  value: unknown,
  preferred: number,
  fallback: number
): number {
  return value == null ? fallback : preferred
}

function normalizePostedAt(raw: string | null | undefined, fallbackIso: string): string {
  if (!raw) return fallbackIso
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) return fallbackIso
  return new Date(parsed).toISOString()
}

function extractVisaLanguage(description: string | null): string | null {
  if (!description) return null

  const contextual = description.match(
    /([^\n.!?]{0,120}\b(?:visa|sponsor|sponsorship|authorized to work|work authorization|h-?1b|opt)\b[^\n.!?]{0,180})/i
  )?.[1]

  if (contextual?.trim()) return contextual.trim().slice(0, 220)

  const fragments = description.split(/[\n.;]+/)
  for (const fragment of fragments) {
    if (
      /\b(visa|sponsor|sponsorship|authorized to work|work authorization|h-?1b|opt)\b/i.test(
        fragment
      )
    ) {
      return fragment.trim().slice(0, 220)
    }
  }

  return null
}

function inferSponsorshipFromText(
  description: string | null
): { sponsors_h1b: boolean | null; sponsorship_score: number } {
  if (!description) {
    return {
      sponsors_h1b: null,
      sponsorship_score: 60,
    }
  }

  if (/\b(we sponsor|visa sponsorship available|h-?1b sponsorship|will sponsor)\b/i.test(description)) {
    return {
      sponsors_h1b: true,
      sponsorship_score: 95,
    }
  }

  if (/\b(no sponsorship|without sponsorship|must be authorized to work|cannot sponsor)\b/i.test(description)) {
    return {
      sponsors_h1b: false,
      sponsorship_score: 10,
    }
  }

  if (/\b(visa|sponsorship|work authorization|h-?1b|opt)\b/i.test(description)) {
    return {
      sponsors_h1b: null,
      sponsorship_score: 55,
    }
  }

  return {
    sponsors_h1b: null,
    sponsorship_score: 60,
  }
}

function normalizeFromCoreInput(input: {
  title: string
  applyUrl: string
  location: string | null
  postedAt: string | null
  description: string | null
  externalId: string | null
  adapter: ReturnType<typeof adaptRawCrawlerJob>["adapter"]
  structuredSections?: ReturnType<typeof adaptRawCrawlerJob>["structuredSections"]
  structuredCompensationText?: string | null
  structuredVisaText?: string | null
  existing: ExistingJobState
  nowIso: string
}): NormalizationResult {
  const cleanedTitle = cleanJobTitle(input.title)
  const normalizedTitle = normalizeJobTitle(cleanedTitle)
  const metadata = inferJobMetadata({
    title: cleanedTitle,
    description: input.description,
    location: input.location,
  })

  const extractedSalary = extractSalaryRange(input.description)
  const salaryMin =
    extractedSalary?.min ??
    metadata.salaryMin ??
    input.existing.salary_min ??
    null
  const salaryMax =
    extractedSalary?.max ??
    metadata.salaryMax ??
    input.existing.salary_max ??
    null
  const salaryCurrency =
    extractedSalary?.currency ??
    metadata.salaryCurrency ??
    input.existing.salary_currency ??
    "USD"

  const requiresAuthorization =
    metadata.requiresAuthorization ??
    inferRequiresAuthorization(input.description) ??
    input.existing.requires_authorization ??
    false

  const visaSignals = inferSponsorshipFromText(input.description)
  const sponsorsH1b =
    visaSignals.sponsors_h1b ??
    input.existing.sponsors_h1b ??
    null

  const sponsorshipScore =
    sponsorsH1b === true
      ? 100
      : sponsorsH1b === false
        ? 10
        : input.existing.sponsorship_score ?? visaSignals.sponsorship_score

  const visaLanguage =
    input.structuredVisaText ??
    extractVisaLanguage(input.description) ??
    input.existing.visa_language_detected ??
    null

  const nextColumns = {
    normalized_title: normalizedTitle,
    description: input.description ?? input.existing.description,
    location: input.location,
    employment_type:
      metadata.employmentType ?? input.existing.employment_type ?? null,
    seniority_level:
      metadata.seniorityLevel ?? input.existing.seniority_level ?? null,
    is_remote: metadata.isRemote ?? input.existing.is_remote ?? false,
    is_hybrid: metadata.isHybrid ?? input.existing.is_hybrid ?? false,
    salary_min: salaryMin,
    salary_max: salaryMax,
    salary_currency: salaryCurrency,
    sponsors_h1b: sponsorsH1b,
    sponsorship_score: sponsorshipScore,
    requires_authorization: requiresAuthorization,
    visa_language_detected: visaLanguage,
    skills: extractSkillsFromText(cleanedTitle, input.description),
  }

  const sections = extractCanonicalSections({
    adapter: input.adapter,
    description: nextColumns.description,
    structuredSections: input.structuredSections,
  })

  const headerProvenance: FieldProvenance = {
    adapter: input.adapter,
    method: "structured",
    source_path: "crawler",
  }

  const inferredProvenance: FieldProvenance = {
    adapter: input.adapter,
    method: "heuristic",
    source_path: "description",
  }

  sections.header.items = [
    cleanedTitle,
    input.location ?? "Location not specified",
  ]
  sections.header.provenance.push(headerProvenance)
  sections.header.confidence = 0.94

  const payText =
    input.structuredCompensationText ??
    formatSalaryLabel(salaryMin, salaryMax, salaryCurrency)

  if (payText && sections.compensation.items.length === 0) {
    sections.compensation.items = [payText]
    sections.compensation.provenance.push({
      adapter: input.adapter,
      method: "fallback",
      source_path: "derived.salary",
    })
    sections.compensation.confidence = 0.56
    sections.compensation.is_fallback = true
  }

  if (visaLanguage && sections.visa.items.length === 0) {
    sections.visa.items = [visaLanguage]
    sections.visa.provenance.push({
      adapter: input.adapter,
      method: "fallback",
      source_path: "derived.visa_language",
    })
    sections.visa.confidence = 0.58
    sections.visa.is_fallback = true
  }

  const canonical: CanonicalJob = {
    schema_version: JOB_NORMALIZATION_VERSION,
    normalized_at: input.nowIso,
    source: {
      adapter: input.adapter,
      external_id: input.externalId,
      crawl_url: input.applyUrl,
    },
    header: {
      title: field(cleanedTitle, 0.98, headerProvenance),
      normalized_title: field(normalizedTitle, 0.95, headerProvenance),
      location: field(input.location, pickConfidence(input.location, 0.9, 0.3), headerProvenance),
      apply_url: field(input.applyUrl, 0.99, headerProvenance),
      employment_type: field(
        nextColumns.employment_type,
        pickConfidence(metadata.employmentType, 0.72, 0.5),
        metadata.employmentType ? inferredProvenance : headerProvenance
      ),
      seniority_level: field(
        nextColumns.seniority_level,
        pickConfidence(metadata.seniorityLevel, 0.72, 0.5),
        metadata.seniorityLevel ? inferredProvenance : headerProvenance
      ),
      is_remote: field(
        nextColumns.is_remote,
        pickConfidence(metadata.isRemote, 0.72, 0.45),
        metadata.isRemote != null ? inferredProvenance : headerProvenance
      ),
      is_hybrid: field(
        nextColumns.is_hybrid,
        pickConfidence(metadata.isHybrid, 0.72, 0.45),
        metadata.isHybrid != null ? inferredProvenance : headerProvenance
      ),
      posted_at: field(
        normalizePostedAt(input.postedAt, input.nowIso),
        pickConfidence(input.postedAt, 0.85, 0.5),
        headerProvenance
      ),
    },
    compensation: {
      salary_min: field(
        salaryMin,
        pickConfidence(extractedSalary?.min ?? metadata.salaryMin, 0.7, 0.5),
        extractedSalary ? inferredProvenance : headerProvenance
      ),
      salary_max: field(
        salaryMax,
        pickConfidence(extractedSalary?.max ?? metadata.salaryMax, 0.7, 0.5),
        extractedSalary ? inferredProvenance : headerProvenance
      ),
      salary_currency: field(salaryCurrency, 0.8, headerProvenance),
      pay_text: field(
        payText,
        pickConfidence(payText, input.structuredCompensationText ? 0.92 : 0.54, 0.25),
        input.structuredCompensationText
          ? {
              adapter: input.adapter,
              method: "structured",
              source_path: "structured.compensation",
            }
          : {
              adapter: input.adapter,
              method: "fallback",
              source_path: "derived.salary",
            }
      ),
    },
    visa: {
      sponsors_h1b: field(
        sponsorsH1b,
        pickConfidence(visaSignals.sponsors_h1b, 0.7, 0.5),
        visaSignals.sponsors_h1b != null ? inferredProvenance : headerProvenance
      ),
      requires_authorization: field(
        requiresAuthorization,
        pickConfidence(metadata.requiresAuthorization, 0.76, 0.52),
        metadata.requiresAuthorization != null ? inferredProvenance : headerProvenance
      ),
      sponsorship_score: field(
        sponsorshipScore,
        pickConfidence(visaSignals.sponsors_h1b, 0.68, 0.52),
        inferredProvenance
      ),
      visa_language: field(
        visaLanguage,
        pickConfidence(visaLanguage, 0.65, 0.2),
        visaLanguage
          ? {
              adapter: input.adapter,
              method: input.structuredVisaText ? "structured" : "heuristic",
              source_path: input.structuredVisaText ? "structured.visa" : "description",
              source_excerpt: visaLanguage,
            }
          : inferredProvenance
      ),
    },
    skills: field(nextColumns.skills, nextColumns.skills.length > 0 ? 0.74 : 0.4, inferredProvenance),
    sections,
    validation: {
      completeness_score: 0,
      confidence_score: 0,
      requires_review: false,
      issues: [],
    },
  }

  const validation = validateCanonicalJob(canonical)
  canonical.validation = validation

  const pageView = mapCanonicalToJobPageView(canonical)
  const cardView = mapCanonicalToJobCardView(canonical)

  return {
    canonical,
    pageView,
    cardView,
    nextColumns,
    rawSnapshot: {
      source_adapter: input.adapter,
      source_external_id: input.externalId,
      crawled_url: input.applyUrl,
      normalized_at: input.nowIso,
    },
  }
}

export function normalizeCrawlerJobForPersistence(input: {
  rawJob: SourceRawJobInput
  crawledAtIso: string
  existing?: ExistingJobState
}): NormalizationResult {
  const adapted = adaptRawCrawlerJob(input.rawJob)

  return normalizeFromCoreInput({
    title: adapted.title,
    applyUrl: adapted.applyUrl,
    location: adapted.location,
    postedAt: adapted.postedAt,
    description: adapted.description,
    externalId: adapted.externalId,
    adapter: adapted.adapter,
    structuredSections: adapted.structuredSections,
    structuredCompensationText: adapted.structuredCompensationText,
    structuredVisaText: adapted.structuredVisaText,
    existing: input.existing ?? {
      description: null,
      employment_type: null,
      seniority_level: null,
      is_remote: null,
      is_hybrid: null,
      requires_authorization: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      sponsors_h1b: null,
      sponsorship_score: null,
      visa_language_detected: null,
    },
    nowIso: input.crawledAtIso,
  })
}

export function normalizePersistedJobRecord(
  job: PersistedJobForNormalization
): NormalizationResult {
  const adapted = adaptPersistedJob(job)

  return normalizeFromCoreInput({
    title: adapted.title,
    applyUrl: adapted.applyUrl,
    location: adapted.location,
    postedAt: adapted.postedAt,
    description: adapted.description,
    externalId: adapted.externalId,
    adapter: adapted.adapter,
    structuredSections: adapted.structuredSections,
    structuredCompensationText: adapted.structuredCompensationText,
    structuredVisaText: adapted.structuredVisaText,
    existing: {
      description: job.description,
      employment_type: job.employment_type,
      seniority_level: job.seniority_level,
      is_remote: job.is_remote,
      is_hybrid: job.is_hybrid,
      requires_authorization: job.requires_authorization,
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      salary_currency: job.salary_currency,
      sponsors_h1b: job.sponsors_h1b,
      sponsorship_score: job.sponsorship_score,
      visa_language_detected: job.visa_language_detected,
    },
    nowIso: new Date().toISOString(),
  })
}

export function readCanonicalFromRawData(
  rawData: Record<string, unknown> | null | undefined
): CanonicalJob | null {
  if (!rawData || typeof rawData !== "object") return null

  const normalized = (rawData as Record<string, unknown>).normalized
  if (!normalized || typeof normalized !== "object") return null

  const schemaVersion = (normalized as Record<string, unknown>).schema_version
  if (schemaVersion !== JOB_NORMALIZATION_VERSION) return null

  return normalized as CanonicalJob
}

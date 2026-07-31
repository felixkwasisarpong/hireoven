export type JobPublicationStatus = "published" | "pending_enrichment" | "hidden_low_quality"

const MIN_DESCRIPTION_CHARS = 120
const MIN_SKILL_COUNT = 2
const LOW_CONFIDENCE_THRESHOLD = 0.55

type PublicationSectionItems = ReadonlyArray<string | null | undefined>
type PublicationSection =
  | PublicationSectionItems
  | { items?: PublicationSectionItems | null }
  | null
  | undefined

export type JobPublicationSections = Partial<
  Record<
    | "responsibilities"
    | "requirements"
    | "preferred_qualifications"
    | "qualifications"
    | "skills"
    | "about_role"
    | "company_info",
    PublicationSection
  >
>

type JobPublicationInput = {
  description?: string | null
  skills?: string[] | null
  sections?: JobPublicationSections | null
  confidenceScore?: number | null
  requiresReview?: boolean | null
}

type NormalizedPublicationInput = {
  nextColumns: {
    description?: string | null
    skills?: string[] | null
  }
  pageView?: {
    sections?: JobPublicationSections | null
  } | null
  canonical?: {
    validation?: {
      confidence_score?: number | null
      requires_review?: boolean | null
    } | null
  } | null
}

const COMPANY_BOILERPLATE_RE =
  /\b(about\s+(?:us|the company)|our mission|our values|our culture|our company|our team|founded|headquartered|we are committed|equal opportunity|eeo|reasonable accommodation|protected veteran|diversity(?:\s+and\s+inclusion)?|inclusive workplace|accommodation|privacy notice)\b/i

const ROLE_SPECIFIC_DESCRIPTION_RE =
  /\b(responsibilit(?:y|ies)|requirements?|qualifications?|what you(?:'|’)ll do|what you will do|you(?:'|’)ll|you will|in this role|this role|this position|candidate|experience (?:with|in)|years? of experience|must have|required skills?|preferred|proficien(?:t|cy)|technical skills?|(?:engineer|developer|manager|specialist|analyst|designer|architect)\s+(?:will|is responsible|builds?|develops?|designs?|leads?|owns?|supports?|manages?))\b/i

const ROLE_SPECIFIC_SECTION_KEYS: Array<keyof JobPublicationSections> = [
  "responsibilities",
  "requirements",
  "preferred_qualifications",
  "qualifications",
]

function normalizedDescription(description: string | null | undefined): string {
  return description?.replace(/\s+/g, " ").trim() ?? ""
}

function skillCount(input: JobPublicationInput): number {
  return input.skills?.filter((skill) => skill.trim().length > 0).length ?? 0
}

function isPublicationSectionItems(section: PublicationSection): section is PublicationSectionItems {
  return Array.isArray(section)
}

function sectionItemCount(section: PublicationSection): number {
  const items = isPublicationSectionItems(section) ? section : section?.items
  return items?.filter((item) => item?.trim() && item.trim().length >= 12).length ?? 0
}

function roleSpecificSectionCount(sections: JobPublicationSections | null | undefined): number {
  if (!sections) return 0
  return ROLE_SPECIFIC_SECTION_KEYS.reduce(
    (sum, key) => sum + sectionItemCount(sections[key]),
    0
  )
}

export function isLikelyCompanyBoilerplateOnly(description: string | null | undefined): boolean {
  const text = normalizedDescription(description)
  if (text.length < MIN_DESCRIPTION_CHARS) return false
  return COMPANY_BOILERPLATE_RE.test(text) && !ROLE_SPECIFIC_DESCRIPTION_RE.test(text)
}

function hasWeakNormalizedEvidence(input: JobPublicationInput): boolean {
  if (!input.sections) return false
  if (roleSpecificSectionCount(input.sections) > 0) return false
  if (skillCount(input) >= MIN_SKILL_COUNT) return false

  const confidenceScore = input.confidenceScore ?? 1
  return input.requiresReview === true || confidenceScore < LOW_CONFIDENCE_THRESHOLD
}

function needsDescriptionEnrichment(input: JobPublicationInput): boolean {
  return (
    normalizedDescription(input.description).length < MIN_DESCRIPTION_CHARS &&
    skillCount(input) < MIN_SKILL_COUNT
  )
}

export function hasUsablePublicJobContent(input: JobPublicationInput): boolean {
  if (isLikelyCompanyBoilerplateOnly(input.description)) return false
  if (hasWeakNormalizedEvidence(input)) return false

  const descriptionLength = normalizedDescription(input.description).length
  return descriptionLength >= MIN_DESCRIPTION_CHARS || skillCount(input) >= MIN_SKILL_COUNT
}

export function publicationStatusForJob(input: JobPublicationInput): JobPublicationStatus {
  if (needsDescriptionEnrichment(input)) return "pending_enrichment"
  if (isLikelyCompanyBoilerplateOnly(input.description)) return "hidden_low_quality"
  if (hasWeakNormalizedEvidence(input)) return "hidden_low_quality"
  return hasUsablePublicJobContent(input) ? "published" : "pending_enrichment"
}

export function publicationStatusForNormalization(
  normalization: NormalizedPublicationInput
): JobPublicationStatus {
  return publicationStatusForJob({
    description: normalization.nextColumns.description,
    skills: normalization.nextColumns.skills,
    sections: normalization.pageView?.sections ?? null,
    confidenceScore: normalization.canonical?.validation?.confidence_score ?? null,
    requiresReview: normalization.canonical?.validation?.requires_review ?? null,
  })
}

/**
 * Extended publication states (added in the ats_tenants migration). The legacy
 * 'published' / 'pending_enrichment' remain valid for already-existing rows.
 */
export type ExtendedPublicationStatus =
  | JobPublicationStatus
  | "visible_basic"
  | "visible_enriched"
  | "hidden_invalid"
  | "hidden_duplicate"
  | "hidden_expired"

/**
 * publication_status for a freshly-persisted harvested job. New inserts never use
 * the legacy 'pending_enrichment'; they are 'visible_basic' (shown, awaiting
 * enrichment) or 'visible_enriched' (shown, good content), with hidden_* for
 * invalid/duplicate. `normalizationStatus` is the quality verdict from
 * publicationStatusForNormalization (mapped: published→enriched, the rest→basic).
 */
export function publicationStatusForInsert(input: {
  invalid?: boolean
  duplicate?: boolean
  normalizationStatus: JobPublicationStatus
}): ExtendedPublicationStatus {
  if (input.invalid) return "hidden_invalid"
  if (input.duplicate) return "hidden_duplicate"
  switch (input.normalizationStatus) {
    case "published":
      return "visible_enriched"
    case "hidden_low_quality":
      return "hidden_low_quality"
    case "pending_enrichment":
    default:
      return "visible_basic"
  }
}

/** Rule-2 upgrade: bump a basic row to enriched once enrichment fills it in. */
export const SQL_UPGRADE_TO_VISIBLE_ENRICHED =
  "UPDATE jobs SET publication_status = 'visible_enriched', updated_at = now() WHERE id = $1 AND publication_status = 'visible_basic'"

/**
 * Feed visibility predicate. Behind FEED_USE_NEW_STATUS (default off) so the
 * persist-side status changes can ship before the feed switches over.
 *   off → legacy: only 'published' is visible
 *   on  → 'published' + 'visible_basic' + 'visible_enriched' are visible
 * (is_active is asserted separately by each caller, as today.)
 */
export function sqlPublishedJob(alias = "jobs"): string {
  const col = `COALESCE(${alias}.publication_status, 'published')`
  if (process.env.FEED_USE_NEW_STATUS === "true") {
    return `${col} IN ('published', 'visible_basic', 'visible_enriched')`
  }
  return `${col} = 'published'`
}

/**
 * Public SEO pages should recognize the extended harvested-job visibility states
 * regardless of the feed rollout flag. Otherwise sitemap/listing pages can link
 * to jobs-at/company/job URLs that immediately 404 in production.
 */
export function sqlSeoVisibleJob(alias = "jobs"): string {
  return `COALESCE(${alias}.publication_status, 'published') IN ('published', 'visible_basic', 'visible_enriched')`
}

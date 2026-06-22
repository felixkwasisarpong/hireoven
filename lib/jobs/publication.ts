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

export function sqlPublishedJob(alias = "jobs"): string {
  return `COALESCE(${alias}.publication_status, 'published') = 'published'`
}

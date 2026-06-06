export type JobPublicationStatus = "published" | "pending_enrichment" | "hidden_low_quality"

const MIN_DESCRIPTION_CHARS = 120
const MIN_SKILL_COUNT = 2

type JobPublicationInput = {
  description?: string | null
  skills?: string[] | null
}

export function hasUsablePublicJobContent(input: JobPublicationInput): boolean {
  const descriptionLength = input.description?.trim().length ?? 0
  const skillCount = input.skills?.filter((skill) => skill.trim().length > 0).length ?? 0
  return descriptionLength >= MIN_DESCRIPTION_CHARS || skillCount >= MIN_SKILL_COUNT
}

export function publicationStatusForJob(input: JobPublicationInput): JobPublicationStatus {
  return hasUsablePublicJobContent(input) ? "published" : "pending_enrichment"
}

export function sqlPublishedJob(alias = "jobs"): string {
  return `COALESCE(${alias}.publication_status, 'published') = 'published'`
}


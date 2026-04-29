import { cleanJobDescription, normalizeJobApplyUrl } from "@/lib/jobs/description"
import { extractStructuredFromAts } from "@/lib/jobs/normalization/ats-adapters"
import type {
  CanonicalSectionKey,
  PersistedJobForNormalization,
  SourceAdapterKind,
  SourceRawJobInput,
} from "@/lib/jobs/normalization/types"

export type AdaptedJobInput = {
  adapter: SourceAdapterKind
  externalId: string | null
  title: string
  applyUrl: string
  description: string | null
  location: string | null
  postedAt: string | null
  company: string | null
  companyDomain: string | null
  structuredSections: Partial<Record<CanonicalSectionKey, string[]>>
  structuredCompensationText: string | null
  structuredVisaText: string | null
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function looksLikeLocation(value: string): boolean {
  if (!value) return false
  if (value.length < 2 || value.length > 80) return false
  if (/(https?:\/\/|www\.|@)/i.test(value)) return false
  if (
    /\b(please|review|description|contact|asap|apply now|apply|save (this )?job|share (this )?job|sign in|skip to|cookie|privacy policy|responsibilities|requirements|qualifications|benefits|compensation|salary|years? of experience|experience with|notification|alert)\b/i.test(
      value
    )
  ) {
    return false
  }
  // A location should not have more than two commas — anything denser is a
  // sentence fragment rather than a place.
  if ((value.match(/,/g)?.length ?? 0) > 2) return false
  // Locations should be majority alphabetic. Reject strings that are mostly
  // digits or punctuation (e.g. requisition IDs, dates).
  const letters = (value.match(/[a-z]/gi) ?? []).length
  if (letters < Math.max(2, Math.ceil(value.length * 0.4))) return false
  return true
}

function sanitizeLocation(value: unknown): string | null {
  const raw = toStringOrNull(value)
  if (!raw) return null

  const singleLine = raw.replace(/\s+/g, " ").trim().replace(/^location\s*:\s*/i, "")
  if (!singleLine) return null

  // Some crawlers append CTA/description text after location.
  const firstSentence = singleLine.split(/[.!?](?:\s+|$)/)[0]?.trim() ?? ""
  if (looksLikeLocation(firstSentence)) return firstSentence
  if (looksLikeLocation(singleLine)) return singleLine
  return null
}

export function detectSourceAdapter(input: {
  externalId?: string | null
  applyUrl?: string | null
}): SourceAdapterKind {
  const externalId = input.externalId?.toLowerCase() ?? ""
  const applyUrl = input.applyUrl ?? ""

  if (externalId.startsWith("greenhouse:")) return "greenhouse"
  if (externalId.startsWith("greenhouse-embedded:")) return "greenhouse"
  if (externalId.startsWith("lever:")) return "lever"
  if (externalId.startsWith("ashby:")) return "ashby"
  if (externalId.startsWith("workday:")) return "workday"
  if (externalId.startsWith("icims:") || externalId.startsWith("icims-jibe:")) return "icims"
  if (externalId.startsWith("smartrecruiters:")) return "smartrecruiters"
  if (externalId.startsWith("bamboohr:")) return "bamboohr"
  if (externalId.startsWith("jobvite:")) return "jobvite"
  if (externalId.startsWith("oracle:")) return "oracle"
  if (externalId.startsWith("phenom:")) return "phenom"
  if (externalId.startsWith("google:")) return "google"

  try {
    const url = new URL(applyUrl)
    const host = url.hostname.toLowerCase()
    if (host.includes("greenhouse")) return "greenhouse"
    if (host.includes("lever.co")) return "lever"
    if (host.includes("ashbyhq")) return "ashby"
    if (host.includes("myworkdayjobs")) return "workday"
    if (host.includes("icims") || host.includes("jibe")) return "icims"
    if (host.includes("smartrecruiters")) return "smartrecruiters"
    if (host.includes("bamboohr")) return "bamboohr"
    if (host.includes("jobvite")) return "jobvite"
    if (host.includes("oracle")) return "oracle"
    if (host.includes("cisco.com")) return "phenom"
    if (host.includes("google.com")) return "google"
  } catch {
    return "unknown"
  }

  return "generic_html"
}

export function adaptRawCrawlerJob(input: SourceRawJobInput): AdaptedJobInput {
  const adapter = detectSourceAdapter({
    externalId: input.externalId,
    applyUrl: input.url,
  })

  const cleanedDescription = cleanJobDescription(input.description ?? null)
  const structured = extractStructuredFromAts({
    adapter,
    description: cleanedDescription,
    rawData: null,
  })

  return {
    adapter,
    externalId: input.externalId?.trim() || null,
    title: input.title.trim(),
    applyUrl: normalizeJobApplyUrl(input.url),
    description: cleanedDescription,
    location: sanitizeLocation(input.location),
    postedAt: toStringOrNull(input.postedAt),
    company: toStringOrNull(input.company),
    companyDomain: toStringOrNull(input.companyDomain),
    structuredSections: structured.sections,
    structuredCompensationText: structured.compensationText,
    structuredVisaText: structured.visaText,
  }
}

export function adaptPersistedJob(job: PersistedJobForNormalization): AdaptedJobInput {
  const adapter = detectSourceAdapter({
    externalId: job.external_id,
    applyUrl: job.apply_url,
  })

  const rawData =
    job.raw_data && typeof job.raw_data === "object"
      ? (job.raw_data as Record<string, unknown>)
      : null

  const cleanedDescription = cleanJobDescription(job.description ?? null)
  const structured = extractStructuredFromAts({
    adapter,
    description: cleanedDescription,
    rawData,
  })

  return {
    adapter,
    externalId: job.external_id,
    title: job.title,
    applyUrl: normalizeJobApplyUrl(job.apply_url),
    description: cleanedDescription,
    location: sanitizeLocation(job.location),
    postedAt: job.first_detected_at ?? null,
    company: null,
    companyDomain: null,
    structuredSections: structured.sections,
    structuredCompensationText: structured.compensationText,
    structuredVisaText: structured.visaText,
  }
}

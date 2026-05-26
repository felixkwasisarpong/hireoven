type DedupeCompany = {
  name?: string | null
}

type DedupeJobShape = {
  company_id?: string | null
  company?: DedupeCompany | null
  title?: string | null
  normalized_title?: string | null
  location?: string | null
  is_remote?: boolean | null
  is_hybrid?: boolean | null
}

function normalizeText(value: string | null | undefined): string {
  const text = (value ?? "").toLowerCase().trim()
  if (!text) return ""
  return text
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeLocation(job: DedupeJobShape): string {
  const raw = normalizeText(job.location)
  if (raw.includes("remote") || job.is_remote) return "remote"
  if (job.is_hybrid && !raw) return "hybrid"
  return raw || "unknown"
}

/**
 * Stable cross-source dedupe signature for "same role" collapse in feed surfaces.
 * Uses normalized company + normalized title + normalized location semantics.
 */
export function buildFeedDedupeSignature(job: DedupeJobShape): string {
  const company = normalizeText(job.company_id ?? job.company?.name)
  const title = normalizeText(job.normalized_title ?? job.title)
  const location = normalizeLocation(job)
  return `${company || "unknown-company"}|${title || "unknown-title"}|${location}`
}

/**
 * Preserve first-seen row per signature (caller controls preferred ordering).
 */
export function dedupeFeedJobsBySignature<T extends DedupeJobShape>(jobs: T[]): T[] {
  if (jobs.length <= 1) return jobs
  const seen = new Set<string>()
  const out: T[] = []
  for (const job of jobs) {
    const key = buildFeedDedupeSignature(job)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(job)
  }
  return out
}

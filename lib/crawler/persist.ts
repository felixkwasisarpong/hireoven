import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import type { RawJob } from "@/lib/crawler"
import {
  cleanJobTitle,
} from "@/lib/jobs/text-normalizer"
import {
  cleanJobDescription,
  fetchJobDescription,
  normalizeJobApplyUrl,
} from "@/lib/jobs/description"
import { normalizeCrawlerJobForPersistence } from "@/lib/jobs/normalization"
import type { EmploymentType, SeniorityLevel } from "@/types"

const DESCRIPTION_FETCH_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_DESCRIPTION_FETCH_CONCURRENCY ?? "4", 10)
)
const MAX_DESCRIPTION_FETCHES_PER_COMPANY = Math.max(
  0,
  Number.parseInt(process.env.CRAWLER_MAX_DESCRIPTION_FETCHES_PER_COMPANY ?? "500", 10)
)
const DEACTIVATION_GRACE_HOURS = Math.max(
  0,
  Number.parseInt(process.env.CRAWLER_DEACTIVATION_GRACE_HOURS ?? "72", 10)
)
const ALLOW_DEACTIVATE_ON_EMPTY_RESULTS =
  process.env.CRAWLER_ALLOW_DEACTIVATE_ON_EMPTY_RESULTS === "true"
const EXISTING_ROW_LOOKUP_BATCH_SIZE = Math.max(
  25,
  Number.parseInt(process.env.CRAWLER_EXISTING_ROW_LOOKUP_BATCH_SIZE ?? "100", 10)
)
const JOB_WRITE_BATCH_SIZE = Math.max(
  10,
  Number.parseInt(process.env.CRAWLER_JOB_WRITE_BATCH_SIZE ?? "25", 10)
)
const JOB_DEACTIVATE_BATCH_SIZE = Math.max(
  25,
  Number.parseInt(process.env.CRAWLER_JOB_DEACTIVATE_BATCH_SIZE ?? "250", 10)
)

const BLOCKED_TITLE_PATTERNS = [
  /^(login|log(?:\s+)?in|log back in!?)$/i,
  /^go back to our career portal$/i,
  /^by category$/i,
  /^by job title$/i,
  /^search jobs?$/i,
]

const BLOCKED_PATH_PATTERNS = [
  /\/jobs\/login$/i,
  /\/jobs\/intro$/i,
  /\/intro$/i,
]

function isBlockedCrawlTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim()
  if (!normalized || normalized.length < 3) return true
  return BLOCKED_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isBlockedApplyUrl(url: string) {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, "")
    if (BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(path))) return true
    if (parsed.searchParams.has("loginOnly") && parsed.searchParams.get("loginOnly") === "1")
      return true
    return false
  } catch {
    return false
  }
}

function externalIdForJob(job: RawJob) {
  if (job.externalId?.trim()) return job.externalId.trim()
  return `url:${crypto
    .createHash("sha1")
    .update(normalizeJobApplyUrl(job.url))
    .digest("hex")}`
}

function normalizePostedAtToIso(
  postedAt: string | undefined,
  crawledAt: Date
): string | null {
  const raw = postedAt?.trim()
  if (!raw) return null

  const direct = Date.parse(raw)
  if (!Number.isNaN(direct)) {
    return new Date(direct).toISOString()
  }

  const normalized = raw.toLowerCase().replace(/^posted\s+/, "").trim()
  if (!normalized) return null

  if (normalized === "today" || normalized === "just posted" || normalized === "new") {
    return crawledAt.toISOString()
  }
  if (normalized === "yesterday") {
    return new Date(crawledAt.getTime() - 24 * 60 * 60 * 1000).toISOString()
  }

  const relativeMatch = normalized.match(
    /^(\d+)\+?\s*(minute|hour|day|week|month|year)s?\s+ago$/
  )
  if (!relativeMatch) return null

  const amount = Number.parseInt(relativeMatch[1], 10)
  const unit = relativeMatch[2]
  if (!Number.isFinite(amount) || amount < 0) return null

  const unitMs: Record<string, number> = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  }

  const step = unitMs[unit]
  if (!step) return null

  return new Date(crawledAt.getTime() - amount * step).toISOString()
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number
): Promise<T[]> {
  const results: T[] = []
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      const current = idx
      idx += 1
      results.push(await tasks[current]())
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, tasks.length) }).map(() => worker())
  )
  return results
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  if (values.length === 0) return []
  const size = Math.max(1, chunkSize)
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

export async function persistCrawlJobs({
  companyId,
  crawledAt,
  jobs,
}: {
  companyId: string
  crawledAt: Date
  jobs: RawJob[]
}) {
  const supabase = createAdminClient()
  const crawledAtIso = crawledAt.toISOString()
  const normalized = jobs
    .map((job) => ({
      ...job,
      title: cleanJobTitle(job.title),
      url: normalizeJobApplyUrl(job.url),
      externalId: externalIdForJob(job),
      description: cleanJobDescription(job.description ?? null) ?? undefined,
    }))
    .filter((job) => !isBlockedCrawlTitle(job.title))
    .filter((job) => !isBlockedApplyUrl(job.url))

  const missingDescriptionCandidates = normalized
    .map((job, index) => ({ index, hasDescription: Boolean(job.description), url: job.url }))
    .filter((entry) => !entry.hasDescription && /^https?:\/\//i.test(entry.url))

  const missingDescriptionIndexes =
    MAX_DESCRIPTION_FETCHES_PER_COMPANY > 0
      ? missingDescriptionCandidates.slice(0, MAX_DESCRIPTION_FETCHES_PER_COMPANY)
      : missingDescriptionCandidates

  if (missingDescriptionIndexes.length > 0) {
    await runWithConcurrency(
      missingDescriptionIndexes.map((entry) => async () => {
        const description = await fetchJobDescription(entry.url)
        if (!description) return
        normalized[entry.index] = {
          ...normalized[entry.index],
          description,
        }
      }),
      DESCRIPTION_FETCH_CONCURRENCY
    )
  }

  // Some sources repeat identical external IDs. Keep the latest payload once to avoid
  // duplicate writes and oversized PostgREST payloads.
  const dedupedByExternalId = new Map<string, (typeof normalized)[number]>()
  for (const job of normalized) {
    dedupedByExternalId.set(job.externalId, job)
  }
  const dedupedJobs = [...dedupedByExternalId.values()]

  const externalIds = dedupedJobs.map((job) => job.externalId)
  const existingRows: Array<{
    id: string
    external_id: string
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
  }> = []

  for (const externalIdChunk of chunkValues(externalIds, EXISTING_ROW_LOOKUP_BATCH_SIZE)) {
    const { data, error } = await (supabase
      .from("jobs")
      .select(
        "id, external_id, description, employment_type, seniority_level, is_remote, is_hybrid, requires_authorization, salary_min, salary_max, salary_currency, sponsors_h1b, sponsorship_score, visa_language_detected"
      )
      .eq("company_id", companyId)
      .in("external_id", externalIdChunk) as any)

    if (error) throw error
    existingRows.push(...((data ?? []) as typeof existingRows))
  }

  const existingByExternalId = new Map<
    string,
    {
      id: string
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
  >()
  for (const row of existingRows) {
    existingByExternalId.set(row.external_id, {
      id: row.id,
      description: row.description ?? null,
      employment_type: row.employment_type ?? null,
      seniority_level: row.seniority_level ?? null,
      is_remote: row.is_remote ?? null,
      is_hybrid: row.is_hybrid ?? null,
      requires_authorization: row.requires_authorization ?? null,
      salary_min: row.salary_min ?? null,
      salary_max: row.salary_max ?? null,
      salary_currency: row.salary_currency ?? null,
      sponsors_h1b: row.sponsors_h1b ?? null,
      sponsorship_score: row.sponsorship_score ?? null,
      visa_language_detected: row.visa_language_detected ?? null,
    })
  }

  const toInsert: Array<Record<string, unknown>> = []
  const toUpdate: Array<{ id: string; payload: Record<string, unknown> }> = []

  for (const job of dedupedJobs) {
    const normalizedPostedAt = normalizePostedAtToIso(job.postedAt, crawledAt)
    const existing = existingByExternalId.get(job.externalId)
    const normalization = normalizeCrawlerJobForPersistence({
      rawJob: {
        externalId: job.externalId,
        title: job.title,
        url: job.url,
        description: job.description,
        location: job.location,
        postedAt: job.postedAt,
      },
      crawledAtIso,
      existing: {
        description: existing?.description ?? null,
        employment_type: existing?.employment_type ?? null,
        seniority_level: existing?.seniority_level ?? null,
        is_remote: existing?.is_remote ?? null,
        is_hybrid: existing?.is_hybrid ?? null,
        requires_authorization: existing?.requires_authorization ?? null,
        salary_min: existing?.salary_min ?? null,
        salary_max: existing?.salary_max ?? null,
        salary_currency: existing?.salary_currency ?? null,
        sponsors_h1b: existing?.sponsors_h1b ?? null,
        sponsorship_score: existing?.sponsorship_score ?? null,
        visa_language_detected: existing?.visa_language_detected ?? null,
      },
    })

    const cleanedTitle = cleanJobTitle(job.title)
    const payload: Record<string, unknown> = {
      company_id: companyId,
      title: cleanedTitle,
      normalized_title: normalization.nextColumns.normalized_title,
      apply_url: job.url,
      location: normalization.nextColumns.location,
      employment_type: normalization.nextColumns.employment_type,
      seniority_level: normalization.nextColumns.seniority_level,
      is_remote: normalization.nextColumns.is_remote,
      is_hybrid: normalization.nextColumns.is_hybrid,
      requires_authorization: normalization.nextColumns.requires_authorization,
      salary_min: normalization.nextColumns.salary_min,
      salary_max: normalization.nextColumns.salary_max,
      salary_currency: normalization.nextColumns.salary_currency,
      description: normalization.nextColumns.description,
      external_id: job.externalId,
      sponsors_h1b: normalization.nextColumns.sponsors_h1b,
      sponsorship_score: normalization.nextColumns.sponsorship_score,
      visa_language_detected: normalization.nextColumns.visa_language_detected,
      skills: normalization.nextColumns.skills,
      is_active: true,
      last_seen_at: crawledAtIso,
      raw_data: {
        source: "crawler",
        source_adapter: normalization.canonical.source.adapter,
        source_title: job.title,
        posted_at: job.postedAt ?? null,
        posted_at_normalized: normalizedPostedAt,
        description_captured: Boolean(normalization.nextColumns.description),
        raw: {
          title: job.title,
          url: job.url,
          description: job.description ?? null,
          location: job.location ?? null,
          posted_at: job.postedAt ?? null,
          external_id: job.externalId,
        },
        normalization: {
          version: normalization.canonical.schema_version,
          normalized_at: normalization.canonical.normalized_at,
          confidence_score: normalization.canonical.validation.confidence_score,
          completeness_score: normalization.canonical.validation.completeness_score,
          requires_review: normalization.canonical.validation.requires_review,
          issues: normalization.canonical.validation.issues,
        },
        normalized: normalization.canonical,
        view: {
          page: normalization.pageView,
          card: normalization.cardView,
        },
      },
      updated_at: crawledAtIso,
    }

    if (existing) {
      toUpdate.push({ id: existing.id, payload })
    } else {
      toInsert.push({
        ...payload,
        first_detected_at: normalizedPostedAt ?? crawledAtIso,
        created_at: crawledAtIso,
      })
    }
  }

  if (toInsert.length > 0) {
    for (const insertChunk of chunkValues(toInsert, JOB_WRITE_BATCH_SIZE)) {
      const { error } = await ((supabase.from("jobs") as any).insert(insertChunk))
      if (error) throw error
    }
  }

  for (const row of toUpdate) {
    const { error } = await ((supabase.from("jobs") as any).update(row.payload).eq("id", row.id))
    if (error) throw error
  }

  const { data: activeRows, error: activeRowsError } = await (supabase
    .from("jobs")
    .select("id, external_id, last_seen_at")
    .eq("company_id", companyId)
    .eq("is_active", true) as any)
  if (activeRowsError) throw activeRowsError

  const currentExternalIdSet = new Set(externalIds)
  const staleRows = ((activeRows ?? []) as Array<{
    id: string
    external_id: string | null
    last_seen_at: string | null
  }>).filter((row) => row.external_id && !currentExternalIdSet.has(row.external_id))
  const cutoffTs = crawledAt.getTime() - DEACTIVATION_GRACE_HOURS * 60 * 60 * 1000
  const canDeactivateOnThisRun =
    currentExternalIdSet.size > 0 || ALLOW_DEACTIVATE_ON_EMPTY_RESULTS
  const staleIds = canDeactivateOnThisRun
    ? staleRows
        .filter((row) => {
          if (DEACTIVATION_GRACE_HOURS === 0) return true
          const seenTs = row.last_seen_at ? Date.parse(row.last_seen_at) : NaN
          if (!Number.isFinite(seenTs)) return true
          return seenTs <= cutoffTs
        })
        .map((row) => row.id)
    : []

  if (staleIds.length > 0) {
    for (const staleChunk of chunkValues(staleIds, JOB_DEACTIVATE_BATCH_SIZE)) {
      const { error } = await ((supabase.from("jobs") as any)
        .update({ is_active: false, updated_at: crawledAtIso } as any)
        .in("id", staleChunk))
      if (error) throw error
    }
  }

  const { count: activeCount, error: countError } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("is_active", true)

  if (countError) throw countError

  const { error: companyError } = await ((supabase.from("companies") as any)
    .update({
      last_crawled_at: crawledAtIso,
      job_count: activeCount ?? 0,
      updated_at: crawledAtIso,
    } as any)
    .eq("id", companyId))
  if (companyError) throw companyError

  return {
    inserted: toInsert.length,
    updated: toUpdate.length,
    deactivated: staleIds.length,
    activeCount: activeCount ?? 0,
  }
}

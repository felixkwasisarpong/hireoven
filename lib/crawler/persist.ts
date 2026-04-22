import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import type { RawJob } from "@/lib/crawler"
import {
  cleanJobTitle,
  extractSkillsFromText,
  normalizeJobTitle,
} from "@/lib/crawler/normalizer"
import {
  cleanJobDescription,
  fetchJobDescription,
  normalizeJobApplyUrl,
} from "@/lib/jobs/description"

const DESCRIPTION_FETCH_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_DESCRIPTION_FETCH_CONCURRENCY ?? "4", 10)
)
const MAX_DESCRIPTION_FETCHES_PER_COMPANY = Math.max(
  0,
  Number.parseInt(process.env.CRAWLER_MAX_DESCRIPTION_FETCHES_PER_COMPANY ?? "20", 10)
)

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
  const normalized = jobs.map((job) => ({
    ...job,
    url: normalizeJobApplyUrl(job.url),
    externalId: externalIdForJob(job),
    description: cleanJobDescription(job.description ?? null) ?? undefined,
  }))

  const missingDescriptionIndexes = normalized
    .map((job, index) => ({ index, hasDescription: Boolean(job.description), url: job.url }))
    .filter((entry) => !entry.hasDescription && /^https?:\/\//i.test(entry.url))
    .slice(0, MAX_DESCRIPTION_FETCHES_PER_COMPANY)

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

  const externalIds = normalized.map((job) => job.externalId)
  const { data: existingRows, error: existingError } = await (supabase
    .from("jobs")
    .select("id, external_id, description")
    .eq("company_id", companyId)
    .in("external_id", externalIds) as any)

  if (existingError) throw existingError

  const existingByExternalId = new Map<string, { id: string; description: string | null }>()
  for (const row of (existingRows ?? []) as Array<{ id: string; external_id: string; description: string | null }>) {
    existingByExternalId.set(row.external_id, { id: row.id, description: row.description ?? null })
  }

  const toInsert: Array<Record<string, unknown>> = []
  const toUpdate: Array<{ id: string; payload: Record<string, unknown> }> = []

  for (const job of normalized) {
    const normalizedPostedAt = normalizePostedAtToIso(job.postedAt, crawledAt)
    const normalizedDescription = cleanJobDescription(job.description ?? null)
    const cleanedTitle = cleanJobTitle(job.title)
    const existing = existingByExternalId.get(job.externalId)
    const persistedDescription = normalizedDescription ?? existing?.description ?? null
    const payload: Record<string, unknown> = {
      company_id: companyId,
      title: cleanedTitle,
      normalized_title: normalizeJobTitle(cleanedTitle),
      apply_url: job.url,
      location: job.location ?? null,
      description: persistedDescription,
      external_id: job.externalId,
      skills: extractSkillsFromText(cleanedTitle, persistedDescription),
      is_active: true,
      last_seen_at: crawledAtIso,
      raw_data: {
        source: "crawler",
        source_title: job.title,
        posted_at: job.postedAt ?? null,
        posted_at_normalized: normalizedPostedAt,
        description_captured: Boolean(persistedDescription),
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
    const { error } = await ((supabase.from("jobs") as any).insert(toInsert))
    if (error) throw error
  }

  for (const row of toUpdate) {
    const { error } = await ((supabase.from("jobs") as any).update(row.payload).eq("id", row.id))
    if (error) throw error
  }

  const { data: activeRows, error: activeRowsError } = await (supabase
    .from("jobs")
    .select("id, external_id")
    .eq("company_id", companyId)
    .eq("is_active", true) as any)
  if (activeRowsError) throw activeRowsError

  const currentExternalIdSet = new Set(externalIds)
  const staleIds = ((activeRows ?? []) as Array<{ id: string; external_id: string | null }>)
    .filter((row) => row.external_id && !currentExternalIdSet.has(row.external_id))
    .map((row) => row.id)

  if (staleIds.length > 0) {
    const { error } = await ((supabase.from("jobs") as any)
      .update({ is_active: false, updated_at: crawledAtIso } as any)
      .in("id", staleIds))
    if (error) throw error
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

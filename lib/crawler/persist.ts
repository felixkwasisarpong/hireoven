import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import type { RawJob } from "@/lib/crawler"

function externalIdForJob(job: RawJob) {
  if (job.externalId?.trim()) return job.externalId.trim()
  return `url:${crypto.createHash("sha1").update(job.url).digest("hex")}`
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
    externalId: externalIdForJob(job),
  }))

  const externalIds = normalized.map((job) => job.externalId)
  const { data: existingRows, error: existingError } = await (supabase
    .from("jobs")
    .select("id, external_id")
    .eq("company_id", companyId)
    .in("external_id", externalIds) as any)

  if (existingError) throw existingError

  const existingByExternalId = new Map<string, { id: string }>()
  for (const row of (existingRows ?? []) as Array<{ id: string; external_id: string }>) {
    existingByExternalId.set(row.external_id, { id: row.id })
  }

  const toInsert: Array<Record<string, unknown>> = []
  const toUpdate: Array<{ id: string; payload: Record<string, unknown> }> = []

  for (const job of normalized) {
    const payload: Record<string, unknown> = {
      company_id: companyId,
      title: job.title,
      apply_url: job.url,
      location: job.location ?? null,
      external_id: job.externalId,
      is_active: true,
      last_seen_at: crawledAtIso,
      raw_data: {
        source: "crawler",
        posted_at: job.postedAt ?? null,
      },
      updated_at: crawledAtIso,
    }

    const existing = existingByExternalId.get(job.externalId)
    if (existing) {
      toUpdate.push({ id: existing.id, payload })
    } else {
      toInsert.push({
        ...payload,
        first_detected_at: job.postedAt ?? crawledAtIso,
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

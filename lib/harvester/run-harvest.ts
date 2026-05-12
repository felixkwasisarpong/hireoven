import type { Pool } from "pg"
import { detectAdapter } from "@/lib/harvester/adapters"
import { persistJobsBulk } from "@/lib/harvester/persist-bulk"

const TIER_INTERVAL_SEC: Record<string, number> = {
  tier_1: 180,
  tier_2: 1_800,
  tier_3: 21_600,
  tier_dead: 604_800,
}

function tierIntervalSeconds(tier: string | null): number {
  if (!tier) return TIER_INTERVAL_SEC.tier_2
  return TIER_INTERVAL_SEC[tier] ?? TIER_INTERVAL_SEC.tier_2
}

export type AtsHarvestCompany = {
  id: string
  name: string
  careers_url: string
  domain: string | null
  ats_type: string | null
  raw_ats_config: Record<string, unknown> | null
  etag: string | null
  last_modified: string | null
  freshness_tier: string | null
}

export type AtsHarvestOutcome =
  | { matched: false }
  | {
      matched: true
      status: "success" | "unchanged" | "failed"
      jobsFound: number
      newJobs: number
      durationMs: number
      errorMessage: string | null
      crawledAtIso: string
      adapter: string
      upstreamLatencyMs: number
      notModified: boolean
    }

async function updateCompanyHarvestState(
  pool: Pool,
  companyId: string,
  args: {
    etag: string | null
    lastModified: string | null
    intervalSec: number
    crawledAtIso: string
    bumpLastCrawled: boolean
  }
) {
  await pool.query(
    `UPDATE companies
     SET etag = $2,
         last_modified = $3,
         next_harvest_at = now() + ($4 || ' seconds')::interval
         ${args.bumpLastCrawled ? ", last_crawled_at = $5::timestamptz" : ""}
     WHERE id = $1`,
    args.bumpLastCrawled
      ? [companyId, args.etag, args.lastModified, args.intervalSec, args.crawledAtIso]
      : [companyId, args.etag, args.lastModified, args.intervalSec]
  )
}

export async function runAtsHarvest(input: {
  pool: Pool
  company: AtsHarvestCompany
}): Promise<AtsHarvestOutcome> {
  const { pool, company } = input
  const detection = detectAdapter(company.careers_url)
  if (!detection) return { matched: false }

  const startedAt = Date.now()
  const intervalSec = tierIntervalSeconds(company.freshness_tier)
  const adapterName = detection.adapter.name

  try {
    const result = await detection.adapter.fetchJobs({
      slug: detection.slug,
      ctx: { etag: company.etag, lastModified: company.last_modified },
    })
    const crawledAtIso = result.fetchedAt.toISOString()

    if (result.notModified) {
      await updateCompanyHarvestState(pool, company.id, {
        etag: result.etag,
        lastModified: result.lastModified,
        intervalSec,
        crawledAtIso,
        bumpLastCrawled: true,
      })
      return {
        matched: true,
        status: "unchanged",
        jobsFound: 0,
        newJobs: 0,
        durationMs: Date.now() - startedAt,
        errorMessage: null,
        crawledAtIso,
        adapter: adapterName,
        upstreamLatencyMs: result.upstreamLatencyMs,
        notModified: true,
      }
    }

    const persistResult = await persistJobsBulk({
      pool,
      companyId: company.id,
      companyMeta: {
        name: company.name,
        domain: company.domain,
        careersUrl: company.careers_url,
      },
      sourceAts: adapterName,
      sourceAtsSlug: detection.slug,
      crawledAt: result.fetchedAt,
      jobs: result.jobs,
    })

    await updateCompanyHarvestState(pool, company.id, {
      etag: result.etag,
      lastModified: result.lastModified,
      intervalSec,
      crawledAtIso,
      bumpLastCrawled: false,
    })

    return {
      matched: true,
      status: result.jobs.length > 0 ? "success" : "unchanged",
      jobsFound: result.jobs.length,
      newJobs: persistResult.inserted,
      durationMs: Date.now() - startedAt,
      errorMessage: null,
      crawledAtIso,
      adapter: adapterName,
      upstreamLatencyMs: result.upstreamLatencyMs,
      notModified: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      matched: true,
      status: "failed",
      jobsFound: 0,
      newJobs: 0,
      durationMs: Date.now() - startedAt,
      errorMessage: message.slice(0, 800),
      crawledAtIso: new Date().toISOString(),
      adapter: adapterName,
      upstreamLatencyMs: 0,
      notModified: false,
    }
  }
}

export function harvesterFlagEnabled(): boolean {
  return (
    process.env.HARVESTER_USE_NEW_ADAPTERS === "true" ||
    process.env.HARVESTER_USE_NEW_GREENHOUSE === "true"
  )
}

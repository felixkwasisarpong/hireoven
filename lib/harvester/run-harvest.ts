import type { Pool } from "pg"
import { detectAdapter } from "@/lib/harvester/adapters"
import { persistJobsBulk } from "@/lib/harvester/persist-bulk"

const TIER_INTERVAL_SEC: Record<string, number> = {
  tier_1: 180,
  tier_2: 1_800,
  tier_3: 21_600,
  tier_dead: 604_800,
}

const DEFAULT_FAILURE_COOLDOWN_SEC = 1_800
const DEFAULT_HTTP_403_COOLDOWN_SEC = 21_600

function tierIntervalSeconds(tier: string | null): number {
  if (!tier) return TIER_INTERVAL_SEC.tier_2
  return TIER_INTERVAL_SEC[tier] ?? TIER_INTERVAL_SEC.tier_2
}

function failureCooldownSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number.parseInt(env.HARVESTER_FAILURE_COOLDOWN_SECONDS ?? "", 10)
  if (Number.isFinite(raw) && raw >= 60) return raw
  return DEFAULT_FAILURE_COOLDOWN_SEC
}

function http403CooldownSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number.parseInt(env.HARVESTER_HTTP_403_COOLDOWN_SECONDS ?? "", 10)
  if (Number.isFinite(raw) && raw >= 300) return raw
  return DEFAULT_HTTP_403_COOLDOWN_SEC
}

function isHttp403Error(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes("http_403") || lower.includes("http 403") || lower.includes("forbidden")
}

export type AtsHarvestCompany = {
  id: string
  name: string
  careers_url: string
  direct_ats_url?: string | null
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
  const detectionUrl = company.direct_ats_url?.trim() || company.careers_url
  const detection = detectAdapter(detectionUrl)
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
    const crawledAtIso = new Date().toISOString()
    const baseCooldownSec = failureCooldownSeconds()
    const cooldownSec = Math.max(
      intervalSec,
      isHttp403Error(message)
        ? Math.max(baseCooldownSec, http403CooldownSeconds())
        : baseCooldownSec
    )
    try {
      await updateCompanyHarvestState(pool, company.id, {
        etag: company.etag,
        lastModified: company.last_modified,
        intervalSec: cooldownSec,
        crawledAtIso,
        bumpLastCrawled: false,
      })
    } catch {
      // Secondary DB failures should not mask the original adapter error.
    }
    return {
      matched: true,
      status: "failed",
      jobsFound: 0,
      newJobs: 0,
      durationMs: Date.now() - startedAt,
      errorMessage: message.slice(0, 800),
      crawledAtIso,
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

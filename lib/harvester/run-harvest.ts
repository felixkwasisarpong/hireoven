import type { Pool } from "pg"
import { detectAdapter, type AtsAdapter, type AtsName } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { persistJobsBulk } from "@/lib/harvester/persist-bulk"

const TIER_INTERVAL_DEFAULTS: Record<string, number> = {
  tier_1: 180,
  tier_2: 1_800,
  tier_3: 21_600,
  tier_dead: 604_800,
}

const TIER_INTERVAL_ENV: Record<string, string> = {
  tier_1: "HARVESTER_TIER_1_INTERVAL_SEC",
  tier_2: "HARVESTER_TIER_2_INTERVAL_SEC",
  tier_3: "HARVESTER_TIER_3_INTERVAL_SEC",
  tier_dead: "HARVESTER_TIER_DEAD_INTERVAL_SEC",
}

const DEFAULT_FAILURE_COOLDOWN_SEC = 1_800
const DEFAULT_HTTP_403_COOLDOWN_SEC = 21_600
const DEFAULT_HTTP_404_COOLDOWN_SEC = 604_800 // 7 days — board is gone
const ADAPTER_REQUEST_TIMEOUT_MS: Partial<Record<AtsName, number>> = {
  // Slower APIs and large boards often breach the generic 8s transport timeout.
  workday: 20_000,
  smartrecruiters: 12_000,
  ashby: 12_000,
  usajobs: 20_000,
  icims: 15_000,
}

function tierIntervalSeconds(
  tier: string | null,
  env: Record<string, string | undefined> = process.env
): number {
  const key = tier && tier in TIER_INTERVAL_DEFAULTS ? tier : "tier_2"
  const envName = TIER_INTERVAL_ENV[key]
  const raw = Number.parseInt(env[envName] ?? "", 10)
  if (Number.isFinite(raw) && raw >= 60) return raw
  return TIER_INTERVAL_DEFAULTS[key]
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

function http404CooldownSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number.parseInt(env.HARVESTER_HTTP_404_COOLDOWN_SECONDS ?? "", 10)
  if (Number.isFinite(raw) && raw >= 300) return raw
  return DEFAULT_HTTP_404_COOLDOWN_SEC
}

function isHttp403Error(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes("http_403") || lower.includes("http 403") || lower.includes("forbidden")
}

function isHttp404Error(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes("http_404") || lower.includes("http 404") || lower.includes("not found")
}

function adapterRequestTimeoutMs(
  adapter: AtsName,
  env: Record<string, string | undefined> = process.env
): number | undefined {
  const envKey = `HARVESTER_${adapter.toUpperCase()}_REQUEST_TIMEOUT_MS`
  const envRaw = Number.parseInt(env[envKey] ?? "", 10)
  if (Number.isFinite(envRaw) && envRaw >= 1_000) return envRaw
  return ADAPTER_REQUEST_TIMEOUT_MS[adapter]
}

export type AtsHarvestCompany = {
  id: string
  name: string
  careers_url: string
  direct_ats_url?: string | null
  domain: string | null
  ats_type: string | null
  ats_identifier?: string | null
  raw_ats_config: Record<string, unknown> | null
  etag: string | null
  last_modified: string | null
  freshness_tier: string | null
}

function detectCompanyAdapter(
  company: AtsHarvestCompany
): { adapter: AtsAdapter; slug: string } | null {
  const detectionUrl = company.direct_ats_url?.trim() || company.careers_url
  const fromUrl = detectAdapter(detectionUrl)
  if (fromUrl) return fromUrl

  const atsType = company.ats_type?.trim()
  const atsIdentifier = company.ats_identifier?.trim()
  if (!atsType || !atsIdentifier) return null

  const canonicalUrl = canonicalCareersUrl(atsType as AtsName, atsIdentifier)
  return canonicalUrl ? detectAdapter(canonicalUrl) : null
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

// Threshold matches the `min-length` defaults used by the backfill scripts.
// Anything below this isn't a usable description and the adapter should still
// re-attempt a detail fetch.
const ALREADY_DESCRIBED_MIN_LENGTH = 200

async function loadAlreadyDescribedIds(
  pool: Pool,
  companyId: string,
  adapterName: string
): Promise<ReadonlySet<string>> {
  try {
    const { rows } = await pool.query<{ external_id: string }>(
      `SELECT external_id
       FROM jobs
       WHERE company_id = $1
         AND is_active = true
         AND external_id IS NOT NULL
         AND length(description) >= $2
         -- Workday detail HTML used to be flattened into one long line.
         -- Those rows are long, but still need one refresh so headings and
         -- bullets can be preserved for section extraction.
         AND ($3 <> 'workday' OR position(E'\n' in description) > 0)`,
      [companyId, ALREADY_DESCRIBED_MIN_LENGTH, adapterName]
    )
    const out = new Set<string>()
    for (const row of rows) {
      if (row.external_id) out.add(row.external_id)
    }
    return out
  } catch {
    // If the pre-load fails (e.g. transient DB hiccup) we just lose the
    // optimisation for this tick — fall through to the legacy behaviour
    // rather than failing the whole harvest.
    return new Set()
  }
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
  const detection = detectCompanyAdapter(company)
  if (!detection) return { matched: false }

  const startedAt = Date.now()
  const intervalSec = tierIntervalSeconds(company.freshness_tier)
  const adapterName = detection.adapter.name

  // Pre-load externalIds of jobs that already have a real description in the
  // DB. Adapters with per-cycle detail-fetch caps use this to skip jobs that
  // don't need re-fetching, so the cap budget goes to jobs that still need a
  // description. Adapters without a detail-fetch step ignore the field.
  const alreadyDescribedIds = await loadAlreadyDescribedIds(pool, company.id, adapterName)

  try {
    const result = await detection.adapter.fetchJobs({
      slug: detection.slug,
      ctx: {
        etag: company.etag,
        lastModified: company.last_modified,
        alreadyDescribedIds,
        timeoutMs: adapterRequestTimeoutMs(adapterName as AtsName),
      },
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
      isHttp404Error(message)
        ? Math.max(baseCooldownSec, http404CooldownSeconds())
        : isHttp403Error(message)
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

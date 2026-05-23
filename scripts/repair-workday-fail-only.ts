/**
 * Focused repair pass for fail-only Workday companies.
 *
 * Scope:
 * - Companies with ats_type='workday' that have only failure-like crawl logs
 *   in the selected window (no success/unchanged rows).
 * - Attempts to repair ats_identifier/direct_ats_url from existing URLs or
 *   Workday site resolver.
 * - Demotes obvious non-Workday rows to custom so the legacy crawler handles them.
 *
 * Usage:
 *   npx tsx scripts/repair-workday-fail-only.ts
 *   npx tsx scripts/repair-workday-fail-only.ts --execute
 *   npx tsx scripts/repair-workday-fail-only.ts --execute --reharvest
 *   npx tsx scripts/repair-workday-fail-only.ts --limit=80 --concurrency=4
 *   npx tsx scripts/repair-workday-fail-only.ts --since-hours=12 --execute
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"
import { workdayAdapter } from "@/lib/harvester/adapters/workday"
import { resolveWorkdaySite } from "@/lib/harvester/discovery/workday-resolver"
import { runAtsHarvest, type AtsHarvestCompany } from "@/lib/harvester/run-harvest"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const execute = args.includes("--execute")
const reharvest = args.includes("--reharvest")

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

const limit = Math.max(1, Number.parseInt(arg("limit") ?? "120", 10))
const concurrency = Math.max(1, Number.parseInt(arg("concurrency") ?? "6", 10))
const sinceHours = Math.max(1, Number.parseInt(arg("since-hours") ?? "", 10))
const HARD_FAIL_MIN = Math.max(1, Number.parseInt(arg("min-fails") ?? "3", 10))

const WD_HOST_RE = /^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/i
let pool: Pool | null = null

function getPool(): Pool {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL / TARGET_POSTGRES_URL")
  pool = new Pool({
    connectionString,
    // DB authentication can exceed 10s under load; avoid false timeouts.
    connectionTimeoutMillis: 90_000,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
  return pool
}

type Candidate = {
  id: string
  name: string
  domain: string | null
  careers_url: string
  direct_ats_url: string | null
  ats_identifier: string | null
  raw_ats_config: Record<string, unknown> | null
  etag: string | null
  last_modified: string | null
  freshness_tier: string | null
  fail_runs: number
  success_runs: number
  unchanged_runs: number
  sample_error: string | null
}

type FixPlan =
  | {
      kind: "set_workday"
      slug: string
      directAtsUrl: string
      patchCareersUrl: string | null
      reason: string
    }
  | {
      kind: "demote_custom"
      reason: string
    }
  | {
      kind: "none"
      reason: string
    }

function isWorkdayUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return WD_HOST_RE.test(host)
  } catch {
    return false
  }
}

function workdayHostParts(url: string): { tenant: string; wd: string } | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    const match = host.match(WD_HOST_RE)
    if (!match) return null
    return { tenant: match[1], wd: match[2] }
  } catch {
    return null
  }
}

function slugToDirectAtsUrl(slug: string): string | null {
  const parts = slug.split(":")
  if (parts.length !== 3) return null
  const [tenant, wd, site] = parts
  if (!tenant || !wd || !site) return null
  return `https://${tenant}.${wd}.myworkdayjobs.com/${encodeURIComponent(site)}`
}

function needsCareersPatch(url: string): boolean {
  const lower = url.toLowerCase()
  if (lower.includes("/login")) return true
  if (!isWorkdayUrl(url)) return true
  return false
}

async function planFix(row: Candidate): Promise<FixPlan> {
  const detectTargets = [row.direct_ats_url, row.careers_url].filter(
    (value): value is string => Boolean(value)
  )

  for (const target of detectTargets) {
    const detected = workdayAdapter.detectFromUrl(target)
    if (detected?.slug) {
      const directAtsUrl = slugToDirectAtsUrl(detected.slug)
      if (!directAtsUrl) {
        return { kind: "none", reason: `detected invalid slug ${detected.slug}` }
      }
      return {
        kind: "set_workday",
        slug: detected.slug,
        directAtsUrl,
        patchCareersUrl: needsCareersPatch(row.careers_url) ? directAtsUrl : null,
        reason: row.direct_ats_url
          ? "detected slug from direct_ats_url/careers_url"
          : "detected slug from careers_url",
      }
    }
  }

  const hostSource = detectTargets.find((url) => isWorkdayUrl(url))
  if (hostSource) {
    const parsed = workdayHostParts(hostSource)
    if (!parsed) {
      return { kind: "none", reason: "workday host parse failed" }
    }
    const resolved = await resolveWorkdaySite({
      tenant: parsed.tenant,
      wd: parsed.wd,
      timeoutMs: 12000,
    })
    if (!resolved) {
      return { kind: "none", reason: "workday resolver did not find site" }
    }
    const slug = `${parsed.tenant}:${parsed.wd}:${resolved.site}`
    const directAtsUrl = slugToDirectAtsUrl(slug)
    if (!directAtsUrl) return { kind: "none", reason: "resolved slug invalid" }
    return {
      kind: "set_workday",
      slug,
      directAtsUrl,
      patchCareersUrl: needsCareersPatch(row.careers_url) ? directAtsUrl : null,
      reason: `resolved site via ${resolved.source}`,
    }
  }

  return {
    kind: "demote_custom",
    reason: "ats_type=workday but neither careers_url nor direct_ats_url is workday-hosted",
  }
}

async function loadCandidates(): Promise<Candidate[]> {
  const pool = getPool()
  const sql = Number.isFinite(sinceHours)
    ? `
      WITH w AS (
        SELECT now() - ($1::int || ' hours')::interval AS s
      ),
      agg AS (
        SELECT
          co.id,
          co.name,
          co.domain,
          co.careers_url,
          co.direct_ats_url,
          co.ats_identifier,
          co.raw_ats_config,
          co.etag,
          co.last_modified,
          co.freshness_tier,
          COUNT(*) FILTER (WHERE cl.status IN ('failed','fetch_error','blocked','bad_url'))::int AS fail_runs,
          COUNT(*) FILTER (WHERE cl.status = 'success')::int AS success_runs,
          COUNT(*) FILTER (WHERE cl.status = 'unchanged')::int AS unchanged_runs,
          LEFT(MAX(cl.error_message) FILTER (WHERE cl.error_message IS NOT NULL), 180) AS sample_error
        FROM companies co
        JOIN crawl_logs cl ON cl.company_id = co.id
        JOIN w ON true
        WHERE co.ats_type = 'workday'
          AND co.status = 'active'
          AND co.is_active = true
          AND co.duplicate_of_company_id IS NULL
          AND cl.crawled_at >= w.s
        GROUP BY
          co.id, co.name, co.domain, co.careers_url, co.direct_ats_url,
          co.ats_identifier, co.raw_ats_config, co.etag, co.last_modified, co.freshness_tier
      )
      SELECT *
      FROM agg
      WHERE fail_runs >= $2
        AND success_runs = 0
        AND unchanged_runs = 0
      ORDER BY fail_runs DESC, name
      LIMIT $3
    `
    : `
      WITH w AS (
        SELECT (date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago') AS s
      ),
      agg AS (
        SELECT
          co.id,
          co.name,
          co.domain,
          co.careers_url,
          co.direct_ats_url,
          co.ats_identifier,
          co.raw_ats_config,
          co.etag,
          co.last_modified,
          co.freshness_tier,
          COUNT(*) FILTER (WHERE cl.status IN ('failed','fetch_error','blocked','bad_url'))::int AS fail_runs,
          COUNT(*) FILTER (WHERE cl.status = 'success')::int AS success_runs,
          COUNT(*) FILTER (WHERE cl.status = 'unchanged')::int AS unchanged_runs,
          LEFT(MAX(cl.error_message) FILTER (WHERE cl.error_message IS NOT NULL), 180) AS sample_error
        FROM companies co
        JOIN crawl_logs cl ON cl.company_id = co.id
        JOIN w ON true
        WHERE co.ats_type = 'workday'
          AND co.status = 'active'
          AND co.is_active = true
          AND co.duplicate_of_company_id IS NULL
          AND cl.crawled_at >= w.s
        GROUP BY
          co.id, co.name, co.domain, co.careers_url, co.direct_ats_url,
          co.ats_identifier, co.raw_ats_config, co.etag, co.last_modified, co.freshness_tier
      )
      SELECT *
      FROM agg
      WHERE fail_runs >= $1
        AND success_runs = 0
        AND unchanged_runs = 0
      ORDER BY fail_runs DESC, name
      LIMIT $2
    `

  const params = Number.isFinite(sinceHours)
    ? [sinceHours, HARD_FAIL_MIN, limit]
    : [HARD_FAIL_MIN, limit]

  const { rows } = await pool.query<Candidate>(sql, params)
  return rows
}

async function applyFix(row: Candidate, fix: Exclude<FixPlan, { kind: "none" }>): Promise<void> {
  const pool = getPool()
  if (fix.kind === "set_workday") {
    await pool.query(
      `UPDATE companies
          SET ats_type='workday',
              ats_identifier=$2,
              direct_ats_url=$3,
              careers_url=COALESCE($4, careers_url),
              next_harvest_at=NULL,
              updated_at=now(),
              raw_ats_config=COALESCE(raw_ats_config, '{}'::jsonb) || jsonb_build_object(
                'workday_fail_only_fix',
                jsonb_build_object(
                  'fixed_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  'reason', $5::text
                )
              )
        WHERE id=$1`,
      [row.id, fix.slug, fix.directAtsUrl, fix.patchCareersUrl, fix.reason]
    )
    return
  }

  await pool.query(
    `UPDATE companies
        SET ats_type='custom',
            ats_identifier=NULL,
            direct_ats_url=NULL,
            next_harvest_at=NULL,
            freshness_tier=CASE WHEN freshness_tier='tier_1' THEN 'tier_2' ELSE freshness_tier END,
            updated_at=now(),
            raw_ats_config=COALESCE(raw_ats_config, '{}'::jsonb) || jsonb_build_object(
              'workday_fail_only_fix',
              jsonb_build_object(
                'fixed_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'reason', $2::text
              )
            )
      WHERE id=$1`,
    [row.id, fix.reason]
  )
}

async function runReharvest(row: Candidate): Promise<string> {
  const pool = getPool()
  const { rows } = await pool.query<AtsHarvestCompany>(
    `SELECT id, name, careers_url, direct_ats_url, domain, ats_type, ats_identifier,
            raw_ats_config, etag, last_modified, freshness_tier
       FROM companies
      WHERE id = $1`,
    [row.id]
  )
  const company = rows[0]
  if (!company) return "missing_after_update"
  const outcome = await runAtsHarvest({ pool, company })
  if (!outcome.matched) return "no_match"
  if (outcome.status === "failed") return `failed:${outcome.errorMessage ?? "unknown"}`
  return `${outcome.status}:jobs=${outcome.jobsFound}:new=${outcome.newJobs}`
}

async function main() {
  console.log(
    `[repair-workday-fail-only] mode=${execute ? "EXECUTE" : "dry-run"} reharvest=${reharvest} limit=${limit} concurrency=${concurrency} minFails=${HARD_FAIL_MIN}${Number.isFinite(sinceHours) ? ` sinceHours=${sinceHours}` : " window=today@America/Chicago"}`
  )

  const candidates = await loadCandidates()
  console.log(`[repair-workday-fail-only] candidates=${candidates.length}`)
  if (candidates.length === 0) {
    await getPool().end()
    return
  }

  let plannedSetWorkday = 0
  let plannedDemote = 0
  let plannedNone = 0
  let applied = 0
  let reharvestOk = 0
  let reharvestFail = 0

  const limiter = pLimit(concurrency)
  await Promise.all(
    candidates.map((row) =>
      limiter(async () => {
        const fix = await planFix(row)
        if (fix.kind === "set_workday") plannedSetWorkday += 1
        else if (fix.kind === "demote_custom") plannedDemote += 1
        else plannedNone += 1

        console.log(
          `[${execute ? "apply" : "plan"}] ${row.name} fails=${row.fail_runs} :: ${fix.kind} :: ${fix.reason}`
        )

        if (!execute || fix.kind === "none") return
        await applyFix(row, fix)
        applied += 1

        if (!reharvest) return
        const result = await runReharvest(row)
        const ok =
          result.startsWith("success:") ||
          result.startsWith("unchanged:") ||
          result.startsWith("no_match")
        if (ok) reharvestOk += 1
        else reharvestFail += 1
        console.log(`[reharvest] ${row.name} -> ${result}`)
      })
    )
  )

  console.log(
    `[repair-workday-fail-only] planned set_workday=${plannedSetWorkday} demote_custom=${plannedDemote} no_change=${plannedNone}`
  )
  if (execute) {
    console.log(`[repair-workday-fail-only] applied=${applied}`)
    if (reharvest) {
      console.log(
        `[repair-workday-fail-only] reharvest ok=${reharvestOk} fail=${reharvestFail}`
      )
    }
  }

  await getPool().end()
}

main().catch(async (error) => {
  console.error("[repair-workday-fail-only] fatal:", error)
  try {
    await getPool().end()
  } catch {}
  process.exit(1)
})

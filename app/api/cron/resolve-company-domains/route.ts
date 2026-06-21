/**
 * GET /api/cron/resolve-company-domains
 *
 * The front of the company domain-resolution pipeline. Many companies enter the
 * DB name-only — aggregator ingest and name-only discovery leave a placeholder
 * domain (`<slug>.placeholder`, `<slug>.builtin-discovery`) and no ATS. With no
 * real (or guessed) domain, `discover-from-domains` skips them entirely, so they
 * never get a careers page, never get an ATS, and never produce jobs.
 *
 * This cron resolves a real domain from the company name (heuristic slug +
 * Clearbit autocomplete, validated against the homepage) and writes it to
 * `raw_ats_config.guessed_domain` — exactly the field `discover-from-domains`
 * already reads. It deliberately does NOT touch the canonical `companies.domain`
 * (a guess stays a guess until a downstream careers/ATS probe confirms it), so
 * a wrong guess can't corrupt a confirmed domain.
 *
 * Pipeline:  resolve-company-domains → discover-from-domains → careers-url-discovery
 *
 * Env:
 *   CRON_SECRET                          required auth header
 *   RESOLVE_COMPANY_DOMAINS_ENABLED      must be "true" to write (safe rollout; dry runs ignore it)
 *   RESOLVE_COMPANY_DOMAINS_BATCH        companies per run (default 50)
 *   RESOLVE_COMPANY_DOMAINS_CONCURRENCY  parallel companies (default 6)
 *   RESOLVE_COMPANY_DOMAINS_RETRY_HOURS  re-attempt a previous miss after N hours (default 168)
 *   RESOLVE_COMPANY_DOMAINS_ENABLE_CLEARBIT  set to "true" to also try Clearbit
 *                                        autocomplete (off by default — lower
 *                                        precision than the heuristic resolver)
 * Query:
 *   ?dry=1                               resolve but never write (measure hit-rate)
 *   ?batch=50&concurrency=6              override batch/concurrency
 */

import { NextRequest, NextResponse } from "next/server"
import pLimit from "p-limit"
import type { Pool } from "pg"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { resolveCompanyDomainFromName } from "@/lib/companies/domain-resolution"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

export const runtime = "nodejs"
export const maxDuration = 300

const TIME_BUDGET_MS = 250_000
const PROBE_TIMEOUT_MS = 6_000

function intParamOrEnv(params: URLSearchParams, param: string, env: string, fallback: number): number {
  const fromParam = Number.parseInt(params.get(param) ?? "", 10)
  if (Number.isFinite(fromParam) && fromParam > 0) return fromParam
  const fromEnv = Number.parseInt(process.env[env] ?? "", 10)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : fallback
}

type CompanyRow = { id: string; name: string }

// Name-only placeholder rows: no ATS, no usable domain, no guess yet, and not
// recently attempted. Ordered so companies that already have live jobs (i.e.
// matter most) get resolved first.
function claimSelect(): string {
  return `
    SELECT c.id, c.name
      FROM companies c
     WHERE c.ats_type IS NULL
       AND c.duplicate_of_company_id IS NULL
       AND COALESCE(c.status, 'active') <> 'dead'
       AND c.name IS NOT NULL AND length(trim(c.name)) >= 2
       AND (
         c.domain ILIKE '%.placeholder'
         OR c.domain ILIKE '%.builtin-discovery'
       )
       AND COALESCE(c.raw_ats_config->>'guessed_domain', '') = ''
       AND (
         c.raw_ats_config->>'domain_resolution_attempted_at' IS NULL
         OR (c.raw_ats_config->>'domain_resolution_attempted_at')::timestamptz
              < now() - ($2::int || ' hours')::interval
       )
     ORDER BY c.job_count DESC NULLS LAST, c.created_at ASC NULLS LAST
     LIMIT $1
     FOR UPDATE OF c SKIP LOCKED`
}

async function claimBatch(pool: Pool, batch: number, retryHours: number, dry: boolean): Promise<CompanyRow[]> {
  if (dry) {
    const { rows } = await pool.query<CompanyRow>(claimSelect(), [batch, retryHours])
    return rows
  }
  // Stamp the attempt as we claim so concurrent/next runs skip these rows.
  const { rows } = await pool.query<CompanyRow>(
    `WITH candidates AS (${claimSelect()}),
          claimed AS (
            UPDATE companies c
               SET raw_ats_config = COALESCE(c.raw_ats_config, '{}'::jsonb)
                     || jsonb_build_object('domain_resolution_attempted_at', to_jsonb(now())),
                   updated_at = now()
              FROM candidates
             WHERE c.id = candidates.id
             RETURNING c.id, c.name
          )
     SELECT * FROM claimed`,
    [batch, retryHours]
  )
  return rows
}

async function recordResolution(
  pool: Pool,
  companyId: string,
  domain: string,
  method: string,
  confidence: string
): Promise<void> {
  const logoUrl = companyLogoUrlFromDomain(domain)
  await pool.query(
    `UPDATE companies
        SET raw_ats_config = COALESCE(raw_ats_config, '{}'::jsonb)
              || jsonb_build_object(
                   'guessed_domain', $2::text,
                   'domain_resolution', jsonb_build_object(
                     'domain', $2::text,
                     'method', $3::text,
                     'confidence', $4::text,
                     'resolved_at', to_jsonb(now())
                   )
                 ),
            logo_url = CASE
              WHEN (logo_url IS NULL OR logo_url = '') AND $5 <> '' THEN $5
              ELSE logo_url END,
            updated_at = now()
      WHERE id = $1`,
    [companyId, domain, method, confidence, logoUrl]
  )
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const params = request.nextUrl.searchParams
  const dry = params.get("dry") === "1"
  const enabled = process.env.RESOLVE_COMPANY_DOMAINS_ENABLED === "true"
  if (!enabled && !dry) {
    return NextResponse.json({
      skipped: true,
      reason: "RESOLVE_COMPANY_DOMAINS_ENABLED is not 'true' (set it to enable; or call with ?dry=1)",
    })
  }

  const batch = intParamOrEnv(params, "batch", "RESOLVE_COMPANY_DOMAINS_BATCH", 50)
  const concurrency = intParamOrEnv(params, "concurrency", "RESOLVE_COMPANY_DOMAINS_CONCURRENCY", 6)
  const retryHours = intParamOrEnv(params, "retryHours", "RESOLVE_COMPANY_DOMAINS_RETRY_HOURS", 168)
  const disableClearbit = process.env.RESOLVE_COMPANY_DOMAINS_ENABLE_CLEARBIT !== "true"

  const pool = getPostgresPool()
  const companies = await claimBatch(pool, batch, retryHours, dry)

  const stats = {
    dry,
    claimed: companies.length,
    resolved: 0,
    missed: 0,
    skippedForTime: 0,
    byMethod: { heuristic: 0, clearbit: 0 } as Record<string, number>,
  }
  const samples: Array<{ name: string; domain: string; method: string; confidence: string }> = []

  const startedAt = Date.now()
  const limit = pLimit(concurrency)
  await Promise.all(
    companies.map((company) =>
      limit(async () => {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          stats.skippedForTime += 1
          return
        }
        let resolved
        try {
          resolved = await resolveCompanyDomainFromName(company.name, {
            timeoutMs: PROBE_TIMEOUT_MS,
            disableClearbit,
          })
        } catch (err) {
          console.error(`[resolve-company-domains] "${company.name}" failed:`, err)
          stats.missed += 1
          return
        }
        if (!resolved) {
          stats.missed += 1
          return
        }
        stats.resolved += 1
        stats.byMethod[resolved.method] = (stats.byMethod[resolved.method] ?? 0) + 1
        if (samples.length < 25) {
          samples.push({ name: company.name, domain: resolved.domain, method: resolved.method, confidence: resolved.confidence })
        }
        if (!dry) {
          await recordResolution(pool, company.id, resolved.domain, resolved.method, resolved.confidence)
        }
      })
    )
  )

  return NextResponse.json({ ok: true, ...stats, samples })
}

/**
 * Aggregator → ATS-tenant backsolve, shared by adzuna-ingest and dice-ingest.
 *
 * For an aggregator job that carries an apply URL, try to resolve the real ATS
 * board behind it (resolveApplyUrlToAtsTenant) and act on the result:
 *   - confident hit  → enroll a real harvestable company (enrollTenantAsCompany)
 *   - transient fail → register the tenant for retry with backoff (no company)
 *   - no ATS at all  → caller falls back to a legacy placeholder
 *
 * Returns a discriminated outcome so each cron keeps its own placeholder SQL
 * (the domain/careers_url derivation differs per source). Structured logs are
 * emitted at every branch (proper metrics arrive in a later prompt).
 */

import type { Pool } from "pg"
import { resolveApplyUrlToAtsTenant } from "@/lib/discovery/resolve-apply-url-to-tenant"
import { enrollTenantAsCompany } from "@/lib/discovery/enroll-tenant-as-company"
import { counter } from "@/lib/observability/metrics"

export type AggregatorSource = "adzuna" | "dice"

export type BacksolveOutcome =
  /** A real company was enrolled (or matched) — use this companyId. */
  | { kind: "enrolled"; companyId: string }
  /** Transient failure / empty-but-known board recorded for retry — no company this tick. */
  | { kind: "retry_later" }
  /** Genuine aggregator-only job — caller should create a placeholder. */
  | { kind: "placeholder"; discoveredVia: string }

/** errorReasons that are transient/board-side — worth a backoff retry, not a placeholder. */
const RETRY_REASONS = new Set(["fetch_failed", "timeout", "board_error", "rate_limited", "redirect_loop"])

export async function backsolveAggregatorCompany(
  pool: Pool,
  args: { source: AggregatorSource; applyUrl: string | null | undefined; companyName: string },
): Promise<BacksolveOutcome> {
  const { source, companyName } = args
  const applyUrl = args.applyUrl?.trim() || null

  // 3. No apply URL → existing placeholder behaviour, tagged for measurement.
  if (!applyUrl) {
    log({ source, applyUrl: null, decision: "placeholder_no_apply_url", durationMs: 0 })
    return { kind: "placeholder", discoveredVia: `${source}-no-apply-url` }
  }

  const t0 = Date.now()
  const result = await resolveApplyUrlToAtsTenant(applyUrl, source)
  const durationMs = Date.now() - t0
  const { atsType, atsIdentifier, errorReason } = result

  // 2b. Confident hit → enroll a real company.
  if (result.success && result.confidence >= 60 && atsType && atsIdentifier) {
    try {
      const enrolled = await enrollTenantAsCompany(pool, {
        atsType,
        atsIdentifier,
        confidence: result.confidence,
        jobCount: result.jobCount,
        sourceUrl: applyUrl,
        sourceType: source,
        companyNameGuess: companyName,
        domainGuess: result.domainGuess,
      })
      log({ source, applyUrl, atsType, atsIdentifier, decision: "enrolled", durationMs })
      return { kind: "enrolled", companyId: enrolled.companyId }
    } catch (err) {
      // Enrollment is the only DB-heavy step; if it fails, defer rather than
      // create a placeholder for a company we know has a real board.
      log({ source, applyUrl, atsType, atsIdentifier, decision: "retry_later", errorReason: "enroll_failed", durationMs })
      if (atsType && atsIdentifier) {
        await upsertRetryLaterTenant(pool, { source, applyUrl, companyName, atsType, atsIdentifier, result, errorReason: "enroll_failed" })
      }
      return { kind: "retry_later" }
    }
  }

  // 2c. Transient / board-side failure → register for backoff retry, no company.
  if (errorReason && RETRY_REASONS.has(errorReason)) {
    // We can only key ats_tenants when detection actually produced an ATS pair
    // (e.g. board_error). Pure fetch/timeout/loop failures have no pair to store;
    // they self-retry on the next ingest tick instead.
    if (atsType && atsIdentifier) {
      await upsertRetryLaterTenant(pool, { source, applyUrl, companyName, atsType, atsIdentifier, result, errorReason })
    }
    counter("tenant.retry_later", { atsType: atsType ?? "unknown", sourceType: source, reason: errorReason })
    log({ source, applyUrl, atsType, atsIdentifier, decision: "retry_later", errorReason, durationMs })
    return { kind: "retry_later" }
  }

  // 2d. Genuine aggregator-only job (no_ats_match, or any other terminal case) →
  //     placeholder, tagged so we can measure how often this happens.
  log({ source, applyUrl, atsType, atsIdentifier, decision: "placeholder_no_ats", errorReason, durationMs })
  return { kind: "placeholder", discoveredVia: `${source}-no-ats` }
}

/**
 * Upsert a retry_later tenant with exponential-ish backoff keyed on attempts:
 *   1 → 1h, 2 → 6h, 3 → 24h, 4+ → 7d.
 */
async function upsertRetryLaterTenant(
  pool: Pool,
  args: {
    source: AggregatorSource
    applyUrl: string
    companyName: string
    atsType: string
    atsIdentifier: string
    result: { confidence: number; jobCount?: number; domainGuess?: string }
    errorReason: string
  },
): Promise<void> {
  await pool
    .query(
      `INSERT INTO ats_tenants
         (ats_type, ats_identifier, source_url, source_type, company_name_guess, domain_guess,
          confidence, job_count, status, error_reason, attempts, last_checked_at, next_check_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'retry_later',$9, 1, now(), now() + interval '1 hour')
       ON CONFLICT (ats_type, ats_identifier) DO UPDATE
         SET attempts        = ats_tenants.attempts + 1,
             error_reason    = EXCLUDED.error_reason,
             status          = CASE WHEN ats_tenants.status = 'enrolled' THEN 'enrolled' ELSE 'retry_later' END,
             confidence      = GREATEST(ats_tenants.confidence, EXCLUDED.confidence),
             source_url      = COALESCE(EXCLUDED.source_url, ats_tenants.source_url),
             company_name_guess = COALESCE(EXCLUDED.company_name_guess, ats_tenants.company_name_guess),
             last_checked_at = now(),
             next_check_at   = now() + (CASE
                                 WHEN ats_tenants.attempts + 1 = 1 THEN interval '1 hour'
                                 WHEN ats_tenants.attempts + 1 = 2 THEN interval '6 hours'
                                 WHEN ats_tenants.attempts + 1 = 3 THEN interval '24 hours'
                                 ELSE interval '7 days' END),
             updated_at      = now()`,
      [
        args.atsType,
        args.atsIdentifier,
        args.applyUrl,
        args.source,
        args.companyName,
        args.result.domainGuess ?? null,
        args.result.confidence,
        args.result.jobCount ?? 0,
        args.errorReason,
      ],
    )
    .catch(() => { /* non-fatal — never let a retry-bookkeeping failure break ingest */ })
}

function log(fields: {
  source: AggregatorSource
  applyUrl: string | null
  atsType?: string
  atsIdentifier?: string
  decision: string
  errorReason?: string
  durationMs: number
}): void {
  console.log(
    JSON.stringify({
      event: "aggregator_backsolve",
      source: fields.source,
      applyUrl: fields.applyUrl,
      atsType: fields.atsType ?? null,
      atsIdentifier: fields.atsIdentifier ?? null,
      decision: fields.decision,
      errorReason: fields.errorReason ?? null,
      durationMs: fields.durationMs,
    }),
  )
}

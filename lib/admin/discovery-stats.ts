/**
 * Discovery-pipeline stats for the admin dashboard.
 *
 * Durable numbers (publication_status breakdown, placeholder→tenant conversion)
 * come from SQL so they survive process restarts. Flow rates (backsolve,
 * enroll, retry, throttle) come from the in-process 24h metrics snapshot.
 */

import type { Pool } from "pg"
import { snapshot24h, sumCounter, labelValues } from "@/lib/observability/metrics"

export interface DiscoveryStats {
  generatedAt: string
  last24h: {
    tenants_discovered: number
    tenants_validated: number
    tenants_enrolled: number
    tenants_rejected: number
    tenants_retry_later: number
    backsolve_attempt: number
    backsolve_success: number
    backsolve_failure: number
    backsolve_success_rate: number
    placeholder_to_tenant_conversion: number
    jobs_persisted_total: number
    jobs_publication_status_breakdown: Record<string, number>
    rate_limit_throttled: number
  }
  by_source: Record<string, SourceStats>
  by_ats: Record<string, AtsStats>
  /** Adzuna truncated-job recovery: how many were queued for enrichment and how
   *  many got promoted into the feed (24h, from in-process metrics). */
  adzuna_enrich: {
    pending_inserted: number
    enriched_attempted: number
    promoted: number
    conversion_rate: number
  }
  /** Per-source ingest health (24h). A source with runs>0 but fetched≈0 — or a
   *  nonzero fetch_errors — silently broke upstream while still returning 200. */
  source_ingest: Record<string, SourceIngestStats>
  /** discover-companies board probes (24h): separates a reachably-empty board
   *  from an unreachable one (timeout/WAF). A spike in `error` ≈ an IP block. */
  board_probe: {
    has_jobs: number
    empty: number
    error: number
    error_rate: number
  }
}

interface SourceStats {
  backsolve_attempt: number
  backsolve_success: number
  backsolve_failure: number
  tenants_enrolled: number
  tenants_retry_later: number
}
interface AtsStats {
  backsolve_success: number
  tenants_enrolled: number
  jobs_persisted: number
}
interface SourceIngestStats {
  runs: number
  fetched: number
  inserted: number
  updated: number
  hidden_low_quality: number
  upsert_errors: number
  fetch_errors: number
}

export async function buildDiscoveryStats(pool: Pool): Promise<DiscoveryStats> {
  const snap = snapshot24h()

  // ── Durable SQL ──
  const pubRes = await pool.query<{ publication_status: string | null; n: number }>(
    `SELECT publication_status, COUNT(*)::int AS n
       FROM jobs WHERE is_active = true
      GROUP BY publication_status`,
  )
  const jobs_publication_status_breakdown: Record<string, number> = {}
  for (const r of pubRes.rows) {
    jobs_publication_status_breakdown[r.publication_status ?? "published"] = r.n
  }

  const convRes = await pool.query<{ total: number; enrolled: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'enrolled')::int AS enrolled
       FROM ats_tenants`,
  )
  const convTotal = convRes.rows[0]?.total ?? 0
  const convEnrolled = convRes.rows[0]?.enrolled ?? 0
  const placeholder_to_tenant_conversion = convTotal > 0 ? round(convEnrolled / convTotal) : 0

  const tenantFlowRes = await pool.query<{
    discovered: number
    validated: number
    enrolled: number
    rejected: number
    retry_later: number
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS discovered,
       COUNT(*) FILTER (
         WHERE status = 'validated'
           AND updated_at >= now() - interval '24 hours'
       )::int AS validated,
       COUNT(*) FILTER (
         WHERE status = 'enrolled'
           AND updated_at >= now() - interval '24 hours'
       )::int AS enrolled,
       COUNT(*) FILTER (
         WHERE status = 'rejected'
           AND updated_at >= now() - interval '24 hours'
       )::int AS rejected,
       COUNT(*) FILTER (
         WHERE status = 'retry_later'
           AND updated_at >= now() - interval '24 hours'
       )::int AS retry_later
     FROM ats_tenants`,
  )
  const tenantFlowRow = tenantFlowRes.rows[0]
  const tenantFlow = {
    discovered: tenantFlowRow?.discovered ?? 0,
    validated: tenantFlowRow?.validated ?? 0,
    enrolled: tenantFlowRow?.enrolled ?? 0,
    rejected: tenantFlowRow?.rejected ?? 0,
    retry_later: tenantFlowRow?.retry_later ?? 0,
  }

  const runFlowRes = await pool.query<{
    enrolled: number
    held: number
    rejected: number
  }>(
    `SELECT
       COALESCE(SUM(candidates_enrolled), 0)::int AS enrolled,
       COALESCE(SUM(candidates_held), 0)::int AS held,
       COALESCE(SUM(candidates_rejected), 0)::int AS rejected
     FROM discovery_runs
     WHERE ran_at >= now() - interval '24 hours'`,
  )
  const runFlowRow = runFlowRes.rows[0]
  const runFlow = {
    enrolled: runFlowRow?.enrolled ?? 0,
    held: runFlowRow?.held ?? 0,
    rejected: runFlowRow?.rejected ?? 0,
  }

  // ── In-memory 24h flow rates ──
  const attempt = sumCounter(snap, "apply_url.backsolve.attempt")
  const success = sumCounter(snap, "apply_url.backsolve.success")
  const failure = sumCounter(snap, "apply_url.backsolve.failure")

  const last24h: DiscoveryStats["last24h"] = {
    tenants_discovered: Math.max(sumCounter(snap, "tenant.discovered"), tenantFlow.discovered),
    tenants_validated: Math.max(sumCounter(snap, "tenant.validated"), tenantFlow.validated),
    tenants_enrolled: Math.max(sumCounter(snap, "tenant.enrolled"), tenantFlow.enrolled, runFlow.enrolled),
    tenants_rejected: Math.max(sumCounter(snap, "tenant.rejected"), tenantFlow.rejected, runFlow.rejected),
    tenants_retry_later: Math.max(sumCounter(snap, "tenant.retry_later"), tenantFlow.retry_later, runFlow.held),
    backsolve_attempt: attempt,
    backsolve_success: success,
    backsolve_failure: failure,
    backsolve_success_rate: attempt > 0 ? round(success / attempt) : 0,
    placeholder_to_tenant_conversion,
    jobs_persisted_total: sumCounter(snap, "jobs.persisted"),
    jobs_publication_status_breakdown,
    rate_limit_throttled: sumCounter(snap, "ats_rate_limit.throttled"),
  }

  // ── Per-source ──
  const sources = new Set<string>([
    "adzuna",
    "dice",
    "jsearch",
    "manual",
    ...labelValues(snap, ["apply_url.backsolve.attempt", "tenant.enrolled", "tenant.retry_later"], "sourceType"),
  ])
  const by_source: Record<string, SourceStats> = {}
  for (const s of sources) {
    by_source[s] = {
      backsolve_attempt: sumCounter(snap, "apply_url.backsolve.attempt", { sourceType: s }),
      backsolve_success: sumCounter(snap, "apply_url.backsolve.success", { sourceType: s }),
      backsolve_failure: sumCounter(snap, "apply_url.backsolve.failure", { sourceType: s }),
      tenants_enrolled: sumCounter(snap, "tenant.enrolled", { sourceType: s }),
      tenants_retry_later: sumCounter(snap, "tenant.retry_later", { sourceType: s }),
    }
  }

  // ── Per-ATS ──
  const atses = new Set<string>(
    labelValues(snap, ["tenant.enrolled", "apply_url.backsolve.success", "jobs.persisted"], "atsType"),
  )
  const by_ats: Record<string, AtsStats> = {}
  for (const a of atses) {
    by_ats[a] = {
      backsolve_success: sumCounter(snap, "apply_url.backsolve.success", { atsType: a }),
      tenants_enrolled: sumCounter(snap, "tenant.enrolled", { atsType: a }),
      jobs_persisted: sumCounter(snap, "jobs.persisted", { atsType: a }),
    }
  }

  // Adzuna truncated-job recovery conversion (24h, in-process metrics).
  const adzPending = sumCounter(snap, "adzuna.enrich.pending_inserted")
  const adzAttempted = sumCounter(snap, "description_enrichment.result", { source: "adzuna" })
  const adzPromoted = sumCounter(snap, "description_enrichment.result", { source: "adzuna", status: "published" })
  const adzuna_enrich = {
    pending_inserted: adzPending,
    enriched_attempted: adzAttempted,
    promoted: adzPromoted,
    conversion_rate: adzAttempted > 0 ? round(adzPromoted / adzAttempted) : 0,
  }

  // ── Per-source ingest health ──
  const ingestSources = new Set<string>(
    labelValues(snap, ["source.ingest.runs", "source.fetch.error"], "source"),
  )
  const source_ingest: Record<string, SourceIngestStats> = {}
  for (const s of ingestSources) {
    source_ingest[s] = {
      runs: sumCounter(snap, "source.ingest.runs", { source: s }),
      fetched: sumCounter(snap, "source.ingest.fetched", { source: s }),
      inserted: sumCounter(snap, "source.ingest.inserted", { source: s }),
      updated: sumCounter(snap, "source.ingest.updated", { source: s }),
      hidden_low_quality: sumCounter(snap, "source.ingest.hidden_low_quality", { source: s }),
      upsert_errors: sumCounter(snap, "source.ingest.upsert_errors", { source: s }),
      fetch_errors: sumCounter(snap, "source.fetch.error", { source: s }),
    }
  }

  // ── Board probe outcomes ──
  const probeHasJobs = sumCounter(snap, "discover.board_probe", { result: "has_jobs" })
  const probeEmpty = sumCounter(snap, "discover.board_probe", { result: "empty" })
  const probeError = sumCounter(snap, "discover.board_probe", { result: "error" })
  const probeTotal = probeHasJobs + probeEmpty + probeError
  const board_probe = {
    has_jobs: probeHasJobs,
    empty: probeEmpty,
    error: probeError,
    error_rate: probeTotal > 0 ? round(probeError / probeTotal) : 0,
  }

  return { generatedAt: snap.generatedAt, last24h, by_source, by_ats, adzuna_enrich, source_ingest, board_probe }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

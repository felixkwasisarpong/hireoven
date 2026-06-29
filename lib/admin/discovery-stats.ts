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

  // ── In-memory 24h flow rates ──
  const attempt = sumCounter(snap, "apply_url.backsolve.attempt")
  const success = sumCounter(snap, "apply_url.backsolve.success")
  const failure = sumCounter(snap, "apply_url.backsolve.failure")

  const last24h: DiscoveryStats["last24h"] = {
    tenants_discovered: sumCounter(snap, "tenant.discovered"),
    tenants_validated: sumCounter(snap, "tenant.validated"),
    tenants_enrolled: sumCounter(snap, "tenant.enrolled"),
    tenants_rejected: sumCounter(snap, "tenant.rejected"),
    tenants_retry_later: sumCounter(snap, "tenant.retry_later"),
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

  return { generatedAt: snap.generatedAt, last24h, by_source, by_ats }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

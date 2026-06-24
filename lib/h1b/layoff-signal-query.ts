import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import {
  deriveLayoffSignal,
  layoffSourceKind,
  type LayoffSignal,
  type LayoffSignalBase,
  type FreezeConfidence,
  type LayoffTrend,
} from "./layoff-signal"

interface SummaryRow {
  has_active_freeze: boolean | null
  freeze_confidence: FreezeConfidence | null
  layoff_trend: LayoffTrend | null
  events_12mo: string | null
  events_90d: string | null
  workers_12mo: string | null
}

interface EventRow {
  event_date: string
  employees_affected: number | null
  source: string | null
  headline: string | null
  source_url: string | null
}

const n = (v: string | number | null): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

// Full signal + evidence + source refs for a single company (profile / scorecard pages).
export async function getCompanyLayoffSignal(companyId: string): Promise<LayoffSignal | null> {
  if (!hasPostgresEnv()) return null
  const pool = getPostgresPool()

  const { rows: summaryRows } = await pool.query<SummaryRow>(
    `SELECT
       cls.has_active_freeze,
       cls.freeze_confidence,
       cls.layoff_trend,
       (SELECT COUNT(*) FROM layoff_events le
         WHERE le.company_id = $1 AND le.event_date > NOW() - INTERVAL '12 months')::text AS events_12mo,
       (SELECT COUNT(*) FROM layoff_events le
         WHERE le.company_id = $1 AND le.event_date > NOW() - INTERVAL '90 days')::text AS events_90d,
       (SELECT COALESCE(SUM(employees_affected), 0) FROM layoff_events le
         WHERE le.company_id = $1 AND le.event_date > NOW() - INTERVAL '12 months')::text AS workers_12mo
     FROM (SELECT $1::uuid AS id) c
     LEFT JOIN company_layoff_summary cls ON cls.company_id = c.id
     LIMIT 1`,
    [companyId]
  )
  const s = summaryRows[0]
  const input = {
    has_active_freeze: s?.has_active_freeze ?? false,
    freeze_confidence: s?.freeze_confidence ?? null,
    layoff_trend: s?.layoff_trend ?? null,
    events_12mo: n(s?.events_12mo ?? 0),
    events_90d: n(s?.events_90d ?? 0),
    workers_affected_12mo: n(s?.workers_12mo ?? 0),
  }
  const base = deriveLayoffSignal(input)

  // Recent events for "most recent" + collapsible source list (24mo window).
  const { rows: eventRows } = await pool.query<EventRow>(
    `SELECT event_date::text AS event_date, employees_affected, source, headline, source_url
     FROM layoff_events
     WHERE company_id = $1 AND event_date > NOW() - INTERVAL '24 months'
     ORDER BY event_date DESC
     LIMIT 8`,
    [companyId]
  )

  const most = eventRows[0]
  return {
    ...base,
    evidence: {
      events_12mo: input.events_12mo,
      workers_affected_12mo: input.workers_affected_12mo,
      most_recent_event: most
        ? {
            date: most.event_date,
            size: most.employees_affected ?? null,
            source: layoffSourceKind(most.source),
          }
        : null,
      has_active_freeze: input.has_active_freeze,
      freeze_confidence: input.freeze_confidence,
      layoff_trend: input.layoff_trend,
    },
    source_refs: eventRows.map((e) => ({
      kind: layoffSourceKind(e.source),
      title: e.headline ?? "Layoff event",
      url: e.source_url ?? null,
      date: e.event_date,
    })),
  }
}

// Badge-only signals for many companies in ONE query (leaderboard rows — no N+1).
export async function getCompanyLayoffSignalsBatch(
  companyIds: string[]
): Promise<Map<string, LayoffSignalBase>> {
  const out = new Map<string, LayoffSignalBase>()
  if (!hasPostgresEnv() || companyIds.length === 0) return out
  const pool = getPostgresPool()

  const { rows } = await pool.query<SummaryRow & { company_id: string }>(
    `SELECT
       c.id AS company_id,
       cls.has_active_freeze,
       cls.freeze_confidence,
       cls.layoff_trend,
       COUNT(le.*) FILTER (WHERE le.event_date > NOW() - INTERVAL '12 months')::text AS events_12mo,
       COUNT(le.*) FILTER (WHERE le.event_date > NOW() - INTERVAL '90 days')::text AS events_90d,
       COALESCE(SUM(le.employees_affected) FILTER (WHERE le.event_date > NOW() - INTERVAL '12 months'), 0)::text AS workers_12mo
     FROM unnest($1::uuid[]) AS c(id)
     LEFT JOIN company_layoff_summary cls ON cls.company_id = c.id
     LEFT JOIN layoff_events le ON le.company_id = c.id
     GROUP BY c.id, cls.has_active_freeze, cls.freeze_confidence, cls.layoff_trend`,
    [companyIds]
  )

  for (const r of rows) {
    out.set(
      r.company_id,
      deriveLayoffSignal({
        has_active_freeze: r.has_active_freeze ?? false,
        freeze_confidence: r.freeze_confidence ?? null,
        layoff_trend: r.layoff_trend ?? null,
        events_12mo: n(r.events_12mo),
        events_90d: n(r.events_90d),
        workers_affected_12mo: n(r.workers_12mo),
      })
    )
  }
  return out
}

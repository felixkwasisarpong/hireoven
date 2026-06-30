import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import type { Pool } from "pg"
import { buildDiscoveryStats } from "@/lib/admin/discovery-stats"
import { __resetMetrics, counter, histogram } from "@/lib/observability/metrics"

// The route handler is a thin auth wrapper around buildDiscoveryStats; admin
// auth needs Supabase cookies that aren't available under node:test, so we
// assert the payload SHAPE via the builder with a fake pool + seeded metrics.

const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase()

function fakePool(): Pool {
  return {
    async query(sql: string) {
      const q = norm(sql)
      if (q.includes("from jobs") && q.includes("group by publication_status")) {
        return {
          rows: [
            { publication_status: "visible_basic", n: 5 },
            { publication_status: "visible_enriched", n: 12 },
            { publication_status: "published", n: 100 },
            { publication_status: "hidden_expired", n: 3 },
          ],
        }
      }
      if (q.includes("from ats_tenants")) {
        return { rows: [{ total: 100, enrolled: 40 }] }
      }
      return { rows: [] }
    },
  } as unknown as Pool
}

beforeEach(() => {
  __resetMetrics()
})

describe("buildDiscoveryStats", () => {
  it("returns the documented shape with computed rates", async () => {
    // Seed in-memory metrics for two sources / two ATSes.
    counter("apply_url.backsolve.attempt", { sourceType: "adzuna" })
    counter("apply_url.backsolve.attempt", { sourceType: "adzuna" })
    counter("apply_url.backsolve.success", { sourceType: "adzuna", atsType: "greenhouse" })
    counter("apply_url.backsolve.failure", { sourceType: "dice", reason: "no_ats_match" })
    counter("apply_url.backsolve.attempt", { sourceType: "dice" })
    histogram("apply_url.backsolve.duration_ms", 1200, { sourceType: "adzuna", atsType: "greenhouse" })
    counter("tenant.discovered", { atsType: "greenhouse", sourceType: "adzuna" })
    counter("tenant.enrolled", { atsType: "greenhouse", sourceType: "adzuna", created: "true" })
    counter("tenant.retry_later", { atsType: "lever", sourceType: "dice", reason: "board_error" })
    counter("jobs.persisted", { atsType: "greenhouse", status: "inserted" }, 7)
    counter("jobs.publication_status", { value: "visible_basic" }, 5)
    counter("ats_rate_limit.throttled", { atsType: "greenhouse" }, 4)
    // Adzuna enrich recovery: 10 queued, 8 attempted, 6 promoted to published.
    counter("adzuna.enrich.pending_inserted", undefined, 10)
    counter("description_enrichment.result", { source: "adzuna", status: "published" }, 6)
    counter("description_enrichment.result", { source: "adzuna", status: "pending_enrichment" }, 2)
    // Per-source ingest health: themuse healthy, jooble upstream-broken (ran but fetched 0 + errors).
    counter("source.ingest.runs", { source: "themuse" }, 3)
    counter("source.ingest.fetched", { source: "themuse" }, 95)
    counter("source.ingest.inserted", { source: "themuse" }, 40)
    counter("source.ingest.runs", { source: "jooble" }, 2)
    counter("source.fetch.error", { source: "jooble" }, 5)
    // Board probes: extra ats/reason labels must not break subset-match sums.
    counter("discover.board_probe", { ats: "greenhouse", result: "has_jobs" }, 10)
    counter("discover.board_probe", { ats: "lever", result: "empty" }, 6)
    counter("discover.board_probe", { ats: "greenhouse", result: "error", reason: "timeout" }, 4)

    const stats = await buildDiscoveryStats(fakePool())

    // Top-level shape
    assert.equal(typeof stats.generatedAt, "string")
    assert.ok(stats.last24h)
    assert.ok(stats.by_source)
    assert.ok(stats.by_ats)

    // last24h durable + in-memory fields
    const l = stats.last24h
    assert.equal(l.backsolve_attempt, 3) // 2 adzuna + 1 dice
    assert.equal(l.backsolve_success, 1)
    assert.equal(l.backsolve_failure, 1)
    assert.equal(l.backsolve_success_rate, round(1 / 3))
    assert.equal(l.tenants_enrolled, 1)
    assert.equal(l.tenants_retry_later, 1)
    assert.equal(l.jobs_persisted_total, 7)
    assert.equal(l.rate_limit_throttled, 4)

    // Durable SQL-derived fields
    assert.equal(l.placeholder_to_tenant_conversion, 0.4) // 40/100
    assert.deepEqual(l.jobs_publication_status_breakdown, {
      visible_basic: 5,
      visible_enriched: 12,
      published: 100,
      hidden_expired: 3,
    })

    // by_source breakdown
    assert.equal(stats.by_source.adzuna!.backsolve_attempt, 2)
    assert.equal(stats.by_source.adzuna!.backsolve_success, 1)
    assert.equal(stats.by_source.dice!.backsolve_failure, 1)
    // requested keys are always present even with no data
    assert.ok(stats.by_source.jsearch)
    assert.ok(stats.by_source.manual)

    // by_ats breakdown
    assert.equal(stats.by_ats.greenhouse!.tenants_enrolled, 1)
    assert.equal(stats.by_ats.greenhouse!.jobs_persisted, 7)

    // Adzuna truncated-job recovery conversion
    assert.equal(stats.adzuna_enrich.pending_inserted, 10)
    assert.equal(stats.adzuna_enrich.enriched_attempted, 8) // 6 published + 2 pending
    assert.equal(stats.adzuna_enrich.promoted, 6)
    assert.equal(stats.adzuna_enrich.conversion_rate, round(6 / 8))

    // Per-source ingest health
    assert.equal(stats.source_ingest.themuse!.fetched, 95)
    assert.equal(stats.source_ingest.themuse!.inserted, 40)
    assert.equal(stats.source_ingest.themuse!.fetch_errors, 0)
    assert.equal(stats.source_ingest.jooble!.runs, 2)
    assert.equal(stats.source_ingest.jooble!.fetched, 0) // ran but fetched nothing → broken
    assert.equal(stats.source_ingest.jooble!.fetch_errors, 5)

    // Board probes (subset-match across extra ats/reason labels)
    assert.equal(stats.board_probe.has_jobs, 10)
    assert.equal(stats.board_probe.empty, 6)
    assert.equal(stats.board_probe.error, 4)
    assert.equal(stats.board_probe.error_rate, round(4 / 20))
  })

  it("handles an empty window without throwing", async () => {
    const stats = await buildDiscoveryStats(fakePool())
    assert.equal(stats.last24h.backsolve_attempt, 0)
    assert.equal(stats.last24h.backsolve_success_rate, 0)
    assert.equal(stats.last24h.placeholder_to_tenant_conversion, 0.4) // still from SQL
  })
})

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

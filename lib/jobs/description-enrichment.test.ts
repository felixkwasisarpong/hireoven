import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Pool } from "pg"
import { markFailure, processPendingDescriptionEnrichmentBatch } from "./description-enrichment"

type Captured = { sql: string; params: unknown[] }

function fakePool(): { pool: Pool; calls: Captured[] } {
  const calls: Captured[] = []
  const record = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    return { rows: [] }
  }
  // fetchCandidateIds now runs inside a checked-out client so it can scope a
  // `SET LOCAL statement_timeout` to just its SELECT; markFailure still uses
  // pool.query directly. Support both, capturing every statement into `calls`.
  const client = { query: record, release: () => {} }
  const pool = {
    query: record,
    connect: async () => client,
  } as unknown as Pool
  return { pool, calls }
}

function jobWithAttempts(attempts: number) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    apply_url: "https://example.com/job",
    raw_data: { description_enrichment: { attempts } },
  } as never
}

test("markFailure: retires (hidden_low_quality) once attempts reach maxAttempts", async () => {
  const { pool, calls } = fakePool()
  // attempts 2 -> becomes 3 == maxAttempts -> retired
  await markFailure(pool, jobWithAttempts(2), "run1", "description_fetch_failed", 3)
  assert.equal(calls.length, 1)
  // params: [id, rawDataJson, retired]
  assert.equal(calls[0].params[2], true)
  const raw = JSON.parse(calls[0].params[1] as string)
  assert.equal(raw.description_enrichment.status, "retired")
  assert.equal(raw.description_enrichment.attempts, 3)
  assert.match(calls[0].sql, /hidden_low_quality/)
})

test("markFailure: keeps pending while attempts remain", async () => {
  const { pool, calls } = fakePool()
  // attempts 0 -> becomes 1 < maxAttempts -> not retired
  await markFailure(pool, jobWithAttempts(0), "run1", "description_fetch_failed", 3)
  assert.equal(calls[0].params[2], false)
  const raw = JSON.parse(calls[0].params[1] as string)
  assert.equal(raw.description_enrichment.status, "failed")
  assert.equal(raw.description_enrichment.attempts, 1)
})

test("processPendingDescriptionEnrichmentBatch: reclaims hidden fetchable ATS jobs", async () => {
  const { pool, calls } = fakePool()
  await processPendingDescriptionEnrichmentBatch({
    pool,
    batchSize: 25,
    maxAttempts: 3,
    minDescriptionChars: 150,
  })

  // The candidate scan is wrapped in a txn with a scoped statement_timeout.
  assert.ok(
    calls.some((c) => /SET LOCAL statement_timeout/i.test(c.sql)),
    "expected a scoped statement_timeout"
  )
  const select = calls.find((c) => /SELECT id\s+FROM jobs/i.test(c.sql))
  assert.ok(select, "expected the candidate SELECT")
  // Bounded by a first_detected_at window so the planner uses the index and
  // early-terminates at the LIMIT instead of scanning all active rows.
  assert.match(select!.sql, /first_detected_at > now\(\) - make_interval\(hours =>/)
  assert.match(select!.sql, /hidden_low_quality/)
  assert.match(select!.sql, /source_ats = ANY\(\$5::text\[\]\)/)
  assert.match(select!.sql, /apply_url ~\* \$6/)
  assert.equal(select!.params[3], 150)
  assert.match(String(select!.params[4]), /icims/)
  assert.match(String(select!.params[5]), /applytojob/)
  // The window lookback is the 7th bind param.
  assert.equal(typeof select!.params[6], "number")
})

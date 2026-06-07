import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Pool } from "pg"
import { markFailure } from "./description-enrichment"

type Captured = { sql: string; params: unknown[] }

function fakePool(): { pool: Pool; calls: Captured[] } {
  const calls: Captured[] = []
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params })
      return { rows: [] }
    },
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

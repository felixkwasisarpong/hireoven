import { test } from "node:test"
import assert from "node:assert/strict"
import type { Pool } from "pg"
import { bumpHarvestForActiveCompanies } from "@/lib/harvester/freshness-signal"
import { yieldAdjustedInterval } from "@/lib/harvester/run-harvest"

type Call = { sql: string; params: unknown[] }

function fakePool(rowCount: number): { pool: Pool; calls: Call[] } {
  const calls: Call[] = []
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params })
      return { rowCount, rows: [] }
    },
  } as unknown as Pool
  return { pool, calls }
}

test("bumpHarvestForActiveCompanies: no-op (no query) on empty id list", async () => {
  const { pool, calls } = fakePool(0)
  const n = await bumpHarvestForActiveCompanies(pool, [])
  assert.equal(n, 0)
  assert.equal(calls.length, 0)
})

test("bumpHarvestForActiveCompanies: pulls next_harvest_at to now only for harvestable, due-later rows", async () => {
  const { pool, calls } = fakePool(2)
  const n = await bumpHarvestForActiveCompanies(pool, ["a", "b", "c"])
  assert.equal(n, 2)
  assert.equal(calls.length, 1)
  const { sql, params } = calls[0]
  assert.match(sql, /next_harvest_at = now\(\)/)
  assert.match(sql, /ats_type IS NOT NULL/)
  assert.match(sql, /duplicate_of_company_id IS NULL/)
  // Only pulls forward rows not already due.
  assert.match(sql, /next_harvest_at IS NULL OR next_harvest_at > now\(\)/)
  assert.deepEqual(params, [["a", "b", "c"]])
})

test("yieldAdjustedInterval: identity below the first empty-streak threshold", () => {
  assert.equal(yieldAdjustedInterval(180, 0), 180)
  assert.equal(yieldAdjustedInterval(180, 4), 180)
})

test("yieldAdjustedInterval: geometric backoff at 5/10/20 empty crawls", () => {
  assert.equal(yieldAdjustedInterval(180, 5), 360)
  assert.equal(yieldAdjustedInterval(180, 10), 720)
  assert.equal(yieldAdjustedInterval(180, 20), 1440)
})

test("yieldAdjustedInterval: caps at the 7-day ceiling", () => {
  assert.equal(yieldAdjustedInterval(604_800, 20), 604_800)
})

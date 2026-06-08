import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Pool } from "pg"
import { purgeExpiredInactiveJobs } from "./retention"

function fakePool(rowCounts: number[]): { pool: Pool; calls: unknown[][] } {
  const calls: unknown[][] = []
  let i = 0
  const pool = {
    query: async (_sql: string, params: unknown[]) => {
      calls.push(params)
      return { rowCount: rowCounts[i++] ?? 0 }
    },
  } as unknown as Pool
  return { pool, calls }
}

test("purgeExpiredInactiveJobs: sums batches and stops when a batch deletes 0", async () => {
  const { pool, calls } = fakePool([5000, 5000, 1200, 0])
  const r = await purgeExpiredInactiveJobs({ pool, olderThanDays: 30, batchSize: 5000, maxBatches: 50 })
  assert.equal(r.deleted, 11200)
  assert.equal(r.batches, 3)
  assert.equal(calls.length, 4) // 3 deleting + 1 that returned 0
  assert.deepEqual(calls[0], [30, 5000]) // [days, batchSize]
})

test("purgeExpiredInactiveJobs: respects maxBatches cap", async () => {
  const { pool, calls } = fakePool([5000, 5000, 5000, 5000])
  const r = await purgeExpiredInactiveJobs({ pool, olderThanDays: 30, batchSize: 5000, maxBatches: 2 })
  assert.equal(r.batches, 2)
  assert.equal(r.deleted, 10000)
  assert.equal(calls.length, 2)
})

test("purgeExpiredInactiveJobs: enforces a 7-day minimum retention", async () => {
  const { pool, calls } = fakePool([0])
  await purgeExpiredInactiveJobs({ pool, olderThanDays: 1, batchSize: 5000, maxBatches: 1 })
  assert.equal(calls[0][0], 7) // clamped up to 7
})

import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Pool } from "pg"
import { purgeDeadCrawledCompanies, purgeNeverLiveCompanies } from "./purge-dead-crawled"

function fakePool(rowCounts: number[]): { pool: Pool; sqls: string[]; params: unknown[][] } {
  const sqls: string[] = []
  const params: unknown[][] = []
  let i = 0
  const pool = {
    query: async (sql: string, p: unknown[]) => {
      sqls.push(sql)
      params.push(p)
      return { rowCount: rowCounts[i++] ?? 0 }
    },
  } as unknown as Pool
  return { pool, sqls, params }
}

test("purgeDeadCrawledCompanies: sums batches and stops when a batch affects 0", async () => {
  const { pool, params } = fakePool([500, 500, 120, 0])
  const r = await purgeDeadCrawledCompanies({ pool, mode: "dead", minEmptyCrawls: 20, batchSize: 500, maxBatches: 50 })
  assert.equal(r.affected, 1120)
  assert.equal(r.batches, 3)
  assert.equal(r.mode, "dead")
  assert.deepEqual(params[0], [20, 30, 500]) // [minEmptyCrawls, inactiveDays default 30, batchSize]
})

test("purgeDeadCrawledCompanies: respects maxBatches cap", async () => {
  const { pool } = fakePool([500, 500, 500, 500])
  const r = await purgeDeadCrawledCompanies({ pool, mode: "dead", minEmptyCrawls: 20, batchSize: 500, maxBatches: 2 })
  assert.equal(r.batches, 2)
  assert.equal(r.affected, 1000)
})

test("purgeDeadCrawledCompanies: mode=dead uses UPDATE…status='dead' and excludes already-dead", async () => {
  const { pool, sqls } = fakePool([10, 0])
  await purgeDeadCrawledCompanies({ pool, mode: "dead", minEmptyCrawls: 20 })
  assert.match(sqls[0], /UPDATE companies SET status='dead'/)
  assert.match(sqls[0], /status IS DISTINCT FROM 'dead'/) // termination guard
  // never retire a board that was never confirmed live (protects fresh discoveries)
  assert.match(sqls[0], /last_job_seen_at IS NOT NULL/)
})

test("purgeDeadCrawledCompanies: mode=delete uses DELETE", async () => {
  const { pool, sqls } = fakePool([10, 0])
  await purgeDeadCrawledCompanies({ pool, mode: "delete", minEmptyCrawls: 20 })
  assert.match(sqls[0], /DELETE FROM companies/)
})

test("purgeDeadCrawledCompanies: enforces a 3-crawl minimum floor", async () => {
  const { pool, params } = fakePool([0])
  await purgeDeadCrawledCompanies({ pool, minEmptyCrawls: 0, maxBatches: 1 })
  assert.equal(params[0][0], 3) // minEmptyCrawls clamped up to 3
})

test("purgeNeverLiveCompanies: sums batches and stops when a batch affects 0", async () => {
  const { pool, params } = fakePool([500, 500, 120, 0])
  const r = await purgeNeverLiveCompanies({ pool, mode: "dead", minEmptyCrawls: 20, batchSize: 500, maxBatches: 50 })
  assert.equal(r.affected, 1120)
  assert.equal(r.batches, 3)
  assert.equal(r.mode, "dead")
  assert.deepEqual(params[0], [20, 14, 500]) // [minEmptyCrawls, minAgeDays default 14, batchSize]
})

test("purgeNeverLiveCompanies: respects maxBatches cap", async () => {
  const { pool } = fakePool([500, 500, 500, 500])
  const r = await purgeNeverLiveCompanies({ pool, mode: "dead", minEmptyCrawls: 20, batchSize: 500, maxBatches: 2 })
  assert.equal(r.batches, 2)
  assert.equal(r.affected, 1000)
})

test("purgeNeverLiveCompanies: mode=dead uses UPDATE…status='dead', targets never-confirmed-live boards by age", async () => {
  const { pool, sqls } = fakePool([10, 0])
  await purgeNeverLiveCompanies({ pool, mode: "dead", minEmptyCrawls: 20 })
  assert.match(sqls[0], /UPDATE companies SET status='dead'/)
  assert.match(sqls[0], /status IS DISTINCT FROM 'dead'/) // termination guard
  // this is the never-confirmed-live bucket the sibling purge excludes
  assert.match(sqls[0], /last_job_seen_at IS NULL/)
  assert.match(sqls[0], /created_at < now\(\) - \(\$2 \|\| ' days'\)::interval/)
})

test("purgeNeverLiveCompanies: mode=delete uses DELETE", async () => {
  const { pool, sqls } = fakePool([10, 0])
  await purgeNeverLiveCompanies({ pool, mode: "delete", minEmptyCrawls: 20 })
  assert.match(sqls[0], /DELETE FROM companies/)
})

test("purgeNeverLiveCompanies: enforces a 3-crawl minimum floor and 7-day minimum age", async () => {
  const { pool, params } = fakePool([0])
  await purgeNeverLiveCompanies({ pool, minEmptyCrawls: 0, minAgeDays: 1, maxBatches: 1 })
  assert.equal(params[0][0], 3) // minEmptyCrawls clamped up to 3
  assert.equal(params[0][1], 7) // minAgeDays clamped up to 7
})

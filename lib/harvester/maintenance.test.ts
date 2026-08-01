import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Pool, PoolClient, QueryResult } from "pg"
import {
  assignTiers,
  COMPANY_DEDUP_SQL,
  DEDUP_SQL,
  dedupCompanies,
  dedupJobs,
  fuzzyDedupJobs,
  FUZZY_DEDUP_SQL,
  resurrectDeadCompanies,
  RESURRECTION_SQL,
  STATUS_LIFECYCLE_SQL,
  TIER_ASSIGNMENT_SQL,
  updateStatus,
} from "./maintenance"

type CapturedCall = { text: string }

function makeFakeClient(rowsForUpdate: Array<{ tier?: string; id?: string }>) {
  const captured: CapturedCall[] = []
  let committed: boolean | null = null
  const client = {
    query: async (text: string) => {
      captured.push({ text })
      const upper = text.trim().toUpperCase()
      if (upper === "BEGIN") return { rows: [] } as unknown as QueryResult
      if (upper === "COMMIT") {
        committed = true
        return { rows: [] } as unknown as QueryResult
      }
      if (upper === "ROLLBACK") {
        committed = false
        return { rows: [] } as unknown as QueryResult
      }
      return { rows: rowsForUpdate, rowCount: rowsForUpdate.length } as unknown as QueryResult
    },
    release: () => {},
  } as unknown as PoolClient
  return { client, captured, getCommitted: () => committed }
}

function makeFakePool(client: PoolClient) {
  return {
    connect: async () => client,
  } as unknown as Pool
}

test("TIER_ASSIGNMENT_SQL: includes watcher signal and tier ladder", () => {
  assert.match(TIER_ASSIGNMENT_SQL, /WITH new_tiers AS/)
  assert.match(TIER_ASSIGNMENT_SQL, /EXISTS \(SELECT 1 FROM watchlist/)
  assert.match(TIER_ASSIGNMENT_SQL, /'tier_1'/)
  assert.match(TIER_ASSIGNMENT_SQL, /'tier_2'/)
  assert.match(TIER_ASSIGNMENT_SQL, /'tier_3'/)
  assert.match(TIER_ASSIGNMENT_SQL, /'tier_dead'/)
  assert.match(TIER_ASSIGNMENT_SQL, /IS DISTINCT FROM new_tiers\.new_tier/)
  assert.match(TIER_ASSIGNMENT_SQL, /RETURNING new_tiers\.new_tier AS tier/)
})

test("STATUS_LIFECYCLE_SQL: marks dead only after 7+ consecutive failures", () => {
  assert.match(STATUS_LIFECYCLE_SQL, /SET status\s*=\s*'dead'/)
  assert.match(STATUS_LIFECYCLE_SQL, /recent\.failures >= 7/)
  assert.match(STATUS_LIFECYCLE_SQL, /recent\.failures = recent\.total/)
  assert.match(STATUS_LIFECYCLE_SQL, /companies\.status = 'active'/)
})

test("TIER_ASSIGNMENT_SQL: top H1B sponsors get tier_1 regardless of recent jobs", () => {
  // Threshold-based promotion: >=50 LCAs/yr forces tier_1, >=10 forces at least tier_2.
  assert.match(TIER_ASSIGNMENT_SQL, /COALESCE\(c\.h1b_sponsor_count_1yr, 0\) >= 50/)
  assert.match(TIER_ASSIGNMENT_SQL, /COALESCE\(c\.h1b_sponsor_count_1yr, 0\) >= 10/)
})

test("STATUS_LIFECYCLE_SQL: spares H1B sponsors from auto-dead even after parser failures", () => {
  assert.match(STATUS_LIFECYCLE_SQL, /COALESCE\(companies\.h1b_sponsor_count_1yr, 0\) < 10/)
})

test("assignTiers: aggregates returned rows by tier", async () => {
  const { client, getCommitted } = makeFakeClient([
    { tier: "tier_1" },
    { tier: "tier_1" },
    { tier: "tier_2" },
    { tier: "tier_dead" },
  ])
  const pool = makeFakePool(client)

  const summary = await assignTiers(pool, { dryRun: false })
  assert.equal(summary.changed, 4)
  assert.deepEqual(summary.byTier, { tier_1: 2, tier_2: 1, tier_dead: 1 })
  assert.equal(summary.dryRun, false)
  assert.equal(getCommitted(), true, "non-dry-run should COMMIT")
})

test("assignTiers: dryRun rolls back instead of committing", async () => {
  const { client, getCommitted, captured } = makeFakeClient([{ tier: "tier_1" }])
  const pool = makeFakePool(client)

  const summary = await assignTiers(pool, { dryRun: true })
  assert.equal(summary.changed, 1, "RETURNING count is still real, just rolled back")
  assert.equal(summary.dryRun, true)
  assert.equal(getCommitted(), false, "dry-run must ROLLBACK")
  const sqlCalls = captured.map((c) => c.text.trim().toUpperCase().split(/\s+/)[0])
  assert.equal(sqlCalls[0], "BEGIN")
  assert.equal(sqlCalls[1], "SET")
  assert.equal(sqlCalls[2], "WITH")
  assert.equal(sqlCalls.at(-1), "ROLLBACK")
})

test("updateStatus: returns markedDead from RETURNING ids", async () => {
  const { client, getCommitted } = makeFakeClient([{ id: "a" }, { id: "b" }, { id: "c" }])
  const pool = makeFakePool(client)
  const summary = await updateStatus(pool, { dryRun: false })
  assert.equal(summary.markedDead, 3)
  assert.equal(summary.dryRun, false)
  assert.equal(getCommitted(), true)
})

test("updateStatus: rollback path also returns the would-have-changed count", async () => {
  const { client, getCommitted } = makeFakeClient([{ id: "a" }])
  const pool = makeFakePool(client)
  const summary = await updateStatus(pool, { dryRun: true })
  assert.equal(summary.markedDead, 1)
  assert.equal(getCommitted(), false)
})

test("RESURRECTION_SQL: only flips dead companies 30+ days stale", () => {
  assert.match(RESURRECTION_SQL, /SET status\s*=\s*'active'/)
  assert.match(RESURRECTION_SQL, /WHERE status = 'dead'/)
  assert.match(RESURRECTION_SQL, /updated_at < now\(\) - interval '30 days'/)
  assert.match(RESURRECTION_SQL, /RETURNING id/)
})

test("resurrectDeadCompanies: counts and commits in execute mode", async () => {
  const { client, getCommitted } = makeFakeClient([{ id: "a" }, { id: "b" }])
  const pool = makeFakePool(client)
  const summary = await resurrectDeadCompanies(pool, { dryRun: false })
  assert.equal(summary.resurrected, 2)
  assert.equal(summary.dryRun, false)
  assert.equal(getCommitted(), true)
})

test("resurrectDeadCompanies: dry-run reports count then rolls back", async () => {
  const { client, getCommitted } = makeFakeClient([{ id: "a" }])
  const pool = makeFakePool(client)
  const summary = await resurrectDeadCompanies(pool, { dryRun: true })
  assert.equal(summary.resurrected, 1)
  assert.equal(summary.dryRun, true)
  assert.equal(getCommitted(), false)
})

test("DEDUP_SQL: partitions on (company_id, normalized title, location)", () => {
  assert.match(DEDUP_SQL, /PARTITION BY[\s\S]*j\.company_id/)
  assert.match(DEDUP_SQL, /lower\(trim\(regexp_replace\(COALESCE\(j\.normalized_title, j\.title\)/)
  assert.match(DEDUP_SQL, /lower\(trim\(COALESCE\(j\.location, ''\)\)\)/)
  assert.match(DEDUP_SQL, /first_value\(j\.id\)/)
  assert.match(DEDUP_SQL, /ranked\.rn > 1/)
  assert.match(DEDUP_SQL, /duplicate_of_id IS DISTINCT FROM ranked\.canonical_id/)
})

test("DEDUP_SQL: only considers active, open, titled jobs", () => {
  assert.match(DEDUP_SQL, /j\.is_active = true/)
  assert.match(DEDUP_SQL, /j\.closed_at IS NULL/)
  assert.match(DEDUP_SQL, /j\.title IS NOT NULL/)
})

test("dedupJobs: commits in execute mode and returns count", async () => {
  const { client, getCommitted } = makeFakeClient([{ id: "a" }, { id: "b" }, { id: "c" }])
  const pool = makeFakePool(client)
  const summary = await dedupJobs(pool, { dryRun: false })
  assert.equal(summary.markedDuplicate, 3)
  assert.equal(summary.dryRun, false)
  assert.equal(getCommitted(), true)
})

test("dedupJobs: dry-run rolls back, still reports would-have-changed count", async () => {
  const { client, getCommitted } = makeFakeClient([{ id: "a" }])
  const pool = makeFakePool(client)
  const summary = await dedupJobs(pool, { dryRun: true })
  assert.equal(summary.markedDuplicate, 1)
  assert.equal(getCommitted(), false)
})

test("COMPANY_DEDUP_SQL: partitions on canonical ats key and prefers richer canonicals", () => {
  assert.match(COMPANY_DEDUP_SQL, /PARTITION BY c\.ats_type, c\.ats_dedupe_key/)
  assert.match(COMPANY_DEDUP_SQL, /CASE WHEN c\.status = 'active' THEN 0 ELSE 1 END/)
  assert.match(COMPANY_DEDUP_SQL, /lower\(trim\(c\.ats_identifier\)\) = c\.ats_dedupe_key/)
  assert.match(COMPANY_DEDUP_SQL, /COALESCE\(c\.job_count, 0\) DESC/)
  assert.match(COMPANY_DEDUP_SQL, /c\.created_at ASC NULLS LAST/)
  assert.match(COMPANY_DEDUP_SQL, /duplicate_of_company_id IS DISTINCT FROM ranked\.canonical_id/)
})

test("COMPANY_DEDUP_SQL: canonicalizes legacy Workday identifiers from careers_url", () => {
  assert.match(COMPANY_DEDUP_SQL, /myworkdayjobs\\\.com/)
  assert.match(COMPANY_DEDUP_SQL, /regexp_replace\(/)
  assert.match(COMPANY_DEDUP_SQL, /\\1:\\2:\\3/)
})

test("COMPANY_DEDUP_SQL: skips rows missing ats_type or ats_identifier", () => {
  assert.match(COMPANY_DEDUP_SQL, /c\.ats_type IS NOT NULL/)
  assert.match(COMPANY_DEDUP_SQL, /c\.ats_identifier IS NOT NULL/)
  assert.match(COMPANY_DEDUP_SQL, /length\(trim\(c\.ats_identifier\)\) > 0/)
})

test("dedupCompanies: commits in execute mode and returns count", async () => {
  const { client, getCommitted } = makeFakeClient([{ id: "a" }, { id: "b" }])
  const pool = makeFakePool(client)
  const summary = await dedupCompanies(pool, { dryRun: false })
  assert.equal(summary.markedDuplicate, 2)
  assert.equal(summary.dryRun, false)
  assert.equal(getCommitted(), true)
})

test("dedupCompanies: dry-run rolls back, reports would-have-changed count", async () => {
  const { client, getCommitted } = makeFakeClient([{ id: "a" }])
  const pool = makeFakePool(client)
  const summary = await dedupCompanies(pool, { dryRun: true })
  assert.equal(summary.markedDuplicate, 1)
  assert.equal(getCommitted(), false)
})

test("FUZZY_DEDUP_SQL: uses pg_trgm % operator and excludes already-marked duplicates", () => {
  assert.match(FUZZY_DEDUP_SQL, /a\.title % b\.title/)
  assert.match(FUZZY_DEDUP_SQL, /a\.duplicate_of_id IS NULL/)
  assert.match(FUZZY_DEDUP_SQL, /b\.duplicate_of_id IS NULL/)
  assert.match(FUZZY_DEDUP_SQL, /a\.id < b\.id/)
  assert.match(FUZZY_DEDUP_SQL, /CASE WHEN a_first_seen <= b_first_seen/)
})

test("FUZZY_DEDUP_SQL: matches across NULL location vs. set location", () => {
  assert.match(FUZZY_DEDUP_SQL, /a\.location IS NULL/)
  assert.match(FUZZY_DEDUP_SQL, /b\.location IS NULL/)
})

test("fuzzyDedupJobs: clamps threshold to (0,1] and SETs LOCAL pg_trgm.similarity_threshold", async () => {
  const captured: string[] = []
  const fakeClient = {
    query: async (text: string) => {
      captured.push(text)
      const upper = text.trim().toUpperCase()
      if (upper === "BEGIN" || upper === "COMMIT" || upper === "ROLLBACK") {
        return { rows: [] } as unknown as ReturnType<typeof Promise.resolve>
      }
      if (text.includes("SET LOCAL pg_trgm")) {
        return { rows: [] } as unknown as ReturnType<typeof Promise.resolve>
      }
      return { rows: [{ id: "a" }, { id: "b" }] } as unknown as ReturnType<typeof Promise.resolve>
    },
    release: () => {},
  } as unknown as import("pg").PoolClient
  const fakePool = { connect: async () => fakeClient } as unknown as import("pg").Pool

  const summary = await fuzzyDedupJobs(fakePool, { dryRun: false, threshold: 0.65 })
  assert.equal(summary.markedDuplicate, 2)
  assert.equal(summary.threshold, 0.65)

  // The SET LOCAL must precede the UPDATE.
  const setIdx = captured.findIndex((q) => q.includes("SET LOCAL pg_trgm"))
  const updateIdx = captured.findIndex((q) => q.includes("UPDATE jobs"))
  assert.ok(setIdx >= 0, "SET LOCAL was not issued")
  assert.ok(updateIdx > setIdx, "SET LOCAL must run before the UPDATE")
  // Threshold must be a numeric literal — float-formatted, never a placeholder.
  assert.match(captured[setIdx], /pg_trgm\.similarity_threshold = 0\.650/)
})

test("fuzzyDedupJobs: clamps threshold > 1 and <= 0 to safe bounds", async () => {
  const captured: string[] = []
  const fakeClient = {
    query: async (text: string) => {
      captured.push(text)
      return { rows: [] } as unknown as ReturnType<typeof Promise.resolve>
    },
    release: () => {},
  } as unknown as import("pg").PoolClient
  const fakePool = { connect: async () => fakeClient } as unknown as import("pg").Pool

  await fuzzyDedupJobs(fakePool, { dryRun: false, threshold: 2.0 })
  await fuzzyDedupJobs(fakePool, { dryRun: false, threshold: 0 })

  const sets = captured.filter((q) => q.includes("SET LOCAL pg_trgm"))
  assert.match(sets[0], /= 1\.000/) // clamped down to 1.0
  assert.match(sets[1], /= 0\.010/) // clamped up to 0.01
})

test("updateStatus: ROLLBACK on error path", async () => {
  let rolledBack = false
  const client = {
    query: async (text: string) => {
      const upper = text.trim().toUpperCase()
      if (upper === "BEGIN") return { rows: [] } as unknown as QueryResult
      if (upper === "ROLLBACK") {
        rolledBack = true
        return { rows: [] } as unknown as QueryResult
      }
      throw new Error("simulated planner failure")
    },
    release: () => {},
  } as unknown as PoolClient
  const pool = makeFakePool(client)

  await assert.rejects(updateStatus(pool, { dryRun: false }), /simulated planner failure/)
  assert.equal(rolledBack, true, "errors must trigger ROLLBACK, never leave a dangling txn")
})

import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Pool, QueryResult } from "pg"
import {
  adapterNameFor,
  buildAdapterLimits,
  claimEligibleCompanies,
  loadWorkerConfig,
} from "./worker"

test("loadWorkerConfig: defaults when env is empty", () => {
  const config = loadWorkerConfig({})
  assert.equal(config.tickIntervalMs, 30_000)
  assert.equal(config.claimBatchSize, 20)
  assert.equal(config.leaseSeconds, 240)
  assert.equal(config.concurrency, 8)
})

test("loadWorkerConfig: reads valid env vars", () => {
  const config = loadWorkerConfig({
    HARVESTER_TICK_INTERVAL_MS: "5000",
    HARVESTER_CLAIM_BATCH_SIZE: "100",
    HARVESTER_LEASE_SECONDS: "300",
    HARVESTER_CONCURRENCY: "16",
  })
  assert.equal(config.tickIntervalMs, 5_000)
  assert.equal(config.claimBatchSize, 100)
  assert.equal(config.leaseSeconds, 300)
  assert.equal(config.concurrency, 16)
})

test("loadWorkerConfig: falls back on garbage env", () => {
  const config = loadWorkerConfig({
    HARVESTER_TICK_INTERVAL_MS: "not-a-number",
    HARVESTER_CLAIM_BATCH_SIZE: "-5",
    HARVESTER_LEASE_SECONDS: "0",
    HARVESTER_CONCURRENCY: "",
  })
  assert.equal(config.tickIntervalMs, 30_000)
  assert.equal(config.claimBatchSize, 20)
  assert.equal(config.leaseSeconds, 240)
  assert.equal(config.concurrency, 8)
})

test("claimEligibleCompanies: issues SKIP LOCKED claim with lease params and shapes rows", async () => {
  const captured: { text: string; values: unknown[] } = { text: "", values: [] }
  const fakeRow = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Acme",
    careers_url: "https://boards.greenhouse.io/acme",
    domain: "acme.com",
    ats_type: "greenhouse",
    raw_ats_config: { crawl_allowed: true },
    etag: 'W/"abc"',
    last_modified: null,
    freshness_tier: "tier_2",
  }
  const pool = {
    query: async (text: string, values: unknown[]) => {
      captured.text = text
      captured.values = values
      return { rows: [fakeRow], rowCount: 1 } as unknown as QueryResult
    },
  } as unknown as Pool

  const result = await claimEligibleCompanies(pool, 25, 90)

  assert.match(captured.text, /UPDATE companies/)
  assert.match(captured.text, /FOR UPDATE SKIP LOCKED/)
  assert.match(captured.text, /next_harvest_at = now\(\) \+ \(\$2 \|\| ' seconds'\)::interval/)
  assert.match(captured.text, /ats_type = ANY\(\$3::text\[\]\)/)
  assert.match(captured.text, /duplicate_of_company_id IS NULL/)
  assert.match(captured.text, /jobs\.lever\.co/)
  assert.match(captured.text, /jobs\.ashbyhq\.com/)
  assert.equal(captured.values[0], 25)
  assert.equal(captured.values[1], 90)
  assert.deepEqual(captured.values[2], [
    "greenhouse",
    "lever",
    "ashby",
    "smartrecruiters",
    "workable",
    "workday",
    "recruitee",
    "teamtailor",
    "personio",
    "bamboohr",
    "jazzhr",
    "icims",
    "infosys",
    "apple",
  ])

  assert.equal(result.length, 1)
  assert.equal(result[0].id, fakeRow.id)
  assert.equal(result[0].careers_url, fakeRow.careers_url)
  assert.equal(result[0].etag, fakeRow.etag)
  assert.equal(result[0].freshness_tier, "tier_2")
})

test("claimEligibleCompanies: orders strictly by next_harvest_at (no tier priority)", async () => {
  // A strict tier CASE in ORDER BY caused tier_2/tier_3 starvation when
  // tier_1's backlog stayed permanently overdue. Pin the contract: ordering
  // is overdueness-only; tier influence flows through next_harvest_at itself.
  let captured = ""
  const pool = {
    query: async (text: string) => {
      captured = text
      return { rows: [], rowCount: 0 } as unknown as QueryResult
    },
  } as unknown as Pool

  await claimEligibleCompanies(pool, 10, 60)

  assert.match(captured, /ORDER BY next_harvest_at ASC NULLS FIRST/)
  assert.ok(
    !/CASE\s+COALESCE\(freshness_tier/i.test(captured),
    "ORDER BY must not include a freshness_tier CASE — that re-introduces tier_2/tier_3 starvation"
  )
})

test("adapterNameFor: uses ats_type when present and supported", () => {
  const name = adapterNameFor({
    id: "x",
    name: "Acme",
    careers_url: "https://acme.com/jobs",
    domain: "acme.com",
    ats_type: "greenhouse",
    raw_ats_config: null,
    etag: null,
    last_modified: null,
    freshness_tier: null,
  })
  assert.equal(name, "greenhouse")
})

test("adapterNameFor: falls back to URL detection when ats_type is null", () => {
  const name = adapterNameFor({
    id: "x",
    name: "Acme",
    careers_url: "https://boards.greenhouse.io/acme",
    domain: "acme.com",
    ats_type: null,
    raw_ats_config: null,
    etag: null,
    last_modified: null,
    freshness_tier: null,
  })
  assert.equal(name, "greenhouse")
})

test("adapterNameFor: returns null when neither path resolves", () => {
  const name = adapterNameFor({
    id: "x",
    name: "Acme",
    careers_url: "https://example.com/jobs",
    domain: "example.com",
    ats_type: null,
    raw_ats_config: null,
    etag: null,
    last_modified: null,
    freshness_tier: null,
  })
  assert.equal(name, null)
})

test("buildAdapterLimits: each registered adapter gets its own limiter using its declared concurrency", () => {
  const { byAdapter, fallback } = buildAdapterLimits(8)
  // Greenhouse declares 16
  const gh = byAdapter.get("greenhouse")
  assert.ok(gh)
  assert.equal(gh!.concurrency, 16)
  // Workday declares 2 (lowered from 4 to leave headroom for 2 worker replicas)
  const wd = byAdapter.get("workday")
  assert.ok(wd)
  assert.equal(wd!.concurrency, 2)
  // SmartRecruiters declares 6
  const sr = byAdapter.get("smartrecruiters")
  assert.equal(sr!.concurrency, 6)
  // Fallback uses the default
  assert.equal(fallback.concurrency, 8)
  // All supported adapters have a limiter
  for (const name of ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "workday", "recruitee", "teamtailor", "personio", "bamboohr", "jazzhr", "icims", "infosys", "apple"]) {
    assert.ok(byAdapter.has(name as "greenhouse"), `missing limiter for ${name}`)
  }
})

test("buildAdapterLimits: adapters without explicit concurrency use the default", () => {
  // No adapter currently omits the field, but the helper must still honor it.
  // This test pins the contract for future adapter authors.
  const { fallback } = buildAdapterLimits(12)
  assert.equal(fallback.concurrency, 12)
})

test("claimEligibleCompanies: empty result returns empty array", async () => {
  const pool = {
    query: async () =>
      ({ rows: [], rowCount: 0 } as unknown as QueryResult),
  } as unknown as Pool
  const result = await claimEligibleCompanies(pool, 10, 60)
  assert.equal(result.length, 0)
})

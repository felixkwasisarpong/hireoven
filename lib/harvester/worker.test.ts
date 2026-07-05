import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Pool, QueryResult } from "pg"
import {
  adapterNameFor,
  buildAdapterLimits,
  claimEligibleCompanies,
  loadWorkerConfig,
  resolvePerCompanyTimeoutMs,
  scaleWorkerConfigForLoops,
  type AdapterClaimFilter,
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
    HARVESTER_INCLUDE_ADAPTERS: "greenhouse",
  })
  assert.equal(config.tickIntervalMs, 5_000)
  assert.equal(config.claimBatchSize, 40)
  assert.equal(config.leaseSeconds, 300)
  assert.equal(config.concurrency, 12)
  assert.deepEqual(config.adapterFilter, { include: ["greenhouse"], exclude: [] })
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

test("resolvePerCompanyTimeoutMs: uses ATS-specific defaults for slow adapters", () => {
  assert.equal(resolvePerCompanyTimeoutMs("workday", {}), 60_000)
  assert.equal(resolvePerCompanyTimeoutMs("smartrecruiters", {}), 60_000)
  assert.equal(resolvePerCompanyTimeoutMs("apple", {}), 280_000)
  assert.equal(resolvePerCompanyTimeoutMs("greenhouse", {}), 60_000)
})

test("resolvePerCompanyTimeoutMs: global override raises all adapters", () => {
  const env = { HARVESTER_PER_COMPANY_TIMEOUT_MS: "150000" }
  assert.equal(resolvePerCompanyTimeoutMs("workday", env), 150_000)
  assert.equal(resolvePerCompanyTimeoutMs("smartrecruiters", env), 150_000)
  assert.equal(resolvePerCompanyTimeoutMs(null, env), 150_000)
})

test("resolvePerCompanyTimeoutMs: adapter override wins for that adapter only", () => {
  const env = {
    HARVESTER_PER_COMPANY_TIMEOUT_MS: "60000",
    HARVESTER_PER_COMPANY_TIMEOUT_WORKDAY_MS: "180000",
  }
  assert.equal(resolvePerCompanyTimeoutMs("workday", env), 180_000)
  assert.equal(resolvePerCompanyTimeoutMs("greenhouse", env), 60_000)
})

test("scaleWorkerConfigForLoops: divides claim budget across loops", () => {
  const config = {
    tickIntervalMs: 15_000,
    claimBatchSize: 40,
    leaseSeconds: 600,
    concurrency: 12,
  }
  const scaled = scaleWorkerConfigForLoops(config, 6, {})
  assert.equal(scaled.claimBatchSize, 4)
  assert.equal(scaled.tickIntervalMs, config.tickIntervalMs)
  assert.equal(scaled.leaseSeconds, config.leaseSeconds)
})

test("scaleWorkerConfigForLoops: honors bounded total claim budget override", () => {
  const config = {
    tickIntervalMs: 15_000,
    claimBatchSize: 40,
    leaseSeconds: 600,
    concurrency: 12,
  }
  const scaled = scaleWorkerConfigForLoops(config, 6, {
    HARVESTER_TOTAL_CLAIM_BUDGET: "60",
  })
  assert.equal(scaled.claimBatchSize, 10)

  const capped = scaleWorkerConfigForLoops(config, 6, {
    HARVESTER_TOTAL_CLAIM_BUDGET: "500",
  })
  assert.equal(capped.claimBatchSize, 14)
})

test("claimEligibleCompanies: issues SKIP LOCKED claim with lease params and shapes rows", async () => {
  const captured: { text: string; values: unknown[] } = { text: "", values: [] }
  const fakeRow = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Acme",
    careers_url: "https://boards.greenhouse.io/acme",
    domain: "acme.com",
    ats_type: "greenhouse",
    ats_identifier: "acme",
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
    "jobvite",
    "icims",
    "successfactors",
    "taleo",
    "oraclecloud",
    "usajobs",
    "infosys",
    "apple",
    "eightfold",
    "netflix",
    "avature",
    "walmart",
    "sitemapjsonld",
    "ibm",
    "adecco",
    "kelly",
    "radancy",
    "gem",
    "pinpoint",
    "rippling",
    "breezy",
  ])

  assert.equal(result.length, 1)
  assert.equal(result[0].id, fakeRow.id)
  assert.equal(result[0].careers_url, fakeRow.careers_url)
  assert.equal(result[0].ats_identifier, fakeRow.ats_identifier)
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

test("claimEligibleCompanies: supports Workable-only claim filtering", async () => {
  const captured: { text: string; values: unknown[] } = { text: "", values: [] }
  const pool = {
    query: async (text: string, values: unknown[]) => {
      captured.text = text
      captured.values = values
      return { rows: [], rowCount: 0 } as unknown as QueryResult
    },
  } as unknown as Pool
  const filter: AdapterClaimFilter = { include: ["workable"], exclude: [] }

  await claimEligibleCompanies(pool, 10, 60, filter)

  assert.deepEqual(captured.values[2], ["workable"])
  assert.match(captured.text, /apply\.workable\.com/)
  assert.doesNotMatch(captured.text, /jobs\.lever\.co/)
  assert.doesNotMatch(captured.text, /boards\.greenhouse\.io/)
})

test("claimEligibleCompanies: excludes Workable from the broad claim filter", async () => {
  const captured: { text: string; values: unknown[] } = { text: "", values: [] }
  const pool = {
    query: async (text: string, values: unknown[]) => {
      captured.text = text
      captured.values = values
      return { rows: [], rowCount: 0 } as unknown as QueryResult
    },
  } as unknown as Pool
  const filter: AdapterClaimFilter = { include: null, exclude: ["workable"] }

  await claimEligibleCompanies(pool, 10, 60, filter)

  assert.ok(Array.isArray(captured.values[2]))
  assert.ok(!(captured.values[2] as string[]).includes("workable"))
  assert.doesNotMatch(captured.text, /apply\.workable\.com/)
  assert.match(captured.text, /jobs\.lever\.co/)
  assert.match(captured.text, /boards\.greenhouse\.io/)
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
  // Jobvite declares 4
  const jv = byAdapter.get("jobvite")
  assert.equal(jv!.concurrency, 4)
  // Fallback uses the default
  assert.equal(fallback.concurrency, 8)
  // All supported adapters have a limiter
  for (const name of ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "workday", "recruitee", "teamtailor", "personio", "bamboohr", "jazzhr", "jobvite", "icims", "infosys", "apple"]) {
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

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import type { Pool } from "pg"
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici"
import { backsolveAggregatorCompany } from "@/lib/jobs/aggregator-backsolve"
import { __resetAtsRateLimiter } from "@/lib/discovery/ats-rate-limiter"

const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase().trim()

function fakePool(responder: (sql: string, params: unknown[]) => { rows: unknown[] }) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql: norm(sql), params })
      return responder(norm(sql), params)
    },
  }
  return { pool: pool as unknown as Pool, calls }
}

// Responder that satisfies enrollTenantAsCompany's query sequence.
function enrollResponder(): (sql: string) => { rows: unknown[] } {
  return (sql) => {
    if (sql.includes("insert into ats_tenants")) return { rows: [{ id: "tenant-1" }] }
    if (sql.includes("select id from companies where ats_type")) return { rows: [] }
    if (sql.includes("insert into companies")) return { rows: [{ id: "co-1", inserted: true }] }
    return { rows: [] }
  }
}

let original: Dispatcher
let agent: MockAgent

beforeEach(() => {
  __resetAtsRateLimiter()
  original = getGlobalDispatcher()
  agent = new MockAgent()
  agent.disableNetConnect()
  setGlobalDispatcher(agent)
})

afterEach(async () => {
  await agent.close()
  setGlobalDispatcher(original)
  __resetAtsRateLimiter()
})

describe("backsolveAggregatorCompany", () => {
  it("without an apply URL → legacy placeholder path (no network)", async () => {
    const { pool, calls } = fakePool(() => ({ rows: [] }))
    const r = await backsolveAggregatorCompany(pool, { source: "adzuna", applyUrl: null, companyName: "Acme" })
    assert.deepEqual(r, { kind: "placeholder", discoveredVia: "adzuna-no-apply-url" })
    assert.equal(calls.length, 0) // no DB, no fetch
  })

  it("with an apply URL resolving to a board with jobs → enrolled", async () => {
    agent
      .get("https://api.lever.co")
      .intercept({ path: "/v0/postings/acme", method: "GET", query: { mode: "json" } })
      .reply(200, JSON.stringify([{ id: 1 }, { id: 2 }]), { headers: { "content-type": "application/json" } })

    const { pool } = fakePool(enrollResponder())
    const r = await backsolveAggregatorCompany(pool, {
      source: "dice",
      applyUrl: "https://jobs.lever.co/acme/abc123",
      companyName: "Acme",
    })
    assert.deepEqual(r, { kind: "enrolled", companyId: "co-1" })
  })

  it("with an apply URL that has no ATS → placeholder tagged {source}-no-ats", async () => {
    agent.get("https://randomco.example").intercept({ path: "/careers", method: "HEAD" }).reply(200, "")
    agent
      .get("https://randomco.example")
      .intercept({ path: "/careers", method: "GET" })
      .reply(200, "<html><body>no ats here</body></html>", { headers: { "content-type": "text/html" } })

    const { pool } = fakePool(() => ({ rows: [] }))
    const r = await backsolveAggregatorCompany(pool, {
      source: "dice",
      applyUrl: "https://randomco.example/careers",
      companyName: "RandomCo",
    })
    assert.deepEqual(r, { kind: "placeholder", discoveredVia: "dice-no-ats" })
  })

  it("with a board error → retry_later + ats_tenants retry upsert", async () => {
    agent
      .get("https://api.lever.co")
      .intercept({ path: "/v0/postings/acme", method: "GET", query: { mode: "json" } })
      .reply(503, "down")

    const { pool, calls } = fakePool(() => ({ rows: [] }))
    const r = await backsolveAggregatorCompany(pool, {
      source: "adzuna",
      applyUrl: "https://jobs.lever.co/acme/abc",
      companyName: "Acme",
    })
    assert.deepEqual(r, { kind: "retry_later" })
    // A retry_later tenant upsert should have been attempted (ats pair was known).
    const retryCall = calls.find((c) => c.sql.includes("insert into ats_tenants") && c.sql.includes("retry_later"))
    assert.ok(retryCall, "expected a retry_later ats_tenants upsert")
    assert.equal(retryCall!.params[0], "lever")
    assert.equal(retryCall!.params[1], "acme")
  })
})

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { Pool } from "pg"
import { enrollTenantAsCompany, buildCareersUrl } from "@/lib/discovery/enroll-tenant-as-company"

// No pg-mem / test DB exists in this repo (every other test is pure-function),
// so we drive enrollTenantAsCompany with a fake pool that pattern-matches the
// SQL and returns scripted rows. This exercises the full control flow —
// tenant upsert, ATS-pair lookup, link-vs-insert, tier + name derivation —
// without a database.

type QueryResponder = (sql: string, params: unknown[]) => { rows: unknown[] }

// Collapse whitespace/newlines so substring matching is insensitive to SQL
// formatting (the real queries are multi-line).
const norm = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase().trim()

function fakePool(responder: QueryResponder) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params })
      return responder(norm(sql), params)
    },
  }
  return { pool: pool as unknown as Pool, calls }
}

function find(calls: Array<{ sql: string; params: unknown[] }>, needle: string) {
  return calls.find((c) => norm(c.sql).includes(needle))
}

const TENANT_ID = "11111111-1111-1111-1111-111111111111"

// Default responder: tenant upserts to TENANT_ID, no existing company, insert
// creates NEW_CO. Override per test by passing a custom responder.
function defaultResponder(opts: {
  existingCompanyId?: string | null
  insertedCompany?: { id: string; inserted: boolean }
}): QueryResponder {
  return (sql) => {
    if (sql.includes("insert into ats_tenants")) return { rows: [{ id: TENANT_ID }] }
    if (sql.includes("select id from companies where ats_type")) {
      return { rows: opts.existingCompanyId ? [{ id: opts.existingCompanyId }] : [] }
    }
    if (sql.includes("insert into companies")) {
      return { rows: [opts.insertedCompany ?? { id: "co-new", inserted: true }] }
    }
    if (sql.includes("update ats_tenants")) return { rows: [] }
    return { rows: [] }
  }
}

describe("enrollTenantAsCompany", () => {
  it("creates a company and links the tenant when none exists", async () => {
    const { pool, calls } = fakePool(
      defaultResponder({ existingCompanyId: null, insertedCompany: { id: "co-new", inserted: true } }),
    )

    const r = await enrollTenantAsCompany(pool, {
      atsType: "lever",
      atsIdentifier: "acme",
      confidence: 90,
      jobCount: 12,
      sourceType: "adzuna",
      companyNameGuess: "Acme Inc",
      domainGuess: "acme.com",
    })

    assert.equal(r.created, true)
    assert.equal(r.companyId, "co-new")
    assert.equal(r.tenantId, TENANT_ID)
    assert.equal(r.atsType, "lever")
    assert.equal(r.atsIdentifier, "acme")

    // Tenant upserted, company inserted, tenant linked to the new company.
    assert.ok(find(calls, "insert into ats_tenants"))
    const insert = find(calls, "insert into companies")
    assert.ok(insert)
    assert.equal(insert!.params[1], "acme.com") // domain = domainGuess
    assert.equal(insert!.params[2], "https://jobs.lever.co/acme") // careers_url
    const link = calls.find((c) => c.sql.toLowerCase().includes("update ats_tenants") && c.params[0] === "co-new")
    assert.ok(link, "tenant should be linked to the new company id")
  })

  it("links an existing company by (ats_type, ats_identifier) without inserting", async () => {
    const { pool, calls } = fakePool(defaultResponder({ existingCompanyId: "co-existing" }))

    const r = await enrollTenantAsCompany(pool, {
      atsType: "greenhouse",
      atsIdentifier: "acme",
      confidence: 90,
      jobCount: 5,
    })

    assert.equal(r.created, false)
    assert.equal(r.companyId, "co-existing")
    assert.equal(r.tenantId, TENANT_ID)
    // No company insert should have happened.
    assert.equal(find(calls, "insert into companies"), undefined)
    // Tenant linked to the existing company.
    const link = calls.find((c) => c.sql.toLowerCase().includes("update ats_tenants") && c.params[0] === "co-existing")
    assert.ok(link)
  })

  it("enriches an existing company matched by domain (ON CONFLICT update)", async () => {
    // No ATS-pair match, but the domain already exists → ON CONFLICT returns
    // the existing row with inserted=false.
    const { pool } = fakePool(
      defaultResponder({ existingCompanyId: null, insertedCompany: { id: "co-domain", inserted: false } }),
    )

    const r = await enrollTenantAsCompany(pool, {
      atsType: "lever",
      atsIdentifier: "acme",
      confidence: 80,
      jobCount: 3,
      domainGuess: "acme.com",
    })

    assert.equal(r.created, false) // it was an UPDATE via domain conflict
    assert.equal(r.companyId, "co-domain")
  })

  it("derives freshness_tier from jobCount: 100→tier_1, 10→tier_2, 1→tier_3", async () => {
    for (const [jobCount, tier] of [
      [100, "tier_1"],
      [10, "tier_2"],
      [1, "tier_3"],
    ] as const) {
      const { pool, calls } = fakePool(defaultResponder({ existingCompanyId: null }))
      await enrollTenantAsCompany(pool, {
        atsType: "lever",
        atsIdentifier: `acme-${jobCount}`,
        confidence: 90,
        jobCount,
      })
      const insert = find(calls, "insert into companies")
      assert.ok(insert)
      assert.equal(insert!.params[5], tier, `jobCount ${jobCount} → ${tier}`)
    }
  })

  it("falls back name → atsIdentifier when companyNameGuess is absent", async () => {
    const { pool, calls } = fakePool(defaultResponder({ existingCompanyId: null }))
    await enrollTenantAsCompany(pool, {
      atsType: "ashby",
      atsIdentifier: "acme",
      confidence: 70,
    })
    const insert = find(calls, "insert into companies")
    assert.ok(insert)
    assert.equal(insert!.params[0], "acme") // name === atsIdentifier
    assert.equal(insert!.params[1], "acme.ashby-tenant") // synthetic domain fallback
  })
})

describe("buildCareersUrl", () => {
  it("delegates to canonicalCareersUrl for known ATSes", () => {
    assert.equal(buildCareersUrl("greenhouse", "acme"), "https://boards.greenhouse.io/acme")
    assert.equal(buildCareersUrl("lever", "acme"), "https://jobs.lever.co/acme")
    assert.equal(buildCareersUrl("ashby", "acme"), "https://jobs.ashbyhq.com/acme")
    assert.equal(buildCareersUrl("smartrecruiters", "acme"), "https://jobs.smartrecruiters.com/acme")
  })

  it("falls back to the source URL, then a synthetic root, when canonical is null", () => {
    // workday needs a tenant:wd:site tuple; a bare slug yields null → fallbacks.
    assert.equal(buildCareersUrl("workday", "acme", "https://acme.wd1.myworkdayjobs.com/x"), "https://acme.wd1.myworkdayjobs.com/x")
    assert.equal(buildCareersUrl("workday", "acme"), "https://acme.workday-tenant")
  })
})

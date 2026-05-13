import { strict as assert } from "node:assert"
import { test } from "node:test"
import { discoverHostsForApex, extractCustomerSlug, fetchCrtShEntries } from "./crtsh"

test("extractCustomerSlug: returns customer label for direct subdomains", () => {
  assert.equal(extractCustomerSlug("loomly.workable.com", "workable.com"), "loomly")
})

test("extractCustomerSlug: returns nested customer for deeper subdomains", () => {
  assert.equal(
    extractCustomerSlug("nvidia.wd5.myworkdayjobs.com", "myworkdayjobs.com"),
    "nvidia"
  )
})

test("extractCustomerSlug: rejects vendor reserved labels", () => {
  assert.equal(extractCustomerSlug("www.workable.com", "workable.com"), null)
  assert.equal(extractCustomerSlug("apply.workable.com", "workable.com"), null)
  assert.equal(extractCustomerSlug("boards.greenhouse.io", "greenhouse.io"), null)
})

test("extractCustomerSlug: rejects apex itself", () => {
  assert.equal(extractCustomerSlug("workable.com", "workable.com"), null)
})

test("extractCustomerSlug: rejects non-matching hosts", () => {
  assert.equal(extractCustomerSlug("loomly.example.com", "workable.com"), null)
})

test("extractCustomerSlug: rejects malformed labels", () => {
  assert.equal(extractCustomerSlug("-bad.workable.com", "workable.com"), null)
  assert.equal(extractCustomerSlug("a.workable.com", "workable.com"), null) // too short
})

test("extractCustomerSlug: BambooHR filters obvious trial/demo/random slugs", () => {
  // Real-looking customers pass.
  assert.equal(extractCustomerSlug("acmecorp.bamboohr.com", "bamboohr.com"), "acmecorp")
  assert.equal(extractCustomerSlug("tipton-associates.bamboohr.com", "bamboohr.com"), "tipton-associates")
  // Trial/demo/test suffixes get filtered.
  assert.equal(extractCustomerSlug("csgdemo.bamboohr.com", "bamboohr.com"), null)
  assert.equal(extractCustomerSlug("falconheatinganairtrial.bamboohr.com", "bamboohr.com"), null)
  assert.equal(extractCustomerSlug("blogtest.bamboohr.com", "bamboohr.com"), null)
  assert.equal(extractCustomerSlug("envisionstaging.bamboohr.com", "bamboohr.com"), null)
  assert.equal(extractCustomerSlug("hrboss-sandbox.bamboohr.com", "bamboohr.com"), null)
  // Random consonant-only slugs and short numbered slugs get filtered.
  assert.equal(extractCustomerSlug("chgjhkjlkj.bamboohr.com", "bamboohr.com"), null)
  assert.equal(extractCustomerSlug("bhgjj.bamboohr.com", "bamboohr.com"), null)
  assert.equal(extractCustomerSlug("ybr1.bamboohr.com", "bamboohr.com"), null)
  assert.equal(extractCustomerSlug("tnp2.bamboohr.com", "bamboohr.com"), null)
})

test("extractCustomerSlug: Workday requires {tenant}.wdN.myworkdayjobs.com shape", () => {
  // Real tenant hosts pass.
  assert.equal(
    extractCustomerSlug("nvidia.wd5.myworkdayjobs.com", "myworkdayjobs.com"),
    "nvidia"
  )
  // Workday-internal infra returned by crt.sh must be filtered out — these
  // hosts have no customer tenant in front of the `wdN` cluster label.
  assert.equal(extractCustomerSlug("wd117.myworkdayjobs.com", "myworkdayjobs.com"), null)
  assert.equal(extractCustomerSlug("dr-wd501.myworkdayjobs.com", "myworkdayjobs.com"), null)
  assert.equal(extractCustomerSlug("impl-wd108.myworkdayjobs.com", "myworkdayjobs.com"), null)
  assert.equal(extractCustomerSlug("impltest-wd11.myworkdayjobs.com", "myworkdayjobs.com"), null)
  assert.equal(extractCustomerSlug("wd3-dr.myworkdayjobs.com", "myworkdayjobs.com"), null)
})

test("discoverHostsForApex: parses name_value SAN lists and dedupes", async () => {
  const fakeFetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => [
        {
          common_name: "loomly.workable.com",
          name_value: "loomly.workable.com\n*.loomly.workable.com\nstaging.loomly.workable.com",
        },
        {
          common_name: "matterport.workable.com",
          name_value: "matterport.workable.com",
        },
        {
          common_name: "www.workable.com",
          name_value: "www.workable.com\nworkable.com",
        },
      ],
    }) as Response) as unknown as typeof fetch

  const hosts = await discoverHostsForApex("workable.com", { fetchImpl: fakeFetch })

  const slugs = hosts.map((h) => h.slug).sort()
  assert.deepEqual(slugs, ["loomly", "matterport"])
  // Vendor labels (www, staging) and apex are filtered out:
  assert.equal(hosts.find((h) => h.slug === "www"), undefined)
  assert.equal(hosts.find((h) => h.slug === "staging"), undefined)
})

test("fetchCrtShEntries: retries on 503 then succeeds", async () => {
  let calls = 0
  const fakeFetch = (async () => {
    calls += 1
    if (calls < 2) {
      return { ok: false, status: 503, json: async () => [] } as Response
    }
    return { ok: true, status: 200, json: async () => [{ common_name: "a.example.com" }] } as Response
  }) as unknown as typeof fetch

  const entries = await fetchCrtShEntries("example.com", { fetchImpl: fakeFetch, maxAttempts: 3 })
  assert.equal(entries.length, 1)
  assert.ok(calls >= 2, "expected at least one retry on 503")
})

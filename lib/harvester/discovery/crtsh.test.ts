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

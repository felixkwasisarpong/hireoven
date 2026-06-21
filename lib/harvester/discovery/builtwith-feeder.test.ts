import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  extractAtsUrls,
  fetchBuiltWithDomains,
  normalizeDomain,
  parseDomainList,
  resolveDomainAts,
} from "./builtwith-feeder"

test("normalizeDomain strips scheme/www/path and rejects junk", () => {
  assert.equal(normalizeDomain("https://www.Acme.com/careers"), "acme.com")
  assert.equal(normalizeDomain("acme.io"), "acme.io")
  assert.equal(normalizeDomain("# comment"), null)
  assert.equal(normalizeDomain("not a domain"), null)
})

test("parseDomainList dedupes, drops comments, takes first CSV field", () => {
  const list = parseDomainList(
    ["acme.com", "# skip me", "acme.com", "globex.io,Greenhouse,123", ""].join("\n")
  )
  assert.deepEqual(list, ["acme.com", "globex.io"])
})

test("extractAtsUrls keeps only adapter-matched URLs", () => {
  const html =
    '<a href="https://boards.greenhouse.io/acme">Jobs</a>' +
    '<a href="https://acme.com/about">About</a>'
  assert.deepEqual(extractAtsUrls(html), ["https://boards.greenhouse.io/acme"])
})

test("resolveDomainAts: careers page that IS an ATS host → enroll", async () => {
  const probe = async () => ({
    ok: true,
    status: 200,
    html: '<a href="https://jobs.lever.co/acme/123">apply</a>',
  })
  // discoverCareersUrl will probe candidate paths; the lever link in HTML makes
  // the page classify as a careers page, then extractAtsUrls finds the ATS URL.
  const res = await resolveDomainAts({ domain: "acme.com", probe })
  assert.equal(res.kind, "enroll")
  if (res.kind === "enroll") assert.equal(res.applyUrl, "https://jobs.lever.co/acme/123")
})

test("resolveDomainAts: no careers page → none", async () => {
  const probe = async () => ({ ok: false, status: 404, html: null })
  const res = await resolveDomainAts({ domain: "acme.com", probe })
  assert.equal(res.kind, "none")
})

test("fetchBuiltWithDomains parses Results envelope + dedupes", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        Results: [{ Domain: "acme.com" }, { D: "globex.io" }, { Domain: "ACME.com" }],
        NextOffset: "abc",
      })
    )
  const { domains, nextOffset } = await fetchBuiltWithDomains({
    tech: "Greenhouse",
    apiKey: "k",
    fetchImpl,
  })
  assert.deepEqual(domains.sort(), ["acme.com", "globex.io"])
  assert.equal(nextOffset, "abc")
})

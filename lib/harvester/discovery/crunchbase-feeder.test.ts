import { strict as assert } from "node:assert"
import { test } from "node:test"
import { fetchCrunchbaseDomains, normalizeDomain } from "./crunchbase-feeder"

test("normalizeDomain strips scheme/www/path and rejects junk", () => {
  assert.equal(normalizeDomain("https://www.Acme.com/careers"), "acme.com")
  assert.equal(normalizeDomain("acme.io"), "acme.io")
  assert.equal(normalizeDomain("http://Globex.IO/about?x=1#y"), "globex.io")
  assert.equal(normalizeDomain("# comment"), null)
  assert.equal(normalizeDomain("not a domain"), null)
  assert.equal(normalizeDomain("localhost"), null)
  assert.equal(normalizeDomain(""), null)
})

test("fetchCrunchbaseDomains parses entities envelope (properties shape)", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        entities: [
          { properties: { website_url: "https://acme.com" } },
          { properties: { homepage_url: "https://www.Globex.io/" } },
          { properties: { website_url: "https://ACME.com/about" } },
          { properties: {} },
        ],
      })
    )
  const { domains } = await fetchCrunchbaseDomains({ apiKey: "k", fetchImpl })
  assert.deepEqual(domains.sort(), ["acme.com", "globex.io"])
})

test("fetchCrunchbaseDomains parses flat results envelope + alt field names", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          { homepage_url: "https://foo.com" },
          { website: "bar.io" },
          { domain: "baz.dev" },
        ],
      })
    )
  const { domains } = await fetchCrunchbaseDomains({ apiKey: "k", fetchImpl })
  assert.deepEqual(domains.sort(), ["bar.io", "baz.dev", "foo.com"])
})

test("fetchCrunchbaseDomains returns [] on non-2xx", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("nope", { status: 401 })
  const { domains } = await fetchCrunchbaseDomains({ apiKey: "k", fetchImpl })
  assert.deepEqual(domains, [])
})

test("fetchCrunchbaseDomains returns [] when fetch throws", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("network down")
  }
  const { domains } = await fetchCrunchbaseDomains({ apiKey: "k", fetchImpl })
  assert.deepEqual(domains, [])
})

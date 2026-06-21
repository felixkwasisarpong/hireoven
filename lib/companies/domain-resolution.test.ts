import test from "node:test"
import assert from "node:assert/strict"
import {
  nameTokens,
  isRejectableDomain,
  domainMatchesName,
  generateDomainCandidates,
  homepageMentionsCompany,
  fetchClearbitDomains,
  resolveCompanyDomainFromName,
} from "@/lib/companies/domain-resolution"

test("nameTokens drops generic filler, keeps distinctive words", () => {
  assert.deepEqual(nameTokens("Acme Health Solutions, Inc."), ["acme", "health"])
  assert.deepEqual(nameTokens("Pinnacle Technical Resources"), ["pinnacle", "technical", "resources"])
  // All-generic name yields nothing → resolver bails rather than guess.
  assert.deepEqual(nameTokens("Global Solutions Group"), [])
})

test("isRejectableDomain rejects ATS, job boards, and social", () => {
  assert.equal(isRejectableDomain("boards.greenhouse.io"), true)
  assert.equal(isRejectableDomain("acme.wd5.myworkdayjobs.com"), true)
  assert.equal(isRejectableDomain("www.linkedin.com"), true)
  assert.equal(isRejectableDomain("indeed.com"), true)
  assert.equal(isRejectableDomain("acme.com"), false)
  assert.equal(isRejectableDomain("pinnacle.io"), false)
})

test("generateDomainCandidates produces the canonical slug first", () => {
  const cands = generateDomainCandidates("Acme Health, Inc.")
  assert.equal(cands[0], "acmehealth.com")
  assert.ok(cands.includes("acme-health.com"))
})

test("generateDomainCandidates does NOT emit a first-token-only domain", () => {
  // "Fisher" alone would resolve to the wrong company (Emerson owns Fisher).
  const cands = generateDomainCandidates("Fisher Investments Careers")
  assert.ok(!cands.includes("fisher.com"), `unexpected first-token candidate: ${cands.join(", ")}`)
})

test("isRejectableDomain rejects domain-parking marketplaces", () => {
  assert.equal(isRejectableDomain("hugedomains.com"), true)
  assert.equal(isRejectableDomain("www.dan.com"), true)
  assert.equal(isRejectableDomain("acme.com"), false)
})

test("domainMatchesName requires the domain's own name to carry a token", () => {
  assert.equal(domainMatchesName("fordphilanthropy.org", ["ford"]), true)
  assert.equal(domainMatchesName("jt4llc.com", ["jt4"]), true)
  // Clearbit's wrong-entity result for "Google" — slug has no "google".
  assert.equal(domainMatchesName("chromeenterprise.google", ["google"]), false)
  assert.equal(domainMatchesName("emerson.com", ["fisher", "investments"]), false)
})

test("homepageMentionsCompany requires a distinctive token", () => {
  assert.equal(homepageMentionsCompany("<title>Pinnacle — Home</title>", ["pinnacle", "technical"]), true)
  assert.equal(homepageMentionsCompany("<h1>Welcome to our site</h1>", ["pinnacle"]), false)
})

test("fetchClearbitDomains parses domains and filters job boards", async () => {
  const fakeFetch = (async () =>
    new Response(
      JSON.stringify([
        { name: "BCforward", domain: "bcforward.com" },
        { name: "BC on LinkedIn", domain: "linkedin.com" },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as unknown as typeof fetch
  const domains = await fetchClearbitDomains("BC Forward", fakeFetch, 1000)
  assert.deepEqual(domains, ["bcforward.com"])
})

test("resolveCompanyDomainFromName confirms a heuristic slug whose homepage matches", async () => {
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("acme.com")) {
      return new Response("<title>Acme Health — Official Site</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    }
    return new Response("not found", { status: 404 })
  }) as unknown as typeof fetch

  const result = await resolveCompanyDomainFromName("Acme", {
    fetchImpl: fakeFetch,
    disableClearbit: true,
  })
  assert.equal(result?.domain, "acme.com")
  assert.equal(result?.method, "heuristic")
  assert.equal(result?.confidence, "high")
})

test("resolveCompanyDomainFromName rejects a live domain that doesn't mention the company", async () => {
  const fakeFetch = (async () =>
    new Response("<title>Domain for sale — buy now</title>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch

  const result = await resolveCompanyDomainFromName("Pinnacle Technical Resources", {
    fetchImpl: fakeFetch,
    disableClearbit: true,
  })
  assert.equal(result, null)
})

test("resolveCompanyDomainFromName returns null for an all-generic name", async () => {
  let called = false
  const fakeFetch = (async () => {
    called = true
    return new Response("", { status: 200 })
  }) as unknown as typeof fetch
  const result = await resolveCompanyDomainFromName("Global Solutions Group", { fetchImpl: fakeFetch })
  assert.equal(result, null)
  assert.equal(called, false, "should not hit the network when there are no distinctive tokens")
})

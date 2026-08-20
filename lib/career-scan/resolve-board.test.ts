import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  brandToken,
  identifierCorroboratesDomain,
  resolveCareerBoard,
  slugCandidatesFor,
} from "./resolve-board"

test("brandToken picks the employer's word out of a host", () => {
  assert.equal(brandToken("zoll.com"), "zoll")
  assert.equal(brandToken("www.datadoghq.com"), "datadoghq")
  assert.equal(brandToken("https://cloudflare.com/careers"), "cloudflare")
  assert.equal(brandToken("notion.so"), "notion")
})

test("brandToken looks past the careers subdomain", () => {
  // careers.zoll.com is ZOLL's site, not a company called "careers".
  assert.equal(brandToken("careers.zoll.com"), "zoll")
  assert.equal(brandToken("jobs.datadoghq.com"), "datadoghq")
})

test("brandToken is null when there is nothing to go on", () => {
  assert.equal(brandToken(null), null)
  assert.equal(brandToken(""), null)
  assert.equal(brandToken("   "), null)
})

test("the domain leads the guesses, the page name follows", () => {
  const slugs = slugCandidatesFor("datadoghq.com", "Datadog")
  assert.equal(slugs[0], "datadoghq")
  // datadoghq.com's Greenhouse board is "datadog" — only the name finds it.
  assert.ok(slugs.includes("datadog"), `expected "datadog" in ${JSON.stringify(slugs)}`)
})

test("guesses are deduped and bounded so a scan cannot fan out", () => {
  const slugs = slugCandidatesFor("stripe.com", "Stripe")
  assert.deepEqual(slugs, [...new Set(slugs)])
  assert.ok(slugs.length <= 4, `expected at most 4 probes, got ${slugs.length}`)
})

test("a missing name still yields the domain guess", () => {
  assert.deepEqual(slugCandidatesFor("figma.com", null), ["figma"])
})

test("a mis-attached identifier is not trusted", () => {
  // cloudflare.com is recorded in companies as greenhouse/builtin. Trusting it
  // would have shown BuiltIn's jobs to someone asking about Cloudflare.
  assert.equal(identifierCorroboratesDomain("builtin", "cloudflare.com"), false)
})

test("an identifier that contains the brand is trusted", () => {
  assert.equal(identifierCorroboratesDomain("zoll:wd5:ZOLLMedicalCorp", "zoll.com"), true)
  assert.equal(identifierCorroboratesDomain("custom:careers.autozone.com:jobsearch", "autozone.com"), true)
  assert.equal(identifierCorroboratesDomain("stripe", "stripe.com"), true)
})

test("an abbreviated identifier still corroborates", () => {
  assert.equal(identifierCorroboratesDomain("wgu", "wgu.edu"), true)
})

test("corroboration needs both sides", () => {
  assert.equal(identifierCorroboratesDomain(null, "stripe.com"), false)
  assert.equal(identifierCorroboratesDomain("stripe", null), false)
})

test("an exhausted budget stops the ladder instead of probing anyway", async () => {
  // Resolution runs inside a request with a 60s ceiling, and a single board can
  // take longer than that on its own — AutoZone's Oracle site is 10,000 roles
  // across 50 pages. With no budget left, nothing should be attempted.
  const started = Date.now()
  const result = await resolveCareerBoard({
    submittedUrl: "https://example.com/careers",
    submittedIsAts: false,
    domain: "example.com",
    companyName: "Example",
    budgetMs: 0,
  })

  assert.equal(result.board, null)
  assert.equal(result.pending, null)
  assert.ok(Date.now() - started < 2000, "should give up immediately, not run probes")
})

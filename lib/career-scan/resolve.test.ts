import { strict as assert } from "node:assert"
import { test } from "node:test"
import { resolveCareerSite } from "./resolve"

test("resolves a Greenhouse board URL to an adapter and slug", () => {
  const r = resolveCareerSite("https://boards.greenhouse.io/airbnb")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.target.atsName, "greenhouse")
  assert.equal(r.target.slug, "airbnb")
  assert.equal(r.target.host, "boards.greenhouse.io")
})

test("resolves a Lever board URL", () => {
  const r = resolveCareerSite("https://jobs.lever.co/netflix")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.target.atsName, "lever")
  assert.equal(r.target.slug, "netflix")
})

test("accepts a bare host with no scheme, the way a user pastes it", () => {
  const r = resolveCareerSite("boards.greenhouse.io/stripe")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.target.slug, "stripe")
  assert.ok(r.target.normalizedUrl.startsWith("https://"))
})

test("trims surrounding whitespace", () => {
  const r = resolveCareerSite("   https://jobs.lever.co/figma   ")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.target.slug, "figma")
})

test("refuses job aggregators rather than scanning them", () => {
  for (const url of [
    "https://www.linkedin.com/jobs/search/?keywords=engineer",
    "https://www.indeed.com/q-software-engineer-jobs.html",
    "https://www.glassdoor.com/Job/index.htm",
    "https://wellfound.com/jobs",
  ]) {
    const r = resolveCareerSite(url)
    assert.equal(r.ok, false, `expected refusal for ${url}`)
    if (r.ok) continue
    assert.equal(r.refusal.reason, "aggregator")
  }
})

test("aggregator check matches subdomains but not lookalike suffixes", () => {
  const sub = resolveCareerSite("https://uk.indeed.com/jobs")
  assert.equal(sub.ok, false)
  if (!sub.ok) assert.equal(sub.refusal.reason, "aggregator")

  // "notlinkedin.com" must NOT be treated as linkedin.com
  const lookalike = resolveCareerSite("https://notlinkedin.com/careers")
  assert.equal(lookalike.ok, false)
  if (!lookalike.ok) assert.equal(lookalike.refusal.reason, "unsupported_ats")
})

test("refuses non-http schemes", () => {
  const r = resolveCareerSite("ftp://example.com/jobs")
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.refusal.reason, "not_http")
})

test("refuses empty and malformed input", () => {
  for (const bad of ["", "   ", "http://"]) {
    const r = resolveCareerSite(bad)
    assert.equal(r.ok, false, `expected refusal for ${JSON.stringify(bad)}`)
  }
})

test("reports unsupported_ats for a careers page we cannot identify", () => {
  const r = resolveCareerSite("https://example.com/about/careers")
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.refusal.reason, "unsupported_ats")
  assert.equal(r.refusal.host, "example.com")
})

test("normalized URL strips credentials and hash", () => {
  const r = resolveCareerSite("https://user:pw@boards.greenhouse.io/acme#section")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(!r.target.normalizedUrl.includes("user"))
  assert.ok(!r.target.normalizedUrl.includes("pw@"))
  assert.ok(!r.target.normalizedUrl.includes("#section"))
})

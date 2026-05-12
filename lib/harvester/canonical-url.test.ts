import { strict as assert } from "node:assert"
import { test } from "node:test"
import { canonicalCareersUrl } from "./canonical-url"

test("canonicalCareersUrl: returns greenhouse boards URL", () => {
  assert.equal(canonicalCareersUrl("greenhouse", "stripe"), "https://boards.greenhouse.io/stripe")
})

test("canonicalCareersUrl: returns lever URL", () => {
  assert.equal(canonicalCareersUrl("lever", "anduril"), "https://jobs.lever.co/anduril")
})

test("canonicalCareersUrl: returns ashby URL", () => {
  assert.equal(canonicalCareersUrl("ashby", "anthropic"), "https://jobs.ashbyhq.com/anthropic")
})

test("canonicalCareersUrl: returns smartrecruiters URL with mixed case slug", () => {
  assert.equal(
    canonicalCareersUrl("smartrecruiters", "Bosch"),
    "https://jobs.smartrecruiters.com/Bosch"
  )
})

test("canonicalCareersUrl: returns workable URL with trailing slash", () => {
  assert.equal(canonicalCareersUrl("workable", "loomly"), "https://apply.workable.com/loomly/")
})

test("canonicalCareersUrl: assembles workday URL from 3-tuple slug", () => {
  assert.equal(
    canonicalCareersUrl("workday", "nvidia:wd5:NVIDIAExternalCareerSite"),
    "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite"
  )
})

test("canonicalCareersUrl: returns null for malformed workday slug", () => {
  assert.equal(canonicalCareersUrl("workday", "nvidia:wd5"), null)
  assert.equal(canonicalCareersUrl("workday", "just-tenant"), null)
})

test("canonicalCareersUrl: returns null for empty slug", () => {
  assert.equal(canonicalCareersUrl("greenhouse", ""), null)
})

test("canonicalCareersUrl: round-trips through detectFromUrl", async () => {
  const { detectAdapter } = await import("@/lib/harvester/adapters")
  const pairs: Array<[Parameters<typeof canonicalCareersUrl>[0], string]> = [
    ["greenhouse", "stripe"],
    ["lever", "anduril"],
    ["ashby", "anthropic"],
    ["smartrecruiters", "Bosch"],
    ["workable", "loomly"],
    ["workday", "nvidia:wd5:NVIDIAExternalCareerSite"],
    ["bamboohr", "acme"],
    ["jazzhr", "acme"],
  ]
  for (const [atsType, slug] of pairs) {
    const url = canonicalCareersUrl(atsType, slug)
    assert.ok(url, `expected URL for ${atsType}:${slug}`)
    const detection = detectAdapter(url!)
    assert.ok(detection, `expected detectAdapter to match URL for ${atsType}`)
    assert.equal(detection!.adapter.name, atsType, `${atsType} round-trip name`)
    assert.equal(detection!.slug, slug, `${atsType} round-trip slug`)
  }
})

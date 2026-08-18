import { strict as assert } from "node:assert"
import { test } from "node:test"
import { isAllowedLocation, isNonUsWorksite } from "./location-filter"

test("suppresses on explicit Canadian worksites (T1-05 repro)", () => {
  assert.equal(isNonUsWorksite({ location: "Toronto, ON, CAN" }), true)
  assert.equal(isNonUsWorksite({ location: "Remote, ON" }), true)
  assert.equal(isNonUsWorksite({ location: "Vancouver, British Columbia" }), true)
})

test("suppresses on explicit foreign worksites", () => {
  assert.equal(isNonUsWorksite({ location: "London, United Kingdom" }), true)
  assert.equal(isNonUsWorksite({ location: "Berlin, Germany" }), true)
})

test("does NOT suppress on US worksites", () => {
  assert.equal(isNonUsWorksite({ location: "San Francisco, CA" }), false)
  assert.equal(isNonUsWorksite({ location: "New York, NY" }), false)
  assert.equal(isNonUsWorksite({ location: "Billings, MT" }), false)
  assert.equal(isNonUsWorksite({ location: "United States, Remote" }), false)
  assert.equal(isNonUsWorksite({ location: "Vancouver, WA" }), false) // WA wins over CA-city Vancouver
})

test("does NOT suppress on ambiguous/remote/empty (conservative)", () => {
  assert.equal(isNonUsWorksite({ location: "Remote" }), false)
  assert.equal(isNonUsWorksite({ location: "" }), false)
  assert.equal(isNonUsWorksite({ location: null }), false)
})

// ── Career Site Scout coverage gate ──────────────────────────────────────────
// Site Scout covers US and Canada only, and uses isAllowedLocation to drop the
// rest before roles are persisted, scored and counted in "N roles found".

test("scout gate keeps US and Canada worksites", () => {
  for (const location of [
    "San Francisco, CA",
    "New York, NY · Hybrid",
    "Austin, Texas",
    "Remote - United States",
    "Toronto, ON",
    "Vancouver, British Columbia",
    "Montreal, Quebec, Canada",
    "Reston, VA",
  ]) {
    assert.equal(isAllowedLocation({ location }), true, `should keep ${location}`)
  }
})

test("scout gate drops worksites outside US and Canada", () => {
  for (const location of [
    "London, United Kingdom",
    "Bengaluru, India",
    "Berlin, Germany",
    "Singapore",
    "Sydney, Australia",
    "Dublin, Ireland",
    "Tel Aviv, Israel",
  ]) {
    assert.equal(isAllowedLocation({ location }), false, `should drop ${location}`)
  }
})

test("scout gate stays permissive on ambiguous or missing locations", () => {
  // Conservative on purpose: dropping a real US role because the posting says
  // only "Remote" is worse than letting an ambiguous one through.
  for (const location of ["Remote", "", null]) {
    assert.equal(isAllowedLocation({ location }), true, `should keep ${JSON.stringify(location)}`)
  }
})

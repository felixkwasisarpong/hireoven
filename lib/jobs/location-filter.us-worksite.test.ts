import { strict as assert } from "node:assert"
import { test } from "node:test"
import { isNonUsWorksite } from "./location-filter"

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

import { strict as assert } from "node:assert"
import { test } from "node:test"
import { confirmsUsaJobs, isUsaCountryCode, isUsaLocation } from "./usa-confirm"

test("isUsaLocation accepts US and Canada locations", () => {
  assert.equal(isUsaLocation("Austin, TX"), true)
  assert.equal(isUsaLocation("Toronto, ON"), true)
  assert.equal(isUsaLocation("Vancouver, Canada"), true)
  assert.equal(isUsaLocation("Remote, Canada"), true)
})

test("isUsaLocation rejects clearly out-of-market locations", () => {
  assert.equal(isUsaLocation("Remote - UK"), false)
  assert.equal(isUsaLocation("London, United Kingdom"), false)
  assert.equal(isUsaLocation("Berlin, Germany"), false)
})

test("isUsaCountryCode accepts US and Canada country codes", () => {
  assert.equal(isUsaCountryCode("US"), true)
  assert.equal(isUsaCountryCode("Canada"), true)
  assert.equal(isUsaCountryCode("CA"), true)
  assert.equal(isUsaCountryCode("GB"), false)
})

test("confirmsUsaJobs counts Canadian remote country hints", () => {
  const result = confirmsUsaJobs([
    { location: "Berlin, Germany" },
    { remoteCountries: ["Canada"] },
    { countryCode: "GB" },
  ])
  assert.equal(result.confirmed, true)
  assert.equal(result.usaCount, 1)
})

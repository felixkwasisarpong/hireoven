import assert from "node:assert/strict"
import { test } from "node:test"
import { parseUsLocation } from "./oflc-wage-levels"

// Every case below is a real location string from the jobs feed. The city-name ones are
// regressions that shipped-looking code got wrong once already.

test("a city that is also a state name is kept as a city — 'New York, NY'", () => {
  const p = parseUsLocation("New York, NY")
  assert.equal(p.stateAbbr, "NY")
  assert.ok(p.cities.includes("new york"), "new york must survive as a city candidate")
})

test("'Washington, DC' resolves to DC, not Washington state, and keeps the city", () => {
  const p = parseUsLocation("Washington, DC")
  assert.equal(p.stateAbbr, "DC", "explicit abbreviation must outrank the state name")
  assert.ok(p.cities.includes("washington"))
})

test("a trailing state name is read as the state while the city survives", () => {
  const p = parseUsLocation("Seattle, Washington, USA")
  assert.equal(p.stateAbbr, "WA")
  assert.ok(p.cities.includes("seattle"))
})

test("dash-separated feeds parse — 'Princeton - NJ - US'", () => {
  const p = parseUsLocation("Princeton - NJ - US")
  assert.equal(p.stateAbbr, "NJ")
  assert.ok(p.cities.includes("princeton"))
})

test("counties are extracted with their suffix stripped", () => {
  const p = parseUsLocation("Charlotte, Mecklenburg County")
  assert.equal(p.county, "mecklenburg")
  assert.ok(p.cities.includes("charlotte"), "city is needed to disambiguate a duplicated county name")
})

test("marketing wrappers are stripped — 'Greater Seattle Area'", () => {
  const p = parseUsLocation("Greater Seattle Area")
  assert.ok(p.cities.includes("seattle"))
})

test("'New York City' also offers 'New York', because the metro name is New York-Newark-Jersey City", () => {
  const p = parseUsLocation("New York City")
  assert.ok(p.cities.includes("new york"))
})

// A Canadian req must never be handed a US prevailing wage. "Ontario" collides with a principal
// city of the Riverside-San Bernardino-Ontario, CA metro, which is exactly how that happens.
test("Canadian locations are flagged foreign", () => {
  for (const loc of ["Toronto, Ontario", "Toronto, ON, CAN", "Canada", "Vancouver, British Columbia"]) {
    assert.equal(parseUsLocation(loc).foreign, true, `"${loc}" must be flagged foreign`)
  }
})

test("an explicit US state abbreviation cancels the Canada flag — 'Ontario, CA' is California", () => {
  const p = parseUsLocation("Ontario, CA")
  assert.equal(p.foreign, false)
  assert.equal(p.stateAbbr, "CA")
  assert.ok(p.cities.includes("ontario"))
})

test("country-only and empty strings yield nothing to resolve", () => {
  for (const loc of ["US", "United States", "USA", "", null, undefined]) {
    const p = parseUsLocation(loc)
    assert.equal(p.stateAbbr, null)
    assert.equal(p.county, null)
    assert.deepEqual(p.cities, [])
  }
})

test("'Remote' is not mistaken for a place", () => {
  const p = parseUsLocation("Remote")
  assert.equal(p.stateAbbr, null)
  assert.equal(p.county, null)
})

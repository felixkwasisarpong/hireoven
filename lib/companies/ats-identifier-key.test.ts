import assert from "node:assert/strict"
import test from "node:test"
import {
  atsIdentifierKey,
  atsIdentifierKeySql,
  workdayBoardKey,
} from "@/lib/companies/ats-identifier-key"

test("workdayBoardKey collapses every spelling of one board", () => {
  const expected = "conocophillips/external"
  for (const spelling of [
    "conocophillips:wd1:External",
    "conocophillips:wd1:external",
    "conocophillips/External",
    "conocophillips/external",
    "https://conocophillips.wd1.myworkdayjobs.com/External",
    "https://conocophillips.wd1.myworkdayjobs.com/en-US/External",
  ]) {
    assert.equal(workdayBoardKey(spelling), expected, spelling)
  }
})

test("workdayBoardKey ignores the datacentre segment", () => {
  // A tenant lives in one datacentre; differing wd numbers mean one row is stale.
  // Real pairs found in prod: alation wd5/wd503, fragomen wd1/wd115.
  assert.equal(workdayBoardKey("alation:wd5:ExternalSite"), workdayBoardKey("alation:wd503:ExternalSite"))
  assert.equal(workdayBoardKey("fragomen:wd1:FragomenCareers"), workdayBoardKey("fragomen:wd115:FragomenCareers"))
})

test("workdayBoardKey returns null for non-Workday values", () => {
  assert.equal(workdayBoardKey("acme"), null)
  assert.equal(workdayBoardKey(""), null)
  assert.equal(workdayBoardKey(null), null)
  assert.equal(workdayBoardKey("https://boards.greenhouse.io/acme"), null)
})

test("atsIdentifierKey lower-cases non-Workday identifiers", () => {
  // The Cisco_Careers / cisco_careers class of duplicate.
  assert.equal(atsIdentifierKey("greenhouse", "Acme-Corp"), "acme-corp")
  assert.equal(atsIdentifierKey("rippling", "UpLinq"), "uplinq")
})

test("atsIdentifierKey matches the two ConocoPhillips spellings", () => {
  assert.equal(
    atsIdentifierKey("workday", "conocophillips:wd1:External"),
    atsIdentifierKey("workday", "conocophillips/External")
  )
})

test("atsIdentifierKey returns null without both parts", () => {
  assert.equal(atsIdentifierKey(null, "acme"), null)
  assert.equal(atsIdentifierKey("workday", null), null)
  assert.equal(atsIdentifierKey("workday", "   "), null)
})

test("atsIdentifierKey falls back to lowercase for unparseable Workday values", () => {
  // Must never return null for a real identifier — that would skip the lookup.
  assert.equal(atsIdentifierKey("workday", "weird_value"), "weird_value")
})

test("atsIdentifierKeySql picks the board-aware expression only for Workday", () => {
  assert.match(atsIdentifierKeySql("c.ats_identifier", "workday"), /regexp_replace/)
  assert.equal(atsIdentifierKeySql("c.ats_identifier", "greenhouse"), "lower(c.ats_identifier)")
})

test("workdayBoardKey handles the myworkdaysite host, where the tenant is in the path", () => {
  // wd5.myworkdaysite.com/recruiting/<tenant>/<site> serves the same board as
  // <tenant>.wd5.myworkdayjobs.com/<site> — verified live for Sysco, identical
  // CXS payload — so both must reduce to one key or the same employer gets two
  // company records.
  assert.equal(
    workdayBoardKey("https://wd5.myworkdaysite.com/recruiting/sysco/syscocareers"),
    "sysco/syscocareers"
  )
  assert.equal(
    workdayBoardKey("https://wd5.myworkdaysite.com/en-US/recruiting/sysco/syscocareers"),
    "sysco/syscocareers"
  )
  assert.equal(
    workdayBoardKey("https://sysco.wd5.myworkdayjobs.com/syscocareers"),
    workdayBoardKey("https://wd5.myworkdaysite.com/recruiting/sysco/syscocareers")
  )
})

test("workdayBoardKey rejects malformed myworkdaysite paths", () => {
  assert.equal(workdayBoardKey("https://wd5.myworkdaysite.com/sysco/syscocareers"), null)
  assert.equal(workdayBoardKey("https://wd5.myworkdaysite.com/recruiting/sysco"), null)
  assert.equal(workdayBoardKey("https://wd5.myworkdaysite.com/"), null)
})

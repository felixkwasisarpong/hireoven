import test from "node:test"
import assert from "node:assert/strict"
import { companyIdFromParam, companyParam, companySlug, h1bSponsorPath } from "@/lib/seo/company-seo"

const ID = "7d2f50ba-1eb4-4d0c-8449-eb616d685ca5"

test("companyParam → companyIdFromParam round-trips the UUID", () => {
  const param = companyParam(ID, "Stripe")
  assert.equal(param, "stripe-7d2f50ba1eb44d0c8449eb616d685ca5")
  assert.equal(companyIdFromParam(param), ID)
})

test("round-trips even when the name has punctuation / unicode / spaces", () => {
  for (const name of ["Booz Allen Hamilton", "AT&T", "Ernst & Young", "Café Loop, Inc.", ""]) {
    const param = companyParam(ID, name)
    assert.equal(companyIdFromParam(param), ID, `failed for "${name}"`)
  }
})

test("companySlug is url-safe and bounded", () => {
  assert.equal(companySlug("Ernst & Young LLP"), "ernst-young-llp")
  assert.match(companySlug("X".repeat(200)), /^x+$/)
  assert.ok(companySlug("X".repeat(200)).length <= 60)
  assert.equal(companySlug("!!!"), "company")
})

test("companyIdFromParam rejects malformed input", () => {
  assert.equal(companyIdFromParam("stripe"), null)
  assert.equal(companyIdFromParam("stripe-notahexstringnotahexstringnotahex"), null)
  assert.equal(companyIdFromParam(""), null)
})

test("h1bSponsorPath builds the public route", () => {
  assert.equal(h1bSponsorPath(ID, "Stripe"), "/h1b-sponsors/stripe-7d2f50ba1eb44d0c8449eb616d685ca5")
})

import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  cleanCompanyDisplayName,
  companySlug,
  normalizeCompanyName,
} from "./name-normalization"

test("cleanCompanyDisplayName strips Glassdoor display suffixes and tags", () => {
  assert.equal(
    cleanCompanyDisplayName("<span>Stripe Reviews</span>"),
    "Stripe"
  )
  assert.equal(cleanCompanyDisplayName("Working at OpenAI, Inc. | Glassdoor"), "OpenAI, Inc.")
})

test("normalizeCompanyName strips legal suffixes and punctuation", () => {
  assert.equal(normalizeCompanyName("OpenAI, Inc."), "openai")
  assert.equal(normalizeCompanyName("The Goldman Sachs Group, Inc."), "goldman sachs")
  assert.equal(normalizeCompanyName("Palo Alto Networks LLC"), "palo alto networks")
})

test("companySlug creates stable placeholder-safe slugs", () => {
  assert.equal(companySlug("Palo Alto Networks, Inc."), "palo-alto-networks")
  assert.equal(companySlug("  OpenAI / Applied AI  "), "openai-applied-ai")
})

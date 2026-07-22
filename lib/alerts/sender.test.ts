import { strict as assert } from "node:assert"
import { test } from "node:test"
import { resolveCompanyLogoDomain } from "./sender"

test("resolveCompanyLogoDomain: prefers the domain embedded in logo_url over a placeholder domain column", () => {
  // The exact bug this fixes: domain got overwritten by a later discovery
  // pass, but logo_url still holds the correctly-resolved logo.dev URL.
  assert.equal(
    resolveCompanyLogoDomain({
      logo_url: "https://img.logo.dev/evertech.ai?token=pk_abc",
      domain: "evertech.workable.discovered",
    }),
    "evertech.ai"
  )
})

test("resolveCompanyLogoDomain: falls back to domain when logo_url is missing", () => {
  assert.equal(resolveCompanyLogoDomain({ logo_url: null, domain: "stripe.com" }), "stripe.com")
})

test("resolveCompanyLogoDomain: falls back to domain when logo_url isn't a logo.dev URL", () => {
  assert.equal(
    resolveCompanyLogoDomain({ logo_url: "https://logo.clearbit.com/stripe.com", domain: "stripe.com" }),
    "stripe.com"
  )
})

test("resolveCompanyLogoDomain: applies the brand-domain override on the domain fallback path", () => {
  assert.equal(resolveCompanyLogoDomain({ logo_url: null, domain: "jj.com" }), "jnj.com")
})

test("resolveCompanyLogoDomain: returns null when both logo_url and domain are unusable", () => {
  assert.equal(resolveCompanyLogoDomain({ logo_url: null, domain: "acme.workday-tenant" }), null)
  assert.equal(resolveCompanyLogoDomain(null), null)
  assert.equal(resolveCompanyLogoDomain(undefined), null)
})

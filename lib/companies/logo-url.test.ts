import { strict as assert } from "node:assert"
import { test } from "node:test"
import { extractDomainFromLogoDevUrl } from "./logo-url"

test("extractDomainFromLogoDevUrl: extracts the domain from a logo.dev URL", () => {
  assert.equal(
    extractDomainFromLogoDevUrl("https://img.logo.dev/evertech.ai?token=pk_abc&size=256&format=png"),
    "evertech.ai"
  )
})

test("extractDomainFromLogoDevUrl: normalizes case and strips www", () => {
  assert.equal(extractDomainFromLogoDevUrl("https://img.logo.dev/WWW.Stripe.com?token=pk_abc"), "stripe.com")
})

test("extractDomainFromLogoDevUrl: returns null for non-logo.dev hosts", () => {
  assert.equal(extractDomainFromLogoDevUrl("https://logo.clearbit.com/stripe.com"), null)
  assert.equal(extractDomainFromLogoDevUrl("https://www.google.com/s2/favicons?domain=stripe.com"), null)
})

test("extractDomainFromLogoDevUrl: returns null for null/empty/malformed input", () => {
  assert.equal(extractDomainFromLogoDevUrl(null), null)
  assert.equal(extractDomainFromLogoDevUrl(undefined), null)
  assert.equal(extractDomainFromLogoDevUrl(""), null)
  assert.equal(extractDomainFromLogoDevUrl("not a url"), null)
  assert.equal(extractDomainFromLogoDevUrl("https://img.logo.dev/?token=pk_abc"), null)
})

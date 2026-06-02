import { strict as assert } from "node:assert"
import { test } from "node:test"
import { detectGlassdoorBlockSignal } from "./block-signals"

test("detectGlassdoorBlockSignal stops on rate-limit and access-control statuses", () => {
  assert.deepEqual(
    detectGlassdoorBlockSignal({ status: 429, finalUrl: "https://www.glassdoor.com/Explore", html: "" }),
    { blocked: true, reason: "http_429" }
  )
  assert.deepEqual(
    detectGlassdoorBlockSignal({ status: 403, finalUrl: "https://www.glassdoor.com/Explore", html: "" }),
    { blocked: true, reason: "http_403" }
  )
})

test("detectGlassdoorBlockSignal stops on login redirects", () => {
  const result = detectGlassdoorBlockSignal({
    status: 200,
    finalUrl: "https://www.glassdoor.com/profile/login.htm",
    html: "<html></html>",
  })
  assert.equal(result.blocked, true)
  assert.equal(result.reason, "login_or_access_control_redirect")
})

test("detectGlassdoorBlockSignal stops on CAPTCHA and bot-check pages", () => {
  assert.equal(
    detectGlassdoorBlockSignal({
      status: 200,
      finalUrl: "https://www.glassdoor.com/Explore",
      html: "<div>Please verify you are human</div>",
    }).blocked,
    true
  )
  assert.equal(
    detectGlassdoorBlockSignal({
      status: 200,
      finalUrl: "https://www.glassdoor.com/Explore",
      html: "<script>window.dd='DataDome'</script>",
    }).reason,
    "datadome_challenge"
  )
})

import { strict as assert } from "node:assert"
import { test } from "node:test"
import { hostMatchesProxy, proxyHostSuffixes } from "./http-agent"

test("hostMatchesProxy: matches exact host and subdomains of a suffix", () => {
  const suffixes = ["myworkdayjobs.com"]
  assert.equal(hostMatchesProxy("nvidia.wd5.myworkdayjobs.com", suffixes), true)
  assert.equal(hostMatchesProxy("myworkdayjobs.com", suffixes), true)
  assert.equal(hostMatchesProxy("Teladoc.WD1.MyWorkdayJobs.com", suffixes), true)
})

test("hostMatchesProxy: does not match unrelated or look-alike hosts", () => {
  const suffixes = ["myworkdayjobs.com"]
  assert.equal(hostMatchesProxy("boards.greenhouse.io", suffixes), false)
  // suffix must be a dot-boundary match, not a substring
  assert.equal(hostMatchesProxy("notmyworkdayjobs.com", suffixes), false)
  assert.equal(hostMatchesProxy("myworkdayjobs.com.evil.test", suffixes), false)
})

test("proxyHostSuffixes: defaults to workday, overridable + trimmed", () => {
  assert.deepEqual(proxyHostSuffixes({}), ["myworkdayjobs.com"])
  assert.deepEqual(
    proxyHostSuffixes({ HARVESTER_PROXY_HOSTS: "myworkdayjobs.com, icims.com , " }),
    ["myworkdayjobs.com", "icims.com"]
  )
})

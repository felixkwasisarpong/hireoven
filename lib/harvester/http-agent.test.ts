import { strict as assert } from "node:assert"
import { test } from "node:test"
import { hostMatchesProxy, proxyHostSuffixes, PROXY_KEEP_ALIVE_MS } from "./http-agent"

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

test("proxyHostSuffixes: defaults include workday + workable; env is additive + trimmed", () => {
  assert.deepEqual(proxyHostSuffixes({}), ["myworkdayjobs.com", "apply.workable.com"])
  // env EXTENDS the defaults (never drops them), trims, and dedupes.
  assert.deepEqual(
    proxyHostSuffixes({ HARVESTER_PROXY_HOSTS: "myworkdayjobs.com, icims.com , " }),
    ["myworkdayjobs.com", "apply.workable.com", "icims.com"]
  )
})

test("proxied hosts route to the proxy, and its keep-alive is off so IPs rotate per request", () => {
  // Workable + Workday egress through the rotating residential proxy.
  assert.equal(hostMatchesProxy("apply.workable.com", proxyHostSuffixes({})), true)
  assert.equal(hostMatchesProxy("nvidia.wd5.myworkdayjobs.com", proxyHostSuffixes({})), true)
  // The proxy tunnel must NOT keep-alive — otherwise a burst of requests reuses
  // one connection = one egress IP, which Workable then rate-limits (429 bursts).
  assert.ok(
    PROXY_KEEP_ALIVE_MS <= 100,
    "proxy keep-alive must be ~off (≤100ms) for per-request IP rotation"
  )
})

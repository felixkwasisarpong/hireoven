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

test("proxied hosts route to the proxy with a moderate keep-alive (reuse tunnel, avoid CONNECT storm)", () => {
  // Workable + Workday egress through the residential proxy.
  assert.equal(hostMatchesProxy("apply.workable.com", proxyHostSuffixes({})), true)
  assert.equal(hostMatchesProxy("nvidia.wd5.myworkdayjobs.com", proxyHostSuffixes({})), true)
  // Keep-alive is MODERATE, not off: a fresh CONNECT tunnel per request storms
  // the proxy under concurrent load and produces >20s hangs logged as timeouts.
  // A short-lived reused tunnel avoids the storm; the per-host rate gate — not
  // per-request IP rotation — is what keeps Workable 429s down.
  assert.ok(
    PROXY_KEEP_ALIVE_MS >= 1_000 && PROXY_KEEP_ALIVE_MS <= 60_000,
    "proxy keep-alive should be moderate (reuse within a burst, still recycle)"
  )
})

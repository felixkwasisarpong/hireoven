import { strict as assert } from "node:assert"
import { test } from "node:test"
import { __resetAtsRateLimiter } from "@/lib/discovery/ats-rate-limiter"
import { harvesterFetch, hostMatchesProxy, proxyHostSuffixes, rateLimitKeyForHost } from "./http-agent"

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

test("rateLimitKeyForHost: maps shared ATS hosts to limiter keys", () => {
  assert.equal(rateLimitKeyForHost("apply.workable.com"), "workable")
  assert.equal(rateLimitKeyForHost("boards-api.greenhouse.io"), "greenhouse")
  assert.equal(rateLimitKeyForHost("careers-acme.icims.com"), "icims")
  assert.equal(rateLimitKeyForHost("tenant.wd5.myworkdayjobs.com"), "workday")
  assert.equal(rateLimitKeyForHost("example.com"), null)
})

test("harvesterFetch: returns a synthetic 429 when the ATS limiter queue is full", async () => {
  const saved = {
    queueCap: process.env.ATS_RATE_LIMIT_QUEUE_CAP,
    rps: process.env.ATS_RATE_LIMIT_WORKABLE_RPS,
    burst: process.env.ATS_RATE_LIMIT_WORKABLE_BURST,
  }
  try {
    process.env.ATS_RATE_LIMIT_QUEUE_CAP = "0"
    process.env.ATS_RATE_LIMIT_WORKABLE_RPS = "0"
    process.env.ATS_RATE_LIMIT_WORKABLE_BURST = "0"
    __resetAtsRateLimiter()

    const response = await harvesterFetch("https://apply.workable.com/api/v3/accounts/acme/jobs", {
      method: "POST",
    })

    assert.equal(response.status, 429)
    assert.equal(response.headers.get("retry-after"), "60")
  } finally {
    if (saved.queueCap === undefined) delete process.env.ATS_RATE_LIMIT_QUEUE_CAP
    else process.env.ATS_RATE_LIMIT_QUEUE_CAP = saved.queueCap
    if (saved.rps === undefined) delete process.env.ATS_RATE_LIMIT_WORKABLE_RPS
    else process.env.ATS_RATE_LIMIT_WORKABLE_RPS = saved.rps
    if (saved.burst === undefined) delete process.env.ATS_RATE_LIMIT_WORKABLE_BURST
    else process.env.ATS_RATE_LIMIT_WORKABLE_BURST = saved.burst
    __resetAtsRateLimiter()
  }
})

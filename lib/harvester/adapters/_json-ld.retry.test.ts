import { strict as assert } from "node:assert"
import { test } from "node:test"
import { fetchHtmlConditional, parseRetryAfterMs } from "./_json-ld"
import type { HarvestCtx } from "./_base"

// Keep honored cooldowns tiny so the suite stays fast.
process.env.HARVESTER_RETRY_AFTER_CAP_MS = "40"

function ctxWith(fetchImpl: typeof fetch): HarvestCtx {
  return { etag: null, lastModified: null, fetchImpl } as HarvestCtx
}

test("parseRetryAfterMs handles delta-seconds and caps to the configured max", () => {
  assert.equal(parseRetryAfterMs("0"), 0)
  assert.equal(parseRetryAfterMs("5"), 40) // 5000ms capped to 40
  assert.equal(parseRetryAfterMs(null), null)
  assert.equal(parseRetryAfterMs("garbage"), null)
})

test("honors Retry-After on a 429 then succeeds on the next attempt", async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    if (calls === 1) {
      return new Response("rate limited", { status: 429, headers: { "retry-after": "5" } })
    }
    return new Response("<html>ok</html>", { status: 200 })
  }) as unknown as typeof fetch

  const start = Date.now()
  const result = await fetchHtmlConditional("https://x.icims.com/jobs/search", ctxWith(fetchImpl))
  const elapsed = Date.now() - start

  assert.equal(result.kind, "ok")
  assert.equal(calls, 2)
  // It waited the capped Retry-After (~40ms), not the larger 250ms+ base backoff.
  assert.ok(elapsed >= 35, `expected to honor the cooldown, waited ${elapsed}ms`)
  assert.ok(elapsed < 200, `expected the capped cooldown, not base backoff, waited ${elapsed}ms`)
})

test("gives up with the 429 status after exhausting attempts", async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    return new Response("nope", { status: 429, headers: { "retry-after": "1" } })
  }) as unknown as typeof fetch

  const result = await fetchHtmlConditional("https://x.icims.com/jobs/search", ctxWith(fetchImpl), {
    maxAttempts: 2,
  })

  assert.equal(result.kind, "error")
  if (result.kind === "error") {
    assert.equal(result.status, 429)
    assert.equal(result.reason, "http_429")
  }
  assert.equal(calls, 2)
})

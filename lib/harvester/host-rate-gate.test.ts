import { strict as assert } from "node:assert"
import { test } from "node:test"
import { gateHostRate, isHostGated, __setHostRateConfig, __resetHostRateGate } from "@/lib/harvester/host-rate-gate"

test("unconfigured hosts are never gated (instant, no wait)", async () => {
  __resetHostRateGate()
  __setHostRateConfig("apply.workable.com=6")
  assert.equal(isHostGated("https://boards.greenhouse.io/stripe"), false)
  const t0 = Date.now()
  await gateHostRate("https://boards.greenhouse.io/stripe")
  assert.ok(Date.now() - t0 < 20)
})

test("configured host matches by suffix", () => {
  __setHostRateConfig("workable.com=6")
  assert.equal(isHostGated("https://apply.workable.com/x"), true)
  assert.equal(isHostGated("https://jobs.workable.com/y"), true)
  assert.equal(isHostGated("https://notworkable.io/z"), false)
})

test("gate throttles once the burst allowance is spent", async () => {
  // HARVESTER_INSTANCES defaults to 1 in tests → per-process rate = cluster rate.
  // Rate 20/s → burst capacity ~20 tokens, then ~50ms/token.
  __setHostRateConfig("apply.workable.com=20")
  const base = 1_000_000 // fixed virtual clock so refill is deterministic
  // Drain the burst: 20 tokens available at capacity, all instant.
  for (let i = 0; i < 20; i++) await gateHostRate("https://apply.workable.com/api", base)
  // 21st with no time elapsed must wait (~50ms for 1 token at 20/s).
  const t0 = Date.now()
  await gateHostRate("https://apply.workable.com/api", base)
  const waited = Date.now() - t0
  assert.ok(waited >= 30, `expected a throttle wait, got ${waited}ms`)
})

test("__resetHostRateGate clears config", async () => {
  __setHostRateConfig("apply.workable.com=6")
  assert.equal(isHostGated("https://apply.workable.com/x"), true)
  __resetHostRateGate() // no env set → empty config
  assert.equal(isHostGated("https://apply.workable.com/x"), false)
})

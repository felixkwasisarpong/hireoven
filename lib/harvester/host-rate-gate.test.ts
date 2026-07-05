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

import { reportHostResult, __hostGateState } from "@/lib/harvester/host-rate-gate"

test("a 429 auto-gates a previously-unlisted host (adaptive protection)", () => {
  __resetHostRateGate() // no config at all
  const url = "https://unforeseen.example.com/jobs"
  assert.equal(isHostGated(url), false)
  reportHostResult(url, 429)
  assert.equal(isHostGated(url), true, "host protects itself the moment it pushes back")
  const s = __hostGateState(url)!
  assert.ok(s.currentRate > 0 && s.currentRate <= 3, `adopts a conservative rate, got ${s.currentRate}`)
})

test("repeated blocks multiplicatively cut a configured host's rate (AIMD)", () => {
  __resetHostRateGate()
  __setHostRateConfig("bar.example.com=8")
  const url = "https://bar.example.com/x"
  reportHostResult(url, 429) // 8 -> 4
  const r1 = __hostGateState(url)!.currentRate
  reportHostResult(url, 429) // 4 -> 2
  const r2 = __hostGateState(url)!.currentRate
  assert.ok(r1 < 8 && r2 < r1, `rate should fall on each block: 8 -> ${r1} -> ${r2}`)
})

test("a success recovers the rate and closes the circuit", () => {
  __resetHostRateGate()
  __setHostRateConfig("baz.example.com=10")
  const url = "https://baz.example.com/x"
  reportHostResult(url, 429, 1_000) // 10 -> 5 at t=1s
  const low = __hostGateState(url)!.currentRate
  // A success well past the recovery interval bumps the rate back up.
  reportHostResult(url, 200, 100_000)
  assert.ok(__hostGateState(url)!.currentRate > low, "rate recovers on success")
  assert.equal(__hostGateState(url)!.consecutiveBlocks, 0, "success resets the block streak")
})

test("circuit opens after the consecutive-block threshold, then gate waits", async () => {
  __resetHostRateGate()
  __setHostRateConfig("waf.example.com=5")
  const url = "https://waf.example.com/x"
  // Default threshold is 5 consecutive blocks.
  for (let i = 0; i < 5; i++) reportHostResult(url, 403)
  assert.equal(__hostGateState(url)!.circuitOpen, true, "circuit trips after the threshold")
  const t0 = Date.now()
  await gateHostRate(url)
  assert.ok(Date.now() - t0 >= 20, "an open circuit makes the next request wait out the cooldown")
})

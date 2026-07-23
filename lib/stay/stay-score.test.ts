import assert from "node:assert/strict"
import { test } from "node:test"
import { computeStayScore } from "./stay-score"

test("cap-exempt overrides everything — lottery-free, high score", () => {
  const r = computeStayScore({ capExempt: true, salary: 70_000, isStem: false })
  assert.equal(r.capExempt, true)
  assert.equal(r.band, "Lottery-free")
  assert.ok(r.score >= 88, `expected >=88, got ${r.score}`)
  assert.equal(r.bars[0].key, "Cap-exempt (no lottery)")
  assert.equal(r.bars[0].value, 100)
})

test("a low-wage cap-subject role beats nothing but is gated by the lottery", () => {
  const r = computeStayScore({
    sponsorsH1b: true,
    sponsorshipScore: 90,
    recentLcaCount: 500,
    salary: 72_000,
    isStem: false,
  })
  assert.equal(r.capExempt, false)
  assert.ok(r.lottery)
  assert.equal(r.lottery!.level, 1)
  // Even a heavy sponsor can't lift a Level-I lottery-bound role to "Strong".
  assert.ok(r.score < 70, `expected lottery-gated <70, got ${r.score}`)
})

test("same heavy sponsor at a higher wage level scores better", () => {
  const low = computeStayScore({ sponsorshipScore: 90, recentLcaCount: 500, salary: 72_000, isStem: true })
  const high = computeStayScore({ sponsorshipScore: 90, recentLcaCount: 500, salary: 150_000, isStem: true })
  assert.ok(high.score > low.score)
})

test("cap-exempt low-wage beats cap-subject low-wage (the core reframe)", () => {
  const capExempt = computeStayScore({ capExempt: true, salary: 70_000, isStem: false })
  const bigSponsor = computeStayScore({ sponsorshipScore: 95, recentLcaCount: 800, salary: 70_000, isStem: false })
  assert.ok(
    capExempt.score > bigSponsor.score,
    `cap-exempt (${capExempt.score}) should beat lottery-bound big sponsor (${bigSponsor.score})`
  )
})

test("no signal → Unrated, neutral, honest verdict", () => {
  const r = computeStayScore({ salary: 90_000, isStem: false })
  assert.equal(r.band, "Unrated")
  assert.equal(r.badgeTone, "neutral")
  assert.match(r.verdict, /unverified|no strong/i)
})

test("tighter clock lowers the score", () => {
  const base = { sponsorshipScore: 80, recentLcaCount: 200, salary: 120_000, isStem: true }
  const roomy = computeStayScore({ ...base, optDaysRemaining: 300 })
  const tight = computeStayScore({ ...base, optDaysRemaining: 20 })
  assert.ok(tight.score < roomy.score)
})

test("every result carries a non-empty disclaimer", () => {
  const r = computeStayScore({ capExempt: true })
  assert.ok(r.disclaimer.length > 0)
  assert.match(r.disclaimer, /not a guarantee|legal advice/i)
})

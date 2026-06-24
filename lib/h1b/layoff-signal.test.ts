import test from "node:test"
import assert from "node:assert/strict"
import { deriveLayoffSignal, type LayoffSignalInput } from "@/lib/h1b/layoff-signal"

const base: LayoffSignalInput = {
  has_active_freeze: false,
  freeze_confidence: null,
  layoff_trend: null,
  events_12mo: 0,
  events_90d: 0,
  workers_affected_12mo: 0,
}

test("active — a layoff event within 90 days", () => {
  assert.equal(deriveLayoffSignal({ ...base, events_90d: 1, events_12mo: 1 }).level, "active")
})

test("active — confirmed hiring freeze", () => {
  assert.equal(
    deriveLayoffSignal({ ...base, has_active_freeze: true, freeze_confidence: "confirmed" }).level,
    "active"
  )
})

test("elevated — 2+ events in 12 months", () => {
  assert.equal(deriveLayoffSignal({ ...base, events_12mo: 2 }).level, "elevated")
})

test("elevated — accelerating trend (real DB value, not 'rising')", () => {
  assert.equal(deriveLayoffSignal({ ...base, layoff_trend: "accelerating" }).level, "elevated")
})

test("elevated — likely freeze", () => {
  assert.equal(
    deriveLayoffSignal({ ...base, has_active_freeze: true, freeze_confidence: "likely" }).level,
    "elevated"
  )
})

test("watching — a single event in 12 months", () => {
  assert.equal(deriveLayoffSignal({ ...base, events_12mo: 1 }).level, "watching")
})

test("watching — possible freeze", () => {
  assert.equal(
    deriveLayoffSignal({ ...base, has_active_freeze: true, freeze_confidence: "possible" }).level,
    "watching"
  )
})

test("stable — no signals", () => {
  assert.equal(deriveLayoffSignal(base).level, "stable")
})

test("edge — 90d event wins over 12mo count (active, not elevated)", () => {
  const s = deriveLayoffSignal({ ...base, events_90d: 1, events_12mo: 5 })
  assert.equal(s.level, "active")
  assert.equal(s.one_liner, "1 layoff event in the last 90 days")
})

test("edge — all nulls/zeros does not crash, returns stable", () => {
  assert.equal(deriveLayoffSignal(base).level, "stable")
})

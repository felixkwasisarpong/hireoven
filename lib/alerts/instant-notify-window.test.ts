import test from "node:test"
import assert from "node:assert/strict"
import {
  instantNotifyWindowMinutes,
  isWithinInstantNotifyWindow,
} from "./instant-notify-window"

test("defaults to 75 minutes when unset or invalid (60-min accumulation + sweep drift buffer)", () => {
  assert.equal(instantNotifyWindowMinutes({}), 75)
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "abc" }), 75)
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "0" }), 75)
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "-5" }), 75)
})

test("honors a valid override and caps at 180", () => {
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "5" }), 5)
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "45" }), 45)
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "9999" }), 180)
})

test("isWithinInstantNotifyWindow rejects stale or invalid postings", () => {
  const nowMs = Date.parse("2026-06-22T12:00:00.000Z")
  assert.equal(
    isWithinInstantNotifyWindow("2026-06-22T11:45:01.000Z", { nowMs, windowMinutes: 15 }),
    true
  )
  assert.equal(
    isWithinInstantNotifyWindow("2026-06-22T11:44:59.000Z", { nowMs, windowMinutes: 15 }),
    false
  )
  assert.equal(isWithinInstantNotifyWindow("not-a-date", { nowMs, windowMinutes: 15 }), false)
})

test("isWithinInstantNotifyWindow allows small future clock skew", () => {
  const nowMs = Date.parse("2026-06-22T12:00:00.000Z")
  assert.equal(
    isWithinInstantNotifyWindow("2026-06-22T12:04:59.000Z", { nowMs, windowMinutes: 20 }),
    true
  )
  assert.equal(
    isWithinInstantNotifyWindow("2026-06-22T12:05:01.000Z", { nowMs, windowMinutes: 20 }),
    false
  )
})

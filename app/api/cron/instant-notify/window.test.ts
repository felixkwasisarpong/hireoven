import test from "node:test"
import assert from "node:assert/strict"
import { instantNotifyWindowMinutes } from "./route"

test("defaults to 20 minutes when unset or invalid", () => {
  assert.equal(instantNotifyWindowMinutes({}), 20)
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "abc" }), 20)
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "0" }), 20)
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "-5" }), 20)
})

test("honors a valid override and caps at 180", () => {
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "5" }), 5)
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "45" }), 45)
  assert.equal(instantNotifyWindowMinutes({ INSTANT_NOTIFY_WINDOW_MIN: "9999" }), 180)
})

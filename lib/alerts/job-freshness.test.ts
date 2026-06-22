import test from "node:test"
import assert from "node:assert/strict"
import {
  notificationFreshnessDate,
  sqlNotificationFreshnessDate,
} from "./job-freshness"

test("notificationFreshnessDate prefers source posted_at over first_detected_at", () => {
  assert.equal(
    notificationFreshnessDate({
      posted_at: "2026-06-20T12:00:00.000Z",
      first_detected_at: "2026-06-22T12:00:00.000Z",
    }),
    "2026-06-20T12:00:00.000Z"
  )
  assert.equal(
    notificationFreshnessDate({ posted_at: null, first_detected_at: "2026-06-22T12:00:00.000Z" }),
    "2026-06-22T12:00:00.000Z"
  )
})

test("sqlNotificationFreshnessDate emits aliased COALESCE expression", () => {
  assert.equal(sqlNotificationFreshnessDate("j"), "COALESCE(j.posted_at, j.first_detected_at)")
})

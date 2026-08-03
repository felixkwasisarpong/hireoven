import assert from "node:assert/strict"
import { test } from "node:test"
import { getBlogDayOfWeek } from "@/lib/blog/queries"

test("getBlogDayOfWeek uses America/Chicago instead of UTC", () => {
  assert.equal(getBlogDayOfWeek(new Date("2026-08-03T04:30:00.000Z")), 0)
  assert.equal(getBlogDayOfWeek(new Date("2026-08-03T05:30:00.000Z")), 1)
})

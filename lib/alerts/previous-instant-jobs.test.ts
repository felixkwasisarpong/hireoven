import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  INSTANT_EMAIL_TARGET_ROWS,
  fetchPreviouslySentInstantJobs,
  slotsFor,
} from "./previous-instant-jobs"

test("slotsFor: a one-job instant email gets padded up to the target", () => {
  assert.equal(slotsFor(1), INSTANT_EMAIL_TARGET_ROWS - 1)
  assert.equal(slotsFor(2), INSTANT_EMAIL_TARGET_ROWS - 2)
})

test("slotsFor: a full email asks for no recap rows", () => {
  assert.equal(slotsFor(INSTANT_EMAIL_TARGET_ROWS), 0)
  assert.equal(slotsFor(INSTANT_EMAIL_TARGET_ROWS + 3), 0)
})

test("slotsFor: never returns a negative count", () => {
  assert.equal(slotsFor(-1), INSTANT_EMAIL_TARGET_ROWS)
})

test("fetchPreviouslySentInstantJobs: short-circuits (no DB hit) when there is no room", async () => {
  const recap = await fetchPreviouslySentInstantJobs({
    userId: "00000000-0000-0000-0000-000000000000",
    notificationType: "alert",
    excludeJobIds: [],
    limit: 0,
  })
  assert.deepEqual(recap.jobs, [])
  assert.equal(recap.scores.size, 0)
})

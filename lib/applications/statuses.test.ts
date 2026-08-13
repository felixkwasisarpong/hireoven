import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  APPLICATION_RESPONSE_STATUSES,
  APPLICATION_TIMING_OUTCOME_STATUSES,
  isApplicationResponseStatus,
  isApplicationTimingOutcomeStatus,
  timingOutcomeGotRecruiterResponse,
} from "@/lib/applications/statuses"

test("application statuses: response stages match canonical ApplicationStatus values", () => {
  assert.deepEqual(APPLICATION_RESPONSE_STATUSES, ["phone_screen", "interview", "final_round", "offer"])
  assert.equal(isApplicationResponseStatus("phone_screen"), true)
  assert.equal(isApplicationResponseStatus("interview"), true)
  assert.equal(isApplicationResponseStatus("final_round"), true)
  assert.equal(isApplicationResponseStatus("offer"), true)
  assert.equal(isApplicationResponseStatus("interviewing"), false)
})

test("application statuses: timing outcomes include canonical response and terminal stages", () => {
  assert.deepEqual(APPLICATION_TIMING_OUTCOME_STATUSES, [
    "phone_screen",
    "interview",
    "final_round",
    "offer",
    "rejected",
    "withdrawn",
  ])
  assert.equal(isApplicationTimingOutcomeStatus("interview"), true)
  assert.equal(isApplicationTimingOutcomeStatus("rejected"), true)
  assert.equal(isApplicationTimingOutcomeStatus("withdrawn"), true)
  assert.equal(isApplicationTimingOutcomeStatus("interviewing"), false)
  assert.equal(isApplicationTimingOutcomeStatus("applied"), false)
})

test("application statuses: recruiter-response timing preserves existing withdrawn semantics", () => {
  assert.equal(timingOutcomeGotRecruiterResponse("phone_screen"), true)
  assert.equal(timingOutcomeGotRecruiterResponse("interview"), true)
  assert.equal(timingOutcomeGotRecruiterResponse("final_round"), true)
  assert.equal(timingOutcomeGotRecruiterResponse("offer"), true)
  assert.equal(timingOutcomeGotRecruiterResponse("rejected"), true)
  assert.equal(timingOutcomeGotRecruiterResponse("withdrawn"), false)
  assert.equal(timingOutcomeGotRecruiterResponse("interviewing"), false)
})

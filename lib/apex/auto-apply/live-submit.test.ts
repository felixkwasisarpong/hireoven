import test from "node:test"
import assert from "node:assert/strict"
import {
  isAutoApplyPostSubmitOutreachAllowed,
  isAutoApplyLiveSubmitAllowed,
  parseAutoApplySubmitAllowlist,
} from "@/lib/apex/auto-apply/live-submit"

test("live submit is off unless the global switch is armed", () => {
  assert.equal(
    isAutoApplyLiveSubmitAllowed(
      { userId: "user-1", email: "felixsarpong25@gmail.com" },
      {
        AUTO_APPLY_ALLOW_SUBMIT: "false",
        AUTO_APPLY_SUBMIT_ALLOWLIST: "felixsarpong25@gmail.com",
      },
    ),
    false,
  )
})

test("live submit is on for eligible users when the allowlist is empty", () => {
  assert.equal(
    isAutoApplyLiveSubmitAllowed(
      { userId: "user-1", email: "felixsarpong25@gmail.com" },
      { AUTO_APPLY_ALLOW_SUBMIT: "true", AUTO_APPLY_SUBMIT_ALLOWLIST: "" },
    ),
    true,
  )
})

test("a non-empty live-submit allowlist restricts by case-insensitive email and user id", () => {
  assert.equal(
    isAutoApplyLiveSubmitAllowed(
      { userId: "user-1", email: "FelixSarpong25@gmail.com" },
      {
        AUTO_APPLY_ALLOW_SUBMIT: "true",
        AUTO_APPLY_SUBMIT_ALLOWLIST: "someone@example.com felixsarpong25@gmail.com",
      },
    ),
    true,
  )

  assert.equal(
    isAutoApplyLiveSubmitAllowed(
      { userId: "USER-3", email: "other@example.com" },
      {
        AUTO_APPLY_ALLOW_SUBMIT: "true",
        AUTO_APPLY_SUBMIT_ALLOWLIST: "user-2",
      },
    ),
    false,
  )
})

test("live submit supports wildcard and common separators", () => {
  assert.deepEqual(
    [...parseAutoApplySubmitAllowlist("a@example.com,b@example.com; c@example.com\nUSER-1")],
    ["a@example.com", "b@example.com", "c@example.com", "user-1"],
  )
  assert.equal(
    isAutoApplyLiveSubmitAllowed(
      { userId: "anyone", email: "anyone@example.com" },
      { AUTO_APPLY_ALLOW_SUBMIT: "true", AUTO_APPLY_SUBMIT_ALLOWLIST: "*" },
    ),
    true,
  )
})

test("post-submit outreach requires its own account allowlist", () => {
  assert.equal(
    isAutoApplyPostSubmitOutreachAllowed(
      { userId: "user-1", email: "felixsarpong25@gmail.com" },
      {
        AUTO_APPLY_POST_SUBMIT_OUTREACH: "true",
        AUTO_APPLY_POST_SUBMIT_OUTREACH_ALLOWLIST: "",
      },
    ),
    false,
  )

  assert.equal(
    isAutoApplyPostSubmitOutreachAllowed(
      { userId: "user-1", email: "felixsarpong25@gmail.com" },
      {
        AUTO_APPLY_POST_SUBMIT_OUTREACH: "true",
        AUTO_APPLY_POST_SUBMIT_OUTREACH_ALLOWLIST: "felixsarpong25@gmail.com",
      },
    ),
    true,
  )

  assert.equal(
    isAutoApplyPostSubmitOutreachAllowed(
      { userId: "user-2", email: "other@example.com" },
      {
        AUTO_APPLY_POST_SUBMIT_OUTREACH: "true",
        AUTO_APPLY_POST_SUBMIT_OUTREACH_ALLOWLIST: "felixsarpong25@gmail.com",
      },
    ),
    false,
  )
})

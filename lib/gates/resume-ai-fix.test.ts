import { strict as assert } from "node:assert"
import { test } from "node:test"
import { canAccess, FEATURE_GATES, requiredPlanFor, type Plan } from "./index"

/**
 * AI Fix is Pro-gated. These pin the two things that are easy to get wrong:
 * that Pro Max inherits it (it is a superset of Pro, not a sibling), and that
 * the free review it sits inside is NOT dragged behind the paywall with it.
 */

test("AI Fix is gated at pro", () => {
  assert.equal(FEATURE_GATES.resume_ai_fix, "pro")
  assert.equal(requiredPlanFor("resume_ai_fix"), "pro")
})

test("pro and pro_max both get AI Fix; free does not", () => {
  const expected: Array<[Plan | null, boolean]> = [
    [null, false],
    ["free", false],
    ["pro", true],
    ["pro_max", true],
  ]
  for (const [plan, allowed] of expected) {
    assert.equal(
      canAccess(plan, "resume_ai_fix"),
      allowed,
      `plan ${plan ?? "signed-out"} should ${allowed ? "" : "not "}have AI Fix`,
    )
  }
})

test("the review itself stays reachable without a paid plan", () => {
  // The diagnosis is the hook. Gating it would leave a free user unable to see
  // what is wrong, which is exactly the information that motivates upgrading.
  assert.equal(FEATURE_GATES.resume_upload, "public")
  assert.equal(canAccess("free", "resume_upload"), true)
})

test("a pro_max user is never worse off than a pro user on any feature", () => {
  for (const feature of Object.keys(FEATURE_GATES) as Array<keyof typeof FEATURE_GATES>) {
    if (canAccess("pro", feature)) {
      assert.equal(canAccess("pro_max", feature), true, `pro_max lost access to ${feature}`)
    }
  }
})

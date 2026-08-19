import assert from "node:assert/strict"
import test from "node:test"
import { renderReferralInvite, type ReferralInviteData } from "./referral-invite"

const base: ReferralInviteData = {
  firstName: "Alex",
  referralUrl: "https://hireoven.com/ref/ABC12345",
  earnedRewards: 0,
  pendingCount: 0,
  referralsUrl: "https://hireoven.com/dashboard/referrals",
  unsubscribeUrl: "https://hireoven.com/unsubscribe?token=t",
  recipientEmail: "alex@example.com",
}

test("states the reward terms the code actually pays out", () => {
  const { html, text } = renderReferralInvite(base)
  // 7 for the friend, 14 for the referrer, 3 max -> 42 total. If lib/referral/
  // rewards.ts changes, this email must not keep promising the old numbers.
  for (const fragment of ["7 days", "14 days", "3 friends", "42 days of Pro"]) {
    assert.ok(html.includes(fragment), `html missing: ${fragment}`)
  }
  assert.ok(text.includes("7 days of Pro free"))
  assert.ok(text.includes("42 days of Pro"))
})

test("a first-time referrer gets the plain ask", () => {
  const r = renderReferralInvite(base)
  assert.equal(r.subject, "Give a friend 7 days of Pro, get 14")
  assert.ok(!r.text.includes("banked"))
})

test("a referrer with an invite in the waiting period is told what is pending", () => {
  const r = renderReferralInvite({ ...base, pendingCount: 2 })
  assert.equal(r.subject, "2 referrals almost cleared")
  assert.ok(r.text.includes("28 days land on your account"))
})

test("a referrer with rewards banked is told how many remain", () => {
  const r = renderReferralInvite({ ...base, earnedRewards: 1 })
  assert.equal(r.subject, "You have 2 referrals left to claim")
  assert.ok(r.text.includes("banked 14 days"))
})

test("the reward condition is stated, not buried", () => {
  // The 14 days land only after the friend's first week. Omitting that turns a
  // delay into a broken promise.
  const r = renderReferralInvite(base)
  assert.ok(r.text.includes("after your friend's first week"))
})

test("renders without a name", () => {
  const r = renderReferralInvite({ ...base, firstName: null })
  assert.ok(!r.text.startsWith(","))
  assert.ok(r.text.startsWith("Hey there,"))
})

test("escapes the name and link", () => {
  const r = renderReferralInvite({ ...base, firstName: '<script>x</script>' })
  assert.ok(!r.html.includes("<script>x</script>"))
})

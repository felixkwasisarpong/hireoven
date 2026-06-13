import test from "node:test"
import assert from "node:assert/strict"
import { shouldSponsorPush, SPONSOR_PUSH_MIN_SCORE } from "@/lib/alerts/sponsor-match"

const base = {
  jobSponsorsH1b: true,
  needsSponsorship: true,
  pushAlerts: true,
  frequency: "instant",
  matchScore: 85,
  alreadyNotified: false,
}

test("fires for a sponsorship-seeker on a fresh sponsor-friendly, well-matched role", () => {
  assert.deepEqual(shouldSponsorPush(base), { send: true, reason: "sponsor_match" })
})

test("never double-sends when the user was already notified this run", () => {
  assert.equal(shouldSponsorPush({ ...base, alreadyNotified: true }).send, false)
})

test("skips non-sponsor-friendly jobs", () => {
  assert.equal(shouldSponsorPush({ ...base, jobSponsorsH1b: false }).reason, "not_sponsor_friendly")
})

test("skips users who don't need sponsorship", () => {
  assert.equal(shouldSponsorPush({ ...base, needsSponsorship: false }).reason, "user_not_sponsorship_seeker")
})

test("respects push toggle and instant frequency", () => {
  assert.equal(shouldSponsorPush({ ...base, pushAlerts: false }).reason, "push_disabled")
  assert.equal(shouldSponsorPush({ ...base, frequency: "daily" }).reason, "not_instant")
})

test("gates on match score but still sends when there's no score at all", () => {
  assert.equal(shouldSponsorPush({ ...base, matchScore: SPONSOR_PUSH_MIN_SCORE - 1 }).send, false)
  assert.deepEqual(shouldSponsorPush({ ...base, matchScore: null }), { send: true, reason: "sponsor_match_no_score" })
})

import { strict as assert } from "node:assert"
import { test } from "node:test"
import { detectPostingSponsorshipBlocker, postingExcludesSponsorship } from "./posting-sponsorship-blocker"

// Verbatim from live postings in the job index. Jack Henry & Associates files
// LCAs and scores 91% at the employer level while carrying these on active
// engineering roles — the exact case where an employer-level check says "yes"
// and the listing says "no".
const JACK_HENRY_A = "This position is not eligible for immigration sponsorship and support."
const JACK_HENRY_B = "This position is ineligible for immigration sponsorship and support."

test("a posting-level bar is detected even though the employer sponsors", () => {
  for (const text of [JACK_HENRY_A, JACK_HENRY_B]) {
    const blocker = detectPostingSponsorshipBlocker(text)
    assert.ok(blocker, `no blocker for: ${text}`)
    assert.equal(blocker.detected, true)
    assert.equal(blocker.severity, "high")
    assert.equal(blocker.kind, "no_sponsorship_statement")
    assert.equal(blocker.source, "job_description")
    assert.ok(postingExcludesSponsorship(text))
  }
})

test("the blocker quotes the sentence, so the claim can be checked", () => {
  const blocker = detectPostingSponsorshipBlocker(
    `We are hiring a backend engineer. ${JACK_HENRY_A} Apply today.`,
  )
  assert.equal(blocker?.evidence.length, 1)
  assert.match(blocker!.evidence[0], /ineligible|not eligible/i)
  assert.ok(!blocker!.evidence[0].includes("Apply today"), "evidence is the sentence, not the posting")
})

test("unrestricted right to work is a blocker", () => {
  const blocker = detectPostingSponsorshipBlocker(
    "Applicants must have unrestricted right to work in the United States.",
  )
  assert.equal(blocker?.kind, "requires_unrestricted_work_authorization")
  assert.equal(blocker?.severity, "high")
})

test("citizenship and clearance requirements are blockers", () => {
  assert.equal(
    detectPostingSponsorshipBlocker("Applicants must be U.S. citizens.")?.kind,
    "citizenship_or_clearance_required",
  )
  assert.equal(
    detectPostingSponsorshipBlocker("An active TS/SCI security clearance is required.")?.kind,
    "citizenship_or_clearance_required",
  )
})

// ── The inversion must not be created in the other direction ────────────────

test("the ordinary I-9 line is NOT a blocker", () => {
  // An F-1 OPT holder is authorized to work. Treating this as a bar would hide
  // every sponsoring employer that states the legal minimum.
  for (const text of [
    "Candidates must be authorized to work in the US.",
    "All applicants must be legally authorized to work in the United States.",
  ]) {
    assert.equal(detectPostingSponsorshipBlocker(text), null, `wrongly blocked: ${text}`)
    assert.equal(postingExcludesSponsorship(text), false)
  }
})

test("a posting that offers sponsorship is never inverted into a blocker", () => {
  for (const text of [
    "Visa sponsorship is available for this role.",
    "We will sponsor qualified candidates for H-1B.",
    "This employer offers visa sponsorship.",
  ]) {
    assert.equal(detectPostingSponsorshipBlocker(text), null, `wrongly blocked: ${text}`)
  }
})

test("the commercial and mentorship senses of sponsor are ignored", () => {
  for (const text of [
    "You will mentor, coach, and sponsor a team of 4-6 engineers.",
    "Own sponsorship integrations and advertiser relationships.",
  ]) {
    assert.equal(detectPostingSponsorshipBlocker(text), null, `wrongly blocked: ${text}`)
  }
})

test("a future-only bar is flagged but not treated as an immediate exclusion", () => {
  const blocker = detectPostingSponsorshipBlocker(
    "We are unable to provide sponsorship in the future for this position.",
  )
  assert.ok(blocker)
  assert.equal(blocker.severity, "medium", "survivable now, fatal at the H-1B step")
  assert.equal(postingExcludesSponsorship("We are unable to provide sponsorship in the future."), false)
})

test("empty and missing descriptions produce no blocker", () => {
  assert.equal(detectPostingSponsorshipBlocker(null), null)
  assert.equal(detectPostingSponsorshipBlocker(undefined), null)
  assert.equal(detectPostingSponsorshipBlocker("   "), null)
  assert.equal(detectPostingSponsorshipBlocker("A normal posting with no authorization language."), null)
})

test("evidence stays readable when a posting has no sentence punctuation", () => {
  // Bullet-list postings can collapse into one run-on "sentence"; quoting it
  // whole would bury the clause that matters.
  const runOn = `${"Responsibilities include building services ".repeat(60)} This position is ineligible for immigration sponsorship`
  const blocker = detectPostingSponsorshipBlocker(runOn)
  assert.ok(blocker)
  assert.ok(blocker.evidence[0].length <= 320, `excerpt was ${blocker.evidence[0].length} chars`)
})

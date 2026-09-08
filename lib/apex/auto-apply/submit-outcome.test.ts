import test from "node:test"
import assert from "node:assert/strict"
import { classifySubmitOutcome } from "./fill-runner"
import { describeUnconfirmedSubmit } from "./worker"

const AT = "https://jobs.ashbyhq.com/acme/abc/application"

function outcome(over: Partial<Parameters<typeof classifySubmitOutcome>[0]> = {}) {
  return classifySubmitOutcome({
    clicked: true, urlBefore: AT, urlAfter: AT, pageText: "Application form", ...over,
  })
}

test("no submit control found is not a submission", () => {
  assert.equal(outcome({ clicked: false }), "not_clicked")
})

test("a receipt on the page confirms the submission", () => {
  for (const text of [
    "Thank you for applying! We will be in touch.",
    "Your application has been submitted.",
    "We have received your application",
    "Application received",
    "Successfully submitted",
  ]) {
    assert.equal(outcome({ pageText: text }), "confirmed", text)
  }
})

test("navigating to a different document confirms the submission", () => {
  assert.equal(outcome({ urlAfter: "https://jobs.ashbyhq.com/acme/abc/success" }), "confirmed")
})

test("a fragment-only URL change does not confirm anything", () => {
  // JazzHR's submit is an <a href="#">, so a click that failed validation still
  // moves the URL to ".../Role#". Reading that as success is the original lie.
  assert.equal(outcome({ urlBefore: "https://x.applytojob.com/apply/Role", urlAfter: "https://x.applytojob.com/apply/Role#" }), "unconfirmed")
})

test("a click with no receipt and no navigation is unconfirmed, not failed", () => {
  // The distinction this whole change exists for: four real applications were
  // filed as plain failures because this case had no separate verdict.
  assert.equal(outcome({ pageText: "Please correct the errors below" }), "unconfirmed")
})

test("job-description boilerplate does not pass for a receipt", () => {
  assert.equal(
    outcome({ pageText: "Thank you for your interest in Acme. We review every application." }),
    "unconfirmed",
  )
})

test("the unconfirmed record carries enough evidence to adjudicate later", () => {
  const desc = describeUnconfirmedSubmit({
    label: "Submit Application",
    urlBefore: AT,
    urlAfter: AT,
    pageText: "Please correct the errors below",
  })
  assert.match(desc, /^submit_unconfirmed /)
  assert.match(desc, /clicked="Submit Application"/)
  assert.match(desc, /navigated=no/)
  assert.match(desc, /Please correct the errors below/)
})

test("evidence records a real navigation as such", () => {
  const desc = describeUnconfirmedSubmit({
    label: "Submit", urlBefore: AT, urlAfter: `${AT}/done`, pageText: null,
  })
  assert.match(desc, /navigated=yes/)
})

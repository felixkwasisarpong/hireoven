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

test("a click that leaves no trace at all is unconfirmed, not failed", () => {
  // The distinction this whole change exists for: four real applications were
  // filed as plain failures because this case had no separate verdict. A page
  // that says nothing either way is the only case that stays genuinely unknown.
  assert.equal(outcome({ pageText: "Careers at Acme. Engineering. Sales." }), "unconfirmed")
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

test("a validation message is a definite 'nothing was sent'", () => {
  // The exact text BambooHR showed while the run recorded four applications as
  // merely unverifiable.
  for (const text of [
    "State * –Select– Please make a selection. ZIP * Country *",
    "Website, Blog or Portfolio Invalid website URL.",
    "This field is required",
    "Please correct the errors below",
    "Enter a valid email address",
  ]) {
    assert.equal(outcome({ pageText: text }), "rejected", text)
  }
})

test("a receipt still wins over stray validation wording", () => {
  assert.equal(
    outcome({ pageText: "Thank you for applying. Some fields are required for future roles." }),
    "confirmed",
  )
})

test("a job description mentioning requirements is not a rejection", () => {
  assert.equal(
    outcome({ pageText: "About the role. 3-5 years of production experience with Flutter." }),
    "unconfirmed",
  )
})

import test from "node:test"
import assert from "node:assert/strict"
import {
  isSentinelValue, isAnswered, isRefusalText, isUsableAnswer,
  shouldFillFromProfile, shouldSpendEffortOn, classifyWorkAuthQuestion, answerWorkAuth, identityAnswer,
} from "./answer-policy"
import type { AutofillProfile } from "@/types"

// The exact value the audit found in 14 of 126 filled fields.
test("JazzHR's unselected-dropdown sentinel is not an answer", () => {
  assert.equal(isSentinelValue("resumator_no_selection"), true)
  assert.equal(isAnswered("resumator_no_selection"), false)
  for (const v of ["-- Select --", "Please select", "Select one", "N/A", "  ", ""]) {
    assert.equal(isAnswered(v), false, v)
  }
})

test("real answers are answers", () => {
  for (const v of ["Yes", "No", "F-1 OPT", "Felix", "3 years", "0"]) {
    assert.equal(isAnswered(v), true, v)
  }
})

test("model refusals are never usable as form input", () => {
  // Verbatim from the audit — this reached a Name field.
  for (const a of [
    "I cannot provide your name as it is not included in the résumé provided. Please provide your full name to answer this question.",
    "I don't have a name listed in the provided résumé.",
    "I don't see your name in the résumé provided.",
    "I'm sorry, I can't answer that.",
    "As an AI, I do not have access to that.",
    "The résumé does not mention any such experience.",
    "",
  ]) {
    assert.equal(isUsableAnswer(a), false, a.slice(0, 40))
  }
})

test("normal answers pass the refusal filter", () => {
  for (const a of [
    "Yes",
    "3 years",
    "I led the migration of a payments monolith to event-driven services.",
    "I am targeting a base salary starting around $120,000.",
  ]) {
    assert.equal(isUsableAnswer(a), true, a.slice(0, 40))
  }
})

test("anything the profile answers gets filled, required or not", () => {
  // An optional LinkedIn field left blank is a worse application for no gain,
  // so the deterministic pass does not care whether a field is required.
  assert.equal(shouldFillFromProfile({ value: "" }), true)
  assert.equal(shouldFillFromProfile({ value: "resumator_no_selection" }), true)
  assert.equal(shouldFillFromProfile({ value: "Felix" }), false)
})

test("effort — an LLM call, or a question put to the user — is required-only", () => {
  // An optional question we cannot answer does not block submission, so
  // chasing it would spend money and the user's attention for nothing.
  assert.equal(shouldSpendEffortOn({ required: false, value: "" }), false)
  assert.equal(shouldSpendEffortOn({ required: true, value: "" }), true)
  assert.equal(shouldSpendEffortOn({ required: true, value: "resumator_no_selection" }), true)
  assert.equal(shouldSpendEffortOn({ required: true, value: "Yes" }), false)
})

test("the two rules pull opposite ways on the same optional field", () => {
  const optionalUnknown = { required: false, value: "" }
  assert.equal(shouldFillFromProfile(optionalUnknown), true)   // fill if we know it
  assert.equal(shouldSpendEffortOn(optionalUnknown), false)    // never chase it
})

test("the three work-auth phrasings are told apart", () => {
  assert.equal(classifyWorkAuthQuestion("Are you legally authorized to work in the United States?"), "authorized_now")
  assert.equal(classifyWorkAuthQuestion("Do you currently require sponsorship?"), "sponsorship_now")
  assert.equal(
    classifyWorkAuthQuestion("Will you now or in the future require sponsorship for employment visa status?"),
    "sponsorship_future",
  )
  assert.equal(classifyWorkAuthQuestion("What is your current immigration status in the US?"), "status")
  assert.equal(classifyWorkAuthQuestion("What is your favourite programming language?"), null)
})

test("an unqualified sponsorship question is read as future tense", () => {
  // "No" here while later needing H-1B is a false statement; "Yes" is merely
  // conservative. The asymmetry decides the default.
  assert.equal(classifyWorkAuthQuestion("Do you require sponsorship?"), "sponsorship_future")
})

const OPT = {
  authorized_to_work: true,
  requires_sponsorship: true,
  work_authorization: "opt",
} as unknown as AutofillProfile

test("someone on OPT is authorized now, needs nothing now, but will need H-1B", () => {
  assert.deepEqual(answerWorkAuth(OPT, "authorized_now"), { value: "Yes", grounded: true })
  assert.deepEqual(answerWorkAuth(OPT, "sponsorship_now"), { value: "No", grounded: true })
  // The load-bearing one: answering "No" here would be untrue.
  assert.deepEqual(answerWorkAuth(OPT, "sponsorship_future"), { value: "Yes", grounded: true })
  assert.deepEqual(answerWorkAuth(OPT, "status"), { value: "F-1 OPT", grounded: true })
})

test("a citizen needs no sponsorship in either tense", () => {
  const citizen = {
    authorized_to_work: true, requires_sponsorship: false, work_authorization: "citizen",
  } as unknown as AutofillProfile
  assert.deepEqual(answerWorkAuth(citizen, "authorized_now"), { value: "Yes", grounded: true })
  assert.deepEqual(answerWorkAuth(citizen, "sponsorship_now"), { value: "No", grounded: true })
  assert.deepEqual(answerWorkAuth(citizen, "sponsorship_future"), { value: "No", grounded: true })
})

test("someone needing sponsorship outright says so in both tenses", () => {
  const needs = {
    authorized_to_work: false, requires_sponsorship: true, work_authorization: "require_sponsorship",
  } as unknown as AutofillProfile
  assert.deepEqual(answerWorkAuth(needs, "authorized_now"), { value: "No", grounded: true })
  assert.deepEqual(answerWorkAuth(needs, "sponsorship_now"), { value: "Yes", grounded: true })
  assert.deepEqual(answerWorkAuth(needs, "sponsorship_future"), { value: "Yes", grounded: true })
})

test("an ungrounded profile answers nothing rather than guessing", () => {
  const blank = {
    authorized_to_work: null, requires_sponsorship: null, work_authorization: null,
  } as unknown as AutofillProfile
  for (const q of ["authorized_now", "sponsorship_future", "status"] as const) {
    assert.equal(answerWorkAuth(blank, q), null, q)
  }
})

test("identity fields are answered from the profile, never by a model", () => {
  const p = {
    first_name: "Felix", last_name: "Kwasi Sarpong",
    email: "felix@example.com", phone: "(605) 555-0123",
  } as unknown as AutofillProfile
  // The exact label that produced a refusal in the audit.
  assert.equal(identityAnswer(p, "Name"), "Felix Kwasi Sarpong")
  assert.equal(identityAnswer(p, "Full name✱"), "Felix Kwasi Sarpong")
  assert.equal(identityAnswer(p, "First Name*"), "Felix")
  assert.equal(identityAnswer(p, "Last Name*"), "Kwasi Sarpong")
  assert.equal(identityAnswer(p, "Email Address*"), "felix@example.com")
  assert.equal(identityAnswer(p, "Phone*"), "(605) 555-0123")
  assert.equal(identityAnswer(p, "Why do you want this role?"), null)
})

test("an identity field with nothing in the profile stays blank", () => {
  const empty = { first_name: null, last_name: null, email: null, phone: null } as unknown as AutofillProfile
  assert.equal(identityAnswer(empty, "Name"), null)
})

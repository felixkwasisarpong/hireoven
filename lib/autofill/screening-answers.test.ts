import test from "node:test"
import assert from "node:assert/strict"
import {
  normalizeQuestionKey, isScreeningQuestion, isCompanySpecific,
} from "./screening-answers"

test("phrasing differences collapse to one key", () => {
  const variants = [
    "Are you 18 years old or older?*",
    "are you 18 years old or older",
    "Are you 18 years old or older? (required)",
    "  Are you 18 years old or older?  ",
  ]
  assert.equal(new Set(variants.map(normalizeQuestionKey)).size, 1)
})

test("questions the structured profile already owns are excluded", () => {
  // Re-asking for a name or email would be a worse onboarding than no
  // onboarding, and answer-policy already grounds these.
  for (const q of ["First Name*", "Email Address", "LinkedIn Profile URL:", "Phone", "City", "Resume"]) {
    assert.equal(isScreeningQuestion(q), false, q)
  }
})

test("legal declarations are left to the work-auth policy, not the store", () => {
  for (const q of [
    "Are you legally authorized to work in the United States?",
    "Will you now or in the future require sponsorship?",
    "What is your current immigration status?",
  ]) {
    assert.equal(isScreeningQuestion(q), false, q)
  }
})

test("the questions that actually blocked coverage are screening questions", () => {
  // Taken verbatim from the fields the measurement left blank.
  for (const q of [
    "Are you 18 years old or older?",
    "Are you living in the United States at present?",
    "Are you currently a full-time student?",
    "What matters most to you in how you work?",
    "Can you work weekends?",
  ]) {
    assert.equal(isScreeningQuestion(q), true, q)
  }
})

test("employer-specific questions are recognised so they are never reused elsewhere", () => {
  // Answering "no" for Acme must not answer for Globex.
  for (const q of [
    "Have you previously been employed by Upstream Rehabilitation?",
    "Do you have any relatives who are currently employed by Upstream?",
    "Have you ever worked for us?",
  ]) {
    assert.equal(isCompanySpecific(q), true, q)
  }
})

test("general questions are not treated as employer-specific", () => {
  for (const q of [
    "Are you 18 years old or older?",
    "Can you work weekends?",
    "Are you willing to relocate?",
  ]) {
    assert.equal(isCompanySpecific(q), false, q)
  }
})

test("an empty or trivial question is not stored", () => {
  for (const q of ["", "   ", "*", "ok"]) {
    assert.equal(isScreeningQuestion(q), false, JSON.stringify(q))
  }
})

test("profile-owned scheduling and pay fields are not screening questions", () => {
  // These showed up in a captured backlog even though FIELD_MAPPINGS already
  // covers them — asking the user again would be re-collecting what we hold.
  for (const q of [
    "Earliest start date?*",
    "Notice: What is your notice period?",
    "Desired salary*",
    "Are you willing to relocate?*",
  ]) {
    assert.equal(isScreeningQuestion(q), false, q)
  }
})

test("placeholder text is not treated as a question", () => {
  // "Type your response" is a textarea placeholder; it appeared 5 times in one
  // run and would have been put to the user as if it were a real question.
  for (const q of ["Type your response", "Your answer", "Please specify", "Other", "Comments"]) {
    assert.equal(isScreeningQuestion(q), false, q)
  }
})

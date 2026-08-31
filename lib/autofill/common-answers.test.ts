import test from "node:test"
import assert from "node:assert/strict"
import { answerCommonQuestion, isInternship } from "./common-answers"
import type { AutofillProfile } from "@/types"

const ctx = (over: Partial<{ jobTitle: string; employmentType: string }> = {}) => ({
  profile: { first_name: "Felix" } as unknown as AutofillProfile,
  jobTitle: over.jobTitle ?? "Senior Software Engineer",
  employmentType: over.employmentType ?? "fulltime",
})

test("prior-employment, relatives and referral questions answer No", () => {
  // All four appeared in a real captured backlog, each scoped to a different
  // employer, and all take the same answer.
  for (const q of [
    "Have you previously been employed by Upstream Rehabilitation or its affiliates?",
    "Do you have any relatives who are currently employed by Upstream?",
    "Are you being referred by a current co-worker whom you have known for 6 months?",
    "Were you previously employed with Geotab?*",
    "Do you currently work for a partner or reseller of Geotab?*",
  ]) {
    assert.deepEqual(answerCommonQuestion(q, ctx()), { kind: "answer", value: "No" }, q)
  }
})

test("how-did-you-hear is always LinkedIn", () => {
  for (const q of [
    "How did you hear about this job opportunity?*",
    "How did you hear about Geotab?*",
    "Where did you find this role?",
  ]) {
    assert.deepEqual(answerCommonQuestion(q, ctx()), { kind: "answer", value: "LinkedIn" }, q)
  }
})

test("preferred name comes from the profile, not a model", () => {
  assert.deepEqual(answerCommonQuestion("Preferred Name?*", ctx()), { kind: "answer", value: "Felix" })
})

test("preferred name with no first name in the profile is left alone", () => {
  const bare = { profile: { first_name: null } as unknown as AutofillProfile }
  assert.equal(answerCommonQuestion("Preferred Name?*", bare), null)
})

test("full-time student flips on internships", () => {
  // Answering No on an internship is usually self-disqualifying; answering Yes
  // on a regular role would be untrue.
  assert.deepEqual(
    answerCommonQuestion("Are you currently a full-time student?*", ctx({ jobTitle: "Software Engineering Intern" })),
    { kind: "answer", value: "Yes" },
  )
  assert.deepEqual(
    answerCommonQuestion("Are you currently a full-time student?*", ctx()),
    { kind: "answer", value: "No" },
  )
})

test("internship detection covers the usual titles", () => {
  for (const t of ["Software Engineering Intern", "2027 Summer Internship", "Engineering Co-op", "Summer Analyst"]) {
    assert.equal(isInternship({ profile: {} as AutofillProfile, jobTitle: t }), true, t)
  }
  for (const t of ["Senior Software Engineer", "Internal Tools Engineer"]) {
    assert.equal(isInternship({ profile: {} as AutofillProfile, jobTitle: t }), false, t)
  }
})

test("a request for reference contact details disqualifies the form", () => {
  // Third parties have not agreed to have their name and phone number sent.
  const r = answerCommonQuestion("References: Please enter names and contact information:*", ctx())
  assert.equal(r?.kind, "disqualify")
})

test("reference requests are not mistaken for open-ended questions", () => {
  // REFERENCES is tested first on purpose; a generic fallback would answer it.
  const r = answerCommonQuestion("Please provide references with contact information", ctx())
  assert.equal(r?.kind, "disqualify")
})

test("work-environment questions get a plain answer", () => {
  const r = answerCommonQuestion("The kind of environment you do your best work in:*", ctx())
  assert.equal(r?.kind, "answer")
  assert.match((r as { value: string }).value, /friendly/i)
})

test("role-specific questions are left for the user", () => {
  // These never stop appearing and cannot be answered by rule.
  for (const q of [
    "Are you currently a Licensed Physical Therapist?",
    "Do you have any experience with house flipping or wholesaling?",
    "Do you have 4+ years of sales experience?*",
  ]) {
    assert.equal(answerCommonQuestion(q, ctx()), null, q)
  }
})

const withLoc = () => ({
  profile: { first_name: "Felix" } as unknown as AutofillProfile,
  jobTitle: "Senior Software Engineer",
  city: "Lubbock", state: "TX",
})

test("a location typeahead is answered from the profile despite its error text", () => {
  // Verbatim label from a real form — the widget's own error message is part of
  // the label, which is why a plain /city|location/ match missed it. This was
  // the single most common unanswered field.
  const r = answerCommonQuestion(
    "Current location ✱No location found. Try entering a different location", withLoc())
  assert.deepEqual(r, { kind: "answer", value: "Lubbock, TX" })
  assert.deepEqual(answerCommonQuestion("City*", withLoc()), { kind: "answer", value: "Lubbock, TX" })
})

test("relocation questions are not mistaken for location questions", () => {
  // "Are you willing to relocate" asks something else entirely; answering it
  // with a city would be nonsense.
  assert.equal(answerCommonQuestion("Are you willing to relocate?*", withLoc()), null)
})

test("non-compete and post-employment restrictions are the same question", () => {
  for (const q of [
    "Do you have a non-compete in place with your previous or current employer?",
    "Are there any post-employment restrictions from your current employer?",
    "Are you subject to a restrictive covenant?",
  ]) {
    assert.deepEqual(answerCommonQuestion(q, withLoc()), { kind: "answer", value: "No" }, q)
  }
})

test("voluntary self-identification is declined, never inferred", () => {
  for (const q of [
    "What pronouns should we use to refer to you?*",
    "What are your personal pronouns? *",
    "Sexual Orientation*",
    "Gender identity",
  ]) {
    assert.deepEqual(answerCommonQuestion(q, withLoc()), { kind: "answer", value: "Prefer not to say" }, q)
  }
})

test("accommodation questions default to No rather than disclosing", () => {
  assert.deepEqual(
    answerCommonQuestion("Do you require reasonable accommodations or adjustments?*", withLoc()),
    { kind: "answer", value: "No" })
})

test("wider prior-relationship phrasings are caught", () => {
  for (const q of [
    "Are you related to, or in a close personal relationship with, anyone who works here?",
    "Have you ever been hired through Remote as a third party?*",
  ]) {
    assert.deepEqual(answerCommonQuestion(q, withLoc()), { kind: "answer", value: "No" }, q)
  }
})

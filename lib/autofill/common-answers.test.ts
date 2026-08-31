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

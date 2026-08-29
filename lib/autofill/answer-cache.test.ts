import test from "node:test"
import assert from "node:assert/strict"
import {
  answerCacheKey,
  isJobSpecificQuestion,
  normalizeQuestion,
} from "./answer-cache"

test("normalizeQuestion collapses the surface variation forms actually produce", () => {
  const variants = [
    "Years of experience with React*",
    "years of experience with react",
    "Years of Experience with React (required)",
    "  Years of experience with React?  ",
  ]
  const normalized = variants.map(normalizeQuestion)
  assert.equal(new Set(normalized).size, 1, `expected one form, got ${JSON.stringify(normalized)}`)
})

test("questions about a specific employer are job-specific", () => {
  for (const q of [
    "Why do you want to work here?",
    "Why this role?",
    "What attracts you to our company?",
    "Why are you interested in this position?",
    "How did you hear about us?",
  ]) {
    assert.equal(isJobSpecificQuestion(q), true, q)
  }
})

test("stable personal facts are generic and reusable across employers", () => {
  for (const q of [
    "How many years of experience do you have with Python?",
    "What is your notice period?",
    "Are you willing to relocate?",
    "What are your salary expectations?",
    "Earliest start date?",
  ]) {
    assert.equal(isJobSpecificQuestion(q), false, q)
  }
})

test("work-authorization phrasing stays generic even when it says 'us'", () => {
  // "authorized to work for us" trips the \bus\b job-specific rule, but the
  // answer is a fixed legal fact — caching it per job would be pure waste.
  for (const q of [
    "Are you authorized to work for us in the United States?",
    "Will you now or in the future require sponsorship from us?",
    "Do you have a valid work visa?",
  ]) {
    assert.equal(isJobSpecificQuestion(q), false, q)
  }
})

test("a job-specific question is scoped to its job, so it cannot leak across employers", () => {
  const q = "Why do you want to work here?"
  const atAcme = answerCacheKey({ question: q, jobScope: "job-acme" })
  const atGlobex = answerCacheKey({ question: q, jobScope: "job-globex" })
  assert.ok(atAcme && atGlobex)
  assert.notEqual(atAcme, atGlobex)
})

test("a generic question shares one key regardless of job", () => {
  const q = "How many years of experience do you have with Python?"
  assert.equal(
    answerCacheKey({ question: q, jobScope: "job-acme" }),
    answerCacheKey({ question: q, jobScope: "job-globex" }),
  )
})

test("a job-specific question with no job id is uncacheable rather than global", () => {
  // Failing closed matters more than the saved call: without a scope there is
  // nothing preventing an Acme-specific answer being sent to Globex.
  assert.equal(answerCacheKey({ question: "Why this company?", jobScope: null }), null)
})

test("an empty question yields no key", () => {
  assert.equal(answerCacheKey({ question: "   *  ", jobScope: "job-1" }), null)
})

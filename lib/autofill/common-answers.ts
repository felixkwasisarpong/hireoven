/**
 * Answers that follow a rule rather than a stored fact.
 *
 * Distinct from the screening store, which holds one user's personal answers.
 * These are structural: either derivable from the profile, or a policy that
 * holds for any applicant using auto-apply. Encoding them here means they never
 * reach the user as a question and never cost an LLM call.
 *
 * One of them is not an answer at all — a form asking for reference contact
 * details disqualifies itself, because submitting real people's names and phone
 * numbers without asking them first is not ours to do automatically.
 */

import type { AutofillProfile } from "@/types"

export type CommonAnswer =
  | { kind: "answer"; value: string }
  /** Do not submit this form; hand it back to the user. */
  | { kind: "disqualify"; reason: string }
  | null

export type AnswerContext = {
  profile: Pick<AutofillProfile, "first_name">
  jobTitle?: string | null
  employmentType?: string | null
}

/**
 * Prior-employment, relatives and referral questions.
 *
 * Answered "No" because auto-apply targets employers the user has not applied
 * to, so a prior relationship is the rare exception. It IS a factual assertion
 * though: a user who genuinely worked there would be stating something untrue,
 * so a stored personal answer overrides this and always wins.
 */
const PRIOR_RELATIONSHIP =
  /\b(previously|ever|formerly)\b.*\b(employed|worked)\b|\brelatives?\b.*\bemploy|\bfamily member\b.*\bemploy|\breferred by\b|\bwork(ed)? (for|at) (us|our)\b|\bcurrent(ly)? employed (by|with)\b|\bpartner or reseller\b/i

const HOW_DID_YOU_HEAR = /how did you (hear|find|learn)|where did you (hear|find)|referral source|source of application/i

const PREFERRED_NAME = /preferred name|what should we call you|nickname|goes by/i

/** Reference details belong to third parties who have not consented. */
const REFERENCES = /\breferences?\b.*(name|contact|phone|email|information)|please (enter|provide|list).*references/i

const WORK_ENVIRONMENT =
  /kind of environment|type of environment|environment (you|where you).*(best|thrive)|work environment.*prefer|ideal work environment/i

const FULL_TIME_STUDENT = /full[- ]time student|currently a student|enrolled (as a )?(full[- ]time )?student/i

/**
 * Internships are the one context where "are you a full-time student" flips.
 * Most internships require current enrolment, so answering No there is usually
 * self-disqualifying, while answering Yes on a regular role is untrue.
 */
export function isInternship(ctx: AnswerContext): boolean {
  const t = `${ctx.jobTitle ?? ""} ${ctx.employmentType ?? ""}`.toLowerCase()
  return /\bintern(ship)?\b|\bco-?op\b|\bsummer analyst\b/.test(t)
}

export function answerCommonQuestion(question: string, ctx: AnswerContext): CommonAnswer {
  const q = question.replace(/\s+/g, " ").trim()
  if (!q) return null

  // Checked before the others: a reference request is not answerable at all,
  // and must not be mistaken for a general open-ended question.
  if (REFERENCES.test(q)) {
    return { kind: "disqualify", reason: "asks for third-party reference contact details" }
  }

  if (PRIOR_RELATIONSHIP.test(q)) return { kind: "answer", value: "No" }
  if (HOW_DID_YOU_HEAR.test(q)) return { kind: "answer", value: "LinkedIn" }

  if (PREFERRED_NAME.test(q)) {
    const first = (ctx.profile.first_name ?? "").trim()
    return first ? { kind: "answer", value: first } : null
  }

  if (FULL_TIME_STUDENT.test(q)) {
    return { kind: "answer", value: isInternship(ctx) ? "Yes" : "No" }
  }

  if (WORK_ENVIRONMENT.test(q)) {
    return { kind: "answer", value: "A friendly, collaborative environment where people help each other." }
  }

  return null
}

/**
 * Answers to the screening questions a résumé cannot supply.
 *
 * Coverage stalled at 71.8% with 71 required fields blank, and porting more
 * browser automation moved it by nothing. The blocked fields were "Are you 18
 * years old or older?", "Are you living in the United States at present?",
 * "Have you previously been employed by X" — an information problem, not a
 * mechanism one.
 *
 * So the same store is both a cache and a backlog. A row with a null answer is
 * a question we hit and could not answer, which is precisely the list worth
 * asking the user once. Answer it once and every later application reuses it,
 * which is the difference between an onboarding cost and a recurring one.
 */

import { getPostgresPool } from "@/lib/postgres/server"

/** Questions the structured profile already owns — never re-ask these. */
const PROFILE_OWNED =
  /\b(first name|last name|full name|^name$|e-?mail|phone|mobile|linkedin|github|portfolio|website|street|address|^city$|state|province|zip|postal|country|resume|cv|cover letter|earliest (start|available)|start date|notice period|salary (expectation|requirement)|desired salary|willing to relocate|years of experience)\b/i

/**
 * Placeholder text a control exposes when it has no real label. "Type your
 * response" is the textarea's own placeholder, not a question, and it appeared
 * five times in one run — asking the user that would be nonsense.
 */
const NOT_A_QUESTION =
  /^(type your response|your (answer|response)|enter (your )?(answer|response|text)|answer|response|comments?|other|please specify|n\/?a)$/i

/**
 * Consent and disclosure notices. These are acknowledgement checkboxes an
 * applicant ticks, not questions with answers — putting "Privacy notice" to a
 * user as though it were a question is nonsense, and a legal acknowledgement is
 * theirs to give on the form, not something to pre-store.
 */
const LEGAL_NOTICE =
  /(privacy|cookie|data protection)\s*(notice|policy|statement)|notice at collection|terms (and|&) conditions|e-?verify (notice|poster)|i (agree|consent|acknowledge)\b|acknowledgement\b|by selecting ["']?yes["']?, i am certifying|i certify that/i

/** Legal declarations answered by answer-policy from the profile, not here. */
const POLICY_OWNED = /authoriz|sponsor|visa|immigration|work permit|right to work/i

/**
 * Company-specific questions must never be reused at another employer.
 * "Have you previously been employed by Acme" has no bearing on Globex.
 */
const COMPANY_SPECIFIC =
  /\b(previously|ever) (been )?(employed|worked)\b|\brelatives?\b.*\bemployed\b|\bwork(ed)? (for|at) (us|our)\b|\bcurrent(ly)? employed by\b|\breferred by\b/i

export function isCompanySpecific(question: string): boolean {
  return COMPANY_SPECIFIC.test(question)
}

/** Whether this question belongs in the screening store at all. */
export function isScreeningQuestion(question: string): boolean {
  const q = question.trim()
  if (q.length < 4) return false
  if (NOT_A_QUESTION.test(q.replace(/[*✱:]/g, "").trim())) return false
  if (LEGAL_NOTICE.test(q)) return false
  if (PROFILE_OWNED.test(q)) return false
  if (POLICY_OWNED.test(q)) return false
  return true
}

/**
 * Collapse phrasing differences so the same question asked three ways shares
 * one row. Required markers and trailing punctuation carry no meaning.
 */
export function normalizeQuestionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/\(\s*(required|optional)\s*\)/g, " ")
    .replace(/[*✱]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 200)
}

export type ScreeningLookup = {
  userId: string
  question: string
  /** Company name, used only for questions that are specific to one employer. */
  company?: string | null
}

/** A stored answer, or null when we have not been told yet. */
export async function getScreeningAnswer(args: ScreeningLookup): Promise<string | null> {
  const key = normalizeQuestionKey(args.question)
  if (!key || !isScreeningQuestion(args.question)) return null
  const scope = isCompanySpecific(args.question) ? (args.company ?? "") : ""

  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ answer: string | null }>(
      `UPDATE user_screening_answers
          -- Only an ANSWERED row is bumped here. Counting misses too meant
          -- every encounter incremented twice — once on this lookup and once in
          -- recordUnansweredQuestion — so "asked on 36 applications" was about
          -- double the truth and kept growing when nothing new had happened.
          SET times_seen = CASE WHEN answer IS NOT NULL THEN times_seen + 1 ELSE times_seen END,
              last_seen_at = CASE WHEN answer IS NOT NULL THEN now() ELSE last_seen_at END
        WHERE user_id = $1 AND question_key = $2 AND COALESCE(company_scope, '') = $3
        RETURNING answer`,
      [args.userId, key, scope],
    )
    return rows[0]?.answer ?? null
  } catch {
    // A store we cannot read must never block an application; the field is
    // simply left for the human.
    return null
  }
}

/**
 * Record a question we could not answer.
 *
 * Deliberately stores no answer. Guessing here is how an application ends up
 * asserting something untrue about the applicant, so the field stays blank and
 * the question joins the list to put to the user.
 */
export async function recordUnansweredQuestion(args: ScreeningLookup & {
  options?: string[] | null
}): Promise<void> {
  const key = normalizeQuestionKey(args.question)
  if (!key || !isScreeningQuestion(args.question)) return
  const scope = isCompanySpecific(args.question) ? (args.company ?? "") : ""

  try {
    const pool = getPostgresPool()
    await pool.query(
      `INSERT INTO user_screening_answers
         (user_id, question_key, question_text, answer, options, company_scope)
       VALUES ($1, $2, $3, NULL, $4::jsonb, NULLIF($5, ''))
       ON CONFLICT (user_id, question_key, COALESCE(company_scope, ''))
       DO UPDATE SET times_seen = user_screening_answers.times_seen + 1,
                     last_seen_at = now(),
                     -- Keep the option list fresh, but never overwrite an
                     -- answer the user has already given.
                     options = COALESCE(EXCLUDED.options, user_screening_answers.options)`,
      [args.userId, key, args.question.slice(0, 500),
       args.options ? JSON.stringify(args.options.slice(0, 30)) : null, scope],
    )
  } catch {
    // Best effort: a lost record costs one future prompt, nothing more.
  }
}

export type PendingQuestion = {
  id: string
  questionText: string
  options: string[] | null
  companyScope: string | null
  timesSeen: number
}

/**
 * The questions worth asking this user, most frequently encountered first —
 * so the first few answers unblock the most applications.
 */
export async function getPendingQuestions(userId: string, limit = 20): Promise<PendingQuestion[]> {
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{
      id: string; question_text: string; options: string[] | null
      company_scope: string | null; times_seen: number
    }>(
      `SELECT id, question_text, options, company_scope, times_seen
         FROM user_screening_answers
        WHERE user_id = $1 AND answer IS NULL AND skipped_at IS NULL
        ORDER BY times_seen DESC, last_seen_at DESC
        LIMIT $2`,
      [userId, limit],
    )
    return rows.map((r) => ({
      id: r.id,
      questionText: r.question_text,
      options: r.options,
      companyScope: r.company_scope,
      timesSeen: r.times_seen,
    }))
  } catch {
    return []
  }
}

export async function saveScreeningAnswer(
  userId: string, id: string, answer: string,
): Promise<boolean> {
  try {
    const pool = getPostgresPool()
    const { rowCount } = await pool.query(
      `UPDATE user_screening_answers
          SET answer = $3, answered_at = now()
        WHERE id = $2 AND user_id = $1`,
      [userId, id, answer.slice(0, 2000)],
    )
    return (rowCount ?? 0) > 0
  } catch {
    return false
  }
}


/**
 * True when the user has declined this question outright.
 *
 * A form requiring it can never be completed, so there is no point spending
 * LLM calls on its other fields or a browser slot on the attempt — with a
 * nightly cap of five, attempting it costs a real application, not just time.
 */
export async function isSkippedQuestion(args: ScreeningLookup): Promise<boolean> {
  const key = normalizeQuestionKey(args.question)
  if (!key) return false
  const scope = isCompanySpecific(args.question) ? (args.company ?? "") : ""
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ skipped: boolean }>(
      `SELECT skipped_at IS NOT NULL AS skipped
         FROM user_screening_answers
        WHERE user_id = $1 AND question_key = $2 AND COALESCE(company_scope, '') = $3`,
      [args.userId, key, scope],
    )
    return rows[0]?.skipped === true
  } catch {
    return false
  }
}

/** Decline a question for good. */
export async function skipScreeningQuestion(userId: string, id: string): Promise<boolean> {
  try {
    const pool = getPostgresPool()
    const { rowCount } = await pool.query(
      `UPDATE user_screening_answers
          SET skipped_at = now()
        WHERE id = $2 AND user_id = $1`,
      [userId, id],
    )
    return (rowCount ?? 0) > 0
  } catch {
    return false
  }
}

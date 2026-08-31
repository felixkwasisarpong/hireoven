/**
 * What may be written into an application form, and what must never be.
 *
 * Every rule here exists because the pre-launch audit caught the opposite
 * behaviour going out under a real person's name.
 */

import type { AutofillProfile } from "@/types"

// ── 1. Sentinel values are EMPTY, not answered ───────────────────────────────

/**
 * ATS "nothing selected" placeholders.
 *
 * JazzHR writes `resumator_no_selection` into an untouched dropdown. Because
 * that is a non-empty string, coverage metrics scored it as answered — 14 of
 * 126 audited values were this, including "What is your current immigration
 * status?" and "Are you living in the United States at present?". A form is not
 * complete because a placeholder is present.
 */
const SENTINEL_VALUES = [
  /^resumator_no_selection$/i,
  /^no_selection$/i,
  /^-+\s*select/i,
  /^please\s+select/i,
  /^select\s+(one|an?\s+option|\.\.\.)?$/i,
  /^choose\s+one$/i,
  /^n\/?a$/i,
  /^\s*$/,
]

export function isSentinelValue(value: string | null | undefined): boolean {
  const v = (value ?? "").trim()
  return SENTINEL_VALUES.some((re) => re.test(v))
}

/** A field counts as answered only if it holds something a human would accept. */
export function isAnswered(value: string | null | undefined): boolean {
  return !isSentinelValue(value)
}

// ── 2. A model's refusal must never reach a form ─────────────────────────────

/**
 * Text where the model is talking to the operator rather than answering.
 *
 * The audit found "I cannot provide your name as it is not included in the
 * résumé provided. Please provide your full name..." typed into a Name field.
 * The model behaved correctly — the context genuinely lacked a name — and the
 * pipeline submitted the refusal because nothing checked.
 */
const REFUSAL_PATTERNS = [
  /\bi (?:cannot|can't|can not|am unable to|don'?t have|do not have)\b/i,
  /\bi(?:'m| am) sorry\b/i,
  /\bas an ai\b/i,
  /\bnot (?:included|provided|present|available|specified) in the (?:r[ée]sum[ée]|profile|context|information)\b/i,
  /\bi don'?t see\b/i,
  /\bplease provide\b/i,
  /\b(?:the )?r[ée]sum[ée] (?:does not|doesn'?t) (?:include|contain|mention)\b/i,
  /\bcould you (?:please )?(?:provide|clarify|specify)\b/i,
]

export function isRefusalText(answer: string | null | undefined): boolean {
  const a = (answer ?? "").trim()
  if (!a) return true
  return REFUSAL_PATTERNS.some((re) => re.test(a))
}

/** An answer is safe to type only if it answers rather than deflects. */
export function isUsableAnswer(answer: string | null | undefined): boolean {
  return !isRefusalText(answer)
}

// ── 3. Cheap fills are always worth it; effort is reserved for required ─────

/**
 * Fill anything the profile already answers, required or not.
 *
 * Writing a value we already hold costs nothing and can only help: an optional
 * LinkedIn or phone field left blank is a worse application for no gain. This
 * is the deterministic pass (generateFillScript), which matches profile data to
 * fields by label and does not care whether the field is required.
 */
export function shouldFillFromProfile(field: { value?: string | null }): boolean {
  return !isAnswered(field.value)
}

/**
 * Only spend effort on required fields.
 *
 * "Effort" is anything with a cost or a consequence: an LLM call, capturing a
 * question to put to the user later, or abandoning a form as incomplete. An
 * optional question we cannot answer from the profile is simply skipped — it
 * does not block submission, so chasing it would burn money and the user's
 * attention for nothing.
 *
 * The distinction matters because the two rules pull in opposite directions on
 * the same field: an optional field gets filled if we know the answer, and
 * ignored entirely if we do not.
 */
export function shouldSpendEffortOn(field: { required: boolean; value?: string | null }): boolean {
  if (!field.required) return false
  return !isAnswered(field.value)
}

// ── 4. Work authorization is answered from the profile, never by a model ─────

export type WorkAuthQuestion =
  /** "Are you legally authorized to work in the US?" */
  | "authorized_now"
  /** "Do you currently require sponsorship?" */
  | "sponsorship_now"
  /** "Will you now OR IN THE FUTURE require sponsorship?" */
  | "sponsorship_future"
  /** "Do you require a visa?" / immigration status — free text, not yes/no */
  | "status"

/**
 * The three phrasings are NOT interchangeable, and conflating them is how an
 * application ends up containing a false statement.
 *
 * Someone on OPT is authorized to work today and needs no sponsorship today,
 * but will need H-1B later. "No" to the future-tense question is untrue for
 * them and can void an offer, so the future phrasing is detected first: it is
 * the most common wording on US forms and the most costly to get wrong.
 */
export function classifyWorkAuthQuestion(label: string): WorkAuthQuestion | null {
  const l = label.toLowerCase()
  if (!/authoriz|sponsor|visa|immigration|work permit|right to work|employment eligib/i.test(l)) {
    return null
  }
  // Future-tense first — "now or in the future" also contains "now".
  if (/\bfuture\b|\bever\b|\bnow or\b|at any (?:point|time)|will you (?:require|need)|going forward|long[- ]term/.test(l)) {
    return "sponsorship_future"
  }
  if (/sponsor/.test(l)) {
    return /current|now|today|presently|at (?:this|the) (?:time|moment)/.test(l)
      ? "sponsorship_now"
      // An unqualified "Do you require sponsorship?" is read as the future form.
      // Answering "No" and later needing H-1B is the damaging error; answering
      // "Yes" and not needing it is merely conservative.
      : "sponsorship_future"
  }
  if (/immigration status|visa (?:type|status)|what is your (?:current )?status/.test(l)) {
    return "status"
  }
  if (/authoriz|right to work|work permit|employment eligib|legally (?:able|entitled)/.test(l)) {
    return "authorized_now"
  }
  return null
}

export type WorkAuthAnswer = { value: string; grounded: true } | null

/**
 * Answer a work-authorization question from the profile alone.
 *
 * Returns null when the profile cannot ground the answer, so the caller leaves
 * the field for the human rather than guessing. These are legal declarations;
 * an incorrect one is not a bad user experience, it is a false statement on an
 * employment application.
 */
export function answerWorkAuth(
  profile: Pick<AutofillProfile, "authorized_to_work" | "requires_sponsorship" | "work_authorization">,
  question: WorkAuthQuestion,
): WorkAuthAnswer {
  const authorizedNow = profile.authorized_to_work
  const needsSponsorshipEventually = profile.requires_sponsorship
  const status = (profile.work_authorization ?? "").toLowerCase()

  switch (question) {
    case "authorized_now":
      if (authorizedNow === null || authorizedNow === undefined) return null
      return { value: authorizedNow ? "Yes" : "No", grounded: true }

    case "sponsorship_now":
      // OPT, STEM OPT, CPT and similar are authorization in their own right:
      // the holder needs nothing from the employer today.
      if (authorizedNow === true && /opt|cpt|ead|h1b|h-1b|green|citizen|permanent/.test(status)) {
        return { value: "No", grounded: true }
      }
      if (needsSponsorshipEventually === true && authorizedNow !== true) {
        return { value: "Yes", grounded: true }
      }
      if (authorizedNow === true) return { value: "No", grounded: true }
      return null

    case "sponsorship_future":
      if (needsSponsorshipEventually === null || needsSponsorshipEventually === undefined) return null
      return { value: needsSponsorshipEventually ? "Yes" : "No", grounded: true }

    case "status":
      // Free text — only answer if the profile actually carries a status.
      if (!status) return null
      return { value: humanStatus(status), grounded: true }
  }
}

function humanStatus(status: string): string {
  const map: Record<string, string> = {
    opt: "F-1 OPT",
    stem_opt: "F-1 STEM OPT",
    cpt: "F-1 CPT",
    h1b: "H-1B",
    "h-1b": "H-1B",
    green_card: "Permanent Resident",
    citizen: "U.S. Citizen",
    require_sponsorship: "Requires sponsorship",
  }
  return map[status] ?? status.replace(/_/g, " ")
}

// ── 5. Identity comes from the profile, never from a model ───────────────────

/**
 * Fields that state who the applicant is.
 *
 * The audit found a Name field containing "I cannot provide your name as it is
 * not included in the résumé provided..." — the model was asked a question only
 * the profile can answer. Single-field "Name" (Ashby, Lever) has no direct
 * mapping in FIELD_MAPPINGS, which is how it fell through to the model at all.
 * Identity is never inferred: it is looked up or left blank.
 */
export function identityAnswer(
  profile: Pick<AutofillProfile, "first_name" | "last_name" | "email" | "phone">,
  label: string,
): string | null {
  const l = label.toLowerCase().replace(/[*✱]/g, "").trim()
  const first = (profile.first_name ?? "").trim()
  const last = (profile.last_name ?? "").trim()
  const full = [first, last].filter(Boolean).join(" ")

  if (/^(full[\s_-]?name|name|your name|legal name|applicant name)\b/.test(l)) {
    return full || null
  }
  if (/first[\s_-]?name|given[\s_-]?name|forename/.test(l)) return first || null
  if (/last[\s_-]?name|surname|family[\s_-]?name/.test(l)) return last || null
  if (/e-?mail/.test(l)) return (profile.email ?? "").trim() || null
  if (/phone|mobile|telephone|cell/.test(l)) return (profile.phone ?? "").trim() || null
  return null
}

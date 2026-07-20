/**
 * Shared visa / work-authorization logic used by every autofill adapter
 * (Workday, Greenhouse, Ashby, Lever, Workable, …) so sponsorship and
 * work-authorization questions are answered consistently everywhere.
 */

/**
 * Temporary statuses whose holders are CURRENTLY authorized to work in the US
 * without new employer action. Per the applicant's intent, these answer:
 *   • "require sponsorship?"      → No
 *   • "legally authorized?"       → Yes
 * Covers OPT / STEM OPT / CPT / H-1B / F-1 (EAD) / TN / L-1 / O-1, plus
 * permanent statuses (green card / permanent resident) that likewise need no
 * sponsorship.
 */
const CURRENTLY_AUTHORIZED_VISA =
  /\b(opt|stem\s*opt|cpt|h-?1-?b|f-?1|ead|tn(?:\s*visa|\s*status)?|l-?1|o-?1|green\s*card|permanent\s*resident|advance\s*parole|employment\s*authoriz)\b/i

/** True when the free-text work-authorization status is a currently-authorized visa. */
export function isCurrentlyAuthorizedVisa(workAuthorization?: string | null): boolean {
  return CURRENTLY_AUTHORIZED_VISA.test((workAuthorization ?? "").toLowerCase())
}

export type WorkAuthInputs = {
  workAuthorization?: string | null
  requiresSponsorship?: boolean | null
  authorizedToWork?: boolean | null
}

/**
 * Resolve a sponsorship / work-authorization question to yes/no, or null when
 * the question isn't one of these (so callers fall through to other logic).
 */
export function workAuthAnswer(question: string, p: WorkAuthInputs): "yes" | "no" | null {
  const q = (question ?? "").toLowerCase()
  const authorized = isCurrentlyAuthorizedVisa(p.workAuthorization)

  const isSponsorship =
    q.includes("sponsor") &&
    (q.includes("require") || q.includes("need") || q.includes("visa") || q.includes("immigration") || q.includes("sponsorship"))
  if (isSponsorship) {
    // "Are you able to work WITHOUT sponsorship?" / "…without requiring sponsorship?"
    // (common on BambooHR/iCIMS) is the INVERSE of "do you require sponsorship?":
    // an applicant who needs no sponsorship must answer YES here, not No. Flip the
    // whole decision tree when the question is negatively phrased.
    const inverse = /\bwithout\b[^?.!]{0,40}\bsponsor/.test(q)
    const needsSponsorship = (): "yes" | "no" => (inverse ? "no" : "yes")
    const noSponsorship = (): "yes" | "no" => (inverse ? "yes" : "no")
    if (authorized) return noSponsorship()
    // An applicant already authorized to work needs no NEW sponsorship — per the
    // product rule, OPT/STEM OPT/H-1B/authorized applicants answer "No" here even
    // if their profile also flags a future-sponsorship intent.
    if (p.authorizedToWork === true) return noSponsorship()
    if (p.requiresSponsorship === true) return needsSponsorship()
    if (p.requiresSponsorship === false) return noSponsorship()
    return null
  }

  const isAuthorization =
    /authoriz|authoris|eligible (?:to work|for employment)|employment eligibility|right to work|legally (able|entitled|permitted)/.test(q)
  if (isAuthorization) {
    if (authorized) return "yes"
    if (p.authorizedToWork === true) return "yes"
    if (p.authorizedToWork === false) return "no"
    return null
  }

  return null
}

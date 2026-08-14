/**
 * Posting assessability — is there enough of a job here to judge at all?
 *
 * Evaluated before decision sufficiency, because "we found no conflict" is a
 * worthless reassurance when there was nothing to find a conflict in. Three
 * live rows drove this: a 337-character description with no duties, a captured
 * department page titled "engineering and product", and a posting dated 5,084
 * days old. All three returned APPLY_NOW purely because nothing contradicted
 * them.
 *
 * Deliberately NOT character count or age. Length is a proxy for structure and
 * a bad one — a tight, well-formed posting can be short, and a long one can be
 * boilerplate. Age is a proxy for liveness and a worse one, because the corrupt
 * timestamps in this corpus sit on rows that are otherwise fine. What matters
 * is whether the row carries the things a job posting has: a specific title, a
 * way to apply, duties, requirements, and freshness evidence we can trust.
 */

export type PostingAssessability =
  | "ASSESSABLE"
  | "THIN_BUT_ASSESSABLE"
  | "NOT_A_JOB_POSTING"
  | "INSUFFICIENT_JOB_CONTENT"
  | "CORRUPT_TIMING_DATA"
  | "UNKNOWN"

/** Beyond this, a posting date is not plausible and must not be used. */
export const IMPLAUSIBLE_POSTING_AGE_DAYS = 5_000

export type AssessabilityInput = {
  title: string | null | undefined
  description: string | null | undefined
  applyUrl: string | null | undefined
  externalId: string | null | undefined
  ageDays: number | null
  /** Independent liveness evidence, used to rescue a corrupt age. */
  applyUrlStatus: "ok" | "dead" | "redirect" | "unknown"
  lastSeenAt: string | null
  lastSeenAtTrustworthy: boolean
  now: string
}

export type AssessabilityVerdict = {
  state: PostingAssessability
  /** Every input the verdict was derived from, for the decision trace. */
  inputs: Record<string, string | number | boolean | null>
  /** Why, in the candidate's terms. */
  explanation: string
  /** True when the decision table must stop and return INSUFFICIENT_DATA. */
  blocksDecision: boolean
}

/** Titles that name a section of a careers site rather than a role. */
const NAVIGATION_TITLE_RE =
  /^(?:engineering(?:\s*(?:and|&)\s*product)?|product(?:\s*(?:and|&)\s*design)?|design|sales|marketing|operations|people|all (?:jobs|roles|openings)|open (?:roles|positions)|careers?|departments?|teams?|other)$/i

/** A real role title carries a role noun. */
const ROLE_NOUN_RE =
  /\b(?:engineer|developer|scientist|analyst|manager|designer|architect|administrator|specialist|consultant|technician|lead|director|officer|nurse|accountant|recruiter|marketer|writer|researcher|intern|associate|representative|coordinator|strategist|counsel|attorney|therapist|pharmacist|instructor|professor|teacher)\b/i

const DUTY_RE =
  /\b(?:you will|you'll|responsibilities|what you'll do|in this role|day[- ]to[- ]day|design|build|develop|implement|maintain|own|lead|deliver|collaborate|partner with|drive|support|operate|analyz|architect)\b/i

const REQUIREMENT_RE =
  /\b(?:requirements?|qualifications?|you have|we're looking for|must have|minimum|required|experience with|proficien|familiar with|degree in|years of experience|bachelor|master)\b/i

function countMatches(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)
  return (text.match(global) ?? []).length
}

export function assessPosting(input: AssessabilityInput): AssessabilityVerdict {
  const title = (input.title ?? "").trim()
  const description = (input.description ?? "").replace(/\s+/g, " ").trim()
  const applyUrl = (input.applyUrl ?? "").trim()

  const hasTitle = title.length > 0
  const titleIsNavigation = hasTitle && NAVIGATION_TITLE_RE.test(title)
  const titleHasRoleNoun = hasTitle && ROLE_NOUN_RE.test(title)
  const dutyCount = description ? countMatches(description, DUTY_RE) : 0
  const requirementCount = description ? countMatches(description, REQUIREMENT_RE) : 0
  const hasApplyRoute = applyUrl.length > 0
  const hasRequisition = Boolean((input.externalId ?? "").trim())

  // Independent liveness evidence that can rescue an implausible date.
  const lastSeenDays =
    input.lastSeenAtTrustworthy && input.lastSeenAt
      ? Math.floor((Date.parse(input.now) - Date.parse(input.lastSeenAt)) / 86_400_000)
      : null
  const recentlyConfirmedLive =
    input.applyUrlStatus === "ok" || (lastSeenDays !== null && Number.isFinite(lastSeenDays) && lastSeenDays <= 30)

  const inputs: Record<string, string | number | boolean | null> = {
    hasTitle,
    titleIsNavigation,
    titleHasRoleNoun,
    dutyCount,
    requirementCount,
    hasApplyRoute,
    hasRequisition,
    descriptionLength: description.length,
    ageDays: input.ageDays,
    ageImplausible: input.ageDays !== null && input.ageDays > IMPLAUSIBLE_POSTING_AGE_DAYS,
    applyUrlStatus: input.applyUrlStatus,
    lastSeenDays,
    lastSeenAtTrustworthy: input.lastSeenAtTrustworthy,
    recentlyConfirmedLive,
  }

  const verdict = (
    state: PostingAssessability,
    explanation: string,
    blocksDecision: boolean,
  ): AssessabilityVerdict => ({ state, inputs, explanation, blocksDecision })

  if (!hasTitle && !description) {
    return verdict("UNKNOWN", "We could not read this posting.", true)
  }

  // A careers-site section captured as a job. The title names a department and
  // nothing role-specific follows it.
  if (titleIsNavigation && !titleHasRoleNoun && requirementCount === 0 && !hasRequisition) {
    return verdict(
      "NOT_A_JOB_POSTING",
      `"${title}" names a section of a careers site rather than a role, and the record carries no requisition or role-specific requirements.`,
      true,
    )
  }

  // Implausible age, checked before content so a corrupt date is never read as
  // closure. Rescued when something independent says it is live.
  if (input.ageDays !== null && input.ageDays > IMPLAUSIBLE_POSTING_AGE_DAYS) {
    if (!recentlyConfirmedLive) {
      return verdict(
        "CORRUPT_TIMING_DATA",
        `This posting is dated ${input.ageDays} days old, which is not plausible, and nothing independent confirms it is still live. That is a data problem on our side, not evidence the role is closed.`,
        true,
      )
    }
    // Age is corrupt but liveness is independently evidenced — carry on and
    // simply refuse to use the date.
  }

  // Nothing to extract requirements from.
  if (dutyCount === 0 && requirementCount === 0) {
    return verdict(
      "INSUFFICIENT_JOB_CONTENT",
      "This posting lists no responsibilities or requirements we could read, so there is nothing to assess you against.",
      true,
    )
  }

  const thin = dutyCount < 2 || requirementCount < 2 || !hasApplyRoute

  if (thin) {
    // Thin but usable: a specific title, some duties and requirements, and a
    // route to apply. Length is explicitly not the test.
    if (titleHasRoleNoun && dutyCount >= 2 && requirementCount >= 2 && hasApplyRoute) {
      return verdict("THIN_BUT_ASSESSABLE", "This posting is brief but names the role, its duties and its requirements.", false)
    }
    if (dutyCount >= 1 && requirementCount >= 1 && hasApplyRoute && titleHasRoleNoun) {
      return verdict("THIN_BUT_ASSESSABLE", "This posting is brief, but there is enough to work with.", false)
    }
    return verdict(
      "INSUFFICIENT_JOB_CONTENT",
      "This posting does not carry enough role-specific detail to assess — we could not find both duties and requirements for it.",
      true,
    )
  }

  return verdict("ASSESSABLE", "This posting carries a role title, duties and requirements.", false)
}

/**
 * Career track — individual contributor versus people management.
 *
 * `RoleFamily` in the matcher is a *domain* classifier: it separates tech from
 * healthcare from finance. It has no notion of track, so an Engineering Manager
 * and a backend engineer both classify as `tech` and look perfectly compatible.
 * That is why the Sentry evaluation reached the right answer for the wrong
 * reason — it skipped an engineering-management posting on a low career-fit
 * score, with nothing in the output able to say "this is a management role and
 * your history is individual-contributor".
 *
 * Track is orthogonal to domain, so it lives here rather than being bolted onto
 * the matcher, and it is used only to supply a *structural* corroboration that
 * X-Ray can point at.
 *
 * Deliberately conservative in both directions:
 *   - A management title alone never establishes incompatibility. It takes a
 *     management posting AND an absence of management evidence in the résumé.
 *   - "Lead" is not treated as management. "Tech Lead" and "Lead Engineer" are
 *     overwhelmingly senior-IC titles, and reading them as management would
 *     misfire on exactly the senior engineers most likely to apply.
 */

export type CareerTrack = "individual_contributor" | "people_management" | "unknown"

/** Titles that denote running a team, not being senior on one. */
const MANAGEMENT_TITLE_RE =
  /\b(?:engineering manager|software engineering manager|development manager|manager,|manager\b|head of|director of|director,|director\b|vp\b|vice president|chief\b)/i

/** Titles that look managerial but are conventionally senior-IC. */
const IC_TITLE_OVERRIDE_RE =
  /\b(?:tech(?:nical)? lead|lead engineer|lead developer|lead software|team lead|staff engineer|principal engineer|architect)\b/i

/** Duties that only a people manager owns. Requires an explicit report/team
 *  object so "manage the deployment pipeline" does not qualify. */
const MANAGEMENT_DUTY_RE =
  /\b(?:manage|managing|lead|leading|coach|coaching|mentor|mentoring|grow|growing|hire|hiring|develop)\b[^.]{0,60}\b(?:a\s+)?(?:team|teams|squad|group|engineers|developers|direct reports?|reports?|staff|people)\b|\b(?:direct reports?|people manag\w+|performance review|headcount|hiring plan|career development|1:1s|one-on-ones)\b/i

/**
 * Track a posting is hiring for. Title is the strong signal; duties confirm.
 */
export function detectPostingTrack(input: {
  title: string | null | undefined
  description: string | null | undefined
}): { track: CareerTrack; evidence: string | null } {
  const title = (input.title ?? "").trim()
  const description = (input.description ?? "").trim()

  if (title && IC_TITLE_OVERRIDE_RE.test(title)) {
    return { track: "individual_contributor", evidence: `Title "${title}" is a senior individual-contributor title.` }
  }
  if (title && MANAGEMENT_TITLE_RE.test(title)) {
    return { track: "people_management", evidence: `Title "${title}" names a people-management role.` }
  }
  // A non-management title with heavy management duties is still management,
  // but require the duties to be explicit about people.
  if (description && MANAGEMENT_DUTY_RE.test(description) && /\b(?:direct reports?|people manag\w+|performance review|headcount)\b/i.test(description)) {
    return { track: "people_management", evidence: "Description lists people-management duties." }
  }
  if (!title && !description) return { track: "unknown", evidence: null }
  return { track: "individual_contributor", evidence: null }
}

/**
 * Whether the résumé shows management experience. Absence here is "we did not
 * find it", and on its own it proves nothing — it is only meaningful paired
 * with a management posting.
 */
export function detectCandidateManagementEvidence(input: {
  titles: Array<string | null | undefined>
  experienceText: string | null | undefined
}): { hasEvidence: boolean; evidence: string | null } {
  for (const raw of input.titles) {
    const title = (raw ?? "").trim()
    if (!title) continue
    if (IC_TITLE_OVERRIDE_RE.test(title)) continue
    if (MANAGEMENT_TITLE_RE.test(title)) {
      return { hasEvidence: true, evidence: `Held the title "${title}".` }
    }
  }
  const text = input.experienceText ?? ""
  if (text && /\b(?:direct reports?|managed a team|led a team|people manag\w+|performance review|hiring plan|headcount)\b/i.test(text)) {
    return { hasEvidence: true, evidence: "Experience describes managing or leading a team." }
  }
  return { hasEvidence: false, evidence: null }
}

/**
 * Structural track incompatibility: a people-management posting against a
 * résumé with no management evidence we could find.
 *
 * Returns null whenever either side is unknown, so an unreadable résumé or an
 * untitled posting can never manufacture an incompatibility.
 */
export function detectTrackIncompatibility(input: {
  postingTitle: string | null | undefined
  postingDescription: string | null | undefined
  candidateTitles: Array<string | null | undefined>
  candidateExperienceText: string | null | undefined
  candidateDataReadable: boolean
}): { incompatible: boolean; explanation: string } | null {
  if (!input.candidateDataReadable) return null

  const posting = detectPostingTrack({ title: input.postingTitle, description: input.postingDescription })
  if (posting.track !== "people_management") return null

  const candidate = detectCandidateManagementEvidence({
    titles: input.candidateTitles,
    experienceText: input.candidateExperienceText,
  })
  if (candidate.hasEvidence) {
    return {
      incompatible: false,
      explanation: `This is a people-management role, and your history supports it. ${candidate.evidence ?? ""}`.trim(),
    }
  }
  return {
    incompatible: true,
    explanation:
      `This is a people-management role — ${posting.evidence ?? "the posting describes running a team"} — ` +
      "and we could not find management experience in your résumé. That is a different track from the " +
      "individual-contributor work your history shows, not a gap in skill.",
  }
}

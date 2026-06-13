/**
 * Visa-aware instant push.
 *
 * Hireoven's edge is "apply first," and the sharpest expression of that is
 * pinging a sponsorship-seeker the *second* a fresh sponsor-friendly role drops
 * — without them having to hand-build an alert for it. This is the pure decision
 * core; the webhook does the bounded fan-out and the sender delivers.
 */

/** Below this per-user match score we don't fire a sponsor-match push. */
export const SPONSOR_PUSH_MIN_SCORE = 70

export type SponsorPushInput = {
  jobSponsorsH1b: boolean | null
  needsSponsorship: boolean | null
  pushAlerts: boolean | null
  frequency: string | null
  /** Per-user match score 0..100, or null when the user has no scorable resume. */
  matchScore: number | null
  /** True if this user was already notified about this job in this run. */
  alreadyNotified: boolean
  minScore?: number
}

export type SponsorPushDecision = { send: boolean; reason: string }

export function shouldSponsorPush(input: SponsorPushInput): SponsorPushDecision {
  const minScore = input.minScore ?? SPONSOR_PUSH_MIN_SCORE

  if (input.alreadyNotified) return { send: false, reason: "already_notified" }
  if (!input.jobSponsorsH1b) return { send: false, reason: "not_sponsor_friendly" }
  if (!input.needsSponsorship) return { send: false, reason: "user_not_sponsorship_seeker" }
  if (!input.pushAlerts) return { send: false, reason: "push_disabled" }
  if (input.frequency !== "instant") return { send: false, reason: "not_instant" }

  // No resume → no score. A fresh sponsor-friendly role is still worth the ping,
  // so we send rather than silently drop the highest-intent users.
  if (input.matchScore == null) return { send: true, reason: "sponsor_match_no_score" }
  if (input.matchScore < minScore) return { send: false, reason: "below_score" }

  return { send: true, reason: "sponsor_match" }
}

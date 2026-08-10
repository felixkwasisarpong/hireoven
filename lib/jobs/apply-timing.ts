/**
 * Apply-timing from post age — the pure half of the timing engine.
 *
 * A posting's screen rate decays sharply with age: the first 24–48h are the hot
 * window. Because this is a pure function of first_detected_at, it can drive a
 * per-card urgency badge with ZERO db cost, and lib/apex/timing/timing-engine
 * reuses it for the post-age half of computeJobTiming (the day/hour window
 * overlay stays server-side). Single source of truth — keep both on this.
 */

export type TimingRecommendation = "apply_now" | "schedule_today" | "schedule_tomorrow" | "low_priority"

export interface ApplyTiming {
  hoursSincePosted: number
  recommendation: TimingRecommendation
  screenRateMultiplier: number
  reason: string
}

export function computeApplyTimingFromPostAge(
  firstDetectedAt: string | null | undefined,
  now: Date = new Date(),
): ApplyTiming {
  const hoursSincePosted = firstDetectedAt
    ? Math.floor((now.getTime() - new Date(firstDetectedAt).getTime()) / 3_600_000)
    : 9999

  if (hoursSincePosted <= 24) {
    return {
      hoursSincePosted,
      recommendation: "apply_now",
      screenRateMultiplier: 3.1,
      reason: `Posted ${hoursSincePosted} hour${hoursSincePosted === 1 ? "" : "s"} ago. Applications in the first 24 hours have a 3.1× higher screen rate.`,
    }
  }
  if (hoursSincePosted <= 48) {
    return {
      hoursSincePosted,
      recommendation: "apply_now",
      screenRateMultiplier: 2.4,
      reason: "Still in the early window. Apply before day 3 for best results.",
    }
  }
  if (hoursSincePosted <= 72) {
    return {
      hoursSincePosted,
      recommendation: "schedule_today",
      screenRateMultiplier: 1.8,
      reason: "Past the peak window. Still worth applying today.",
    }
  }
  if (hoursSincePosted <= 168) {
    return {
      hoursSincePosted,
      recommendation: "schedule_tomorrow",
      screenRateMultiplier: 1.0,
      reason: "Post is a few days old. Schedule for the best time slot.",
    }
  }
  const days = Math.floor(hoursSincePosted / 24)
  return {
    hoursSincePosted,
    recommendation: "low_priority",
    screenRateMultiplier: 0.7,
    reason: `Post is ${days} day${days === 1 ? "" : "s"} old. Focus on fresher postings first.`,
  }
}

export interface ApplyTimingBadge {
  /** Short call to action for the card, e.g. "Apply now" / "Apply within 4 days". */
  label: string
  /** Supporting detail, e.g. "3.1× screen rate". */
  detail: string
  tone: "hot" | "warm" | "cool"
  multiplier: number
}

/**
 * Compact card-badge view of apply-timing. Returns null once the post is old
 * enough that urgency is moot (low_priority) — no "too late" clutter on cards.
 */
export function applyTimingBadge(
  firstDetectedAt: string | null | undefined,
  now: Date = new Date(),
): ApplyTimingBadge | null {
  const t = computeApplyTimingFromPostAge(firstDetectedAt, now)
  switch (t.recommendation) {
    case "apply_now":
      return { label: "Apply now", detail: `${t.screenRateMultiplier}× screen rate`, tone: "hot", multiplier: t.screenRateMultiplier }
    case "schedule_today":
      return { label: "Apply today", detail: `${t.screenRateMultiplier}× screen rate`, tone: "warm", multiplier: t.screenRateMultiplier }
    case "schedule_tomorrow": {
      const daysLeft = Math.max(1, Math.ceil((168 - t.hoursSincePosted) / 24))
      return { label: `Apply within ${daysLeft} day${daysLeft === 1 ? "" : "s"}`, detail: "before it goes stale", tone: "cool", multiplier: t.screenRateMultiplier }
    }
    default:
      return null
  }
}

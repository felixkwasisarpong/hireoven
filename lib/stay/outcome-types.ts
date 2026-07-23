/**
 * Client-safe outcome constants + types. Kept separate from outcomes.ts (which
 * imports the Postgres pool) so client components can use the labels/enum without
 * pulling server-only code into the browser bundle.
 */

export const STAY_OUTCOMES = [
  "got_sponsored",
  "won_lottery",
  "lost_lottery",
  "auto_rejected",
  "offer_no_sponsor",
  "still_searching",
] as const

export type StayOutcome = (typeof STAY_OUTCOMES)[number]

export const OUTCOME_LABEL: Record<StayOutcome, string> = {
  got_sponsored: "Got sponsored / H-1B filed",
  won_lottery: "Won the lottery",
  lost_lottery: "Lost the lottery",
  auto_rejected: "Auto-rejected for sponsorship",
  offer_no_sponsor: "Offer, but no sponsorship",
  still_searching: "Still searching",
}

/** Which outcomes read as positive / negative for the tally's tone. */
export const OUTCOME_TONE: Record<StayOutcome, "good" | "crit" | "neutral"> = {
  got_sponsored: "good",
  won_lottery: "good",
  lost_lottery: "crit",
  auto_rejected: "crit",
  offer_no_sponsor: "neutral",
  still_searching: "neutral",
}

export interface OutcomeSummary {
  total: number
  counts: Record<StayOutcome, number>
}

export function isStayOutcome(value: unknown): value is StayOutcome {
  return typeof value === "string" && (STAY_OUTCOMES as readonly string[]).includes(value)
}

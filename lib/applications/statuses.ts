import type { ApplicationStatus } from "@/types"

export const APPLICATION_RESPONSE_STATUSES = [
  "phone_screen",
  "interview",
  "final_round",
  "offer",
] as const satisfies readonly ApplicationStatus[]

export const APPLICATION_NEGATIVE_OUTCOME_STATUSES = [
  "rejected",
  "withdrawn",
] as const satisfies readonly ApplicationStatus[]

export const APPLICATION_TIMING_OUTCOME_STATUSES = [
  ...APPLICATION_RESPONSE_STATUSES,
  ...APPLICATION_NEGATIVE_OUTCOME_STATUSES,
] as const satisfies readonly ApplicationStatus[]

const RESPONSE_STATUS_SET = new Set<string>(APPLICATION_RESPONSE_STATUSES)
const TIMING_OUTCOME_STATUS_SET = new Set<string>(APPLICATION_TIMING_OUTCOME_STATUSES)

export function isApplicationResponseStatus(
  status: string,
): status is (typeof APPLICATION_RESPONSE_STATUSES)[number] {
  return RESPONSE_STATUS_SET.has(status)
}

export function isApplicationTimingOutcomeStatus(
  status: string,
): status is (typeof APPLICATION_TIMING_OUTCOME_STATUSES)[number] {
  return TIMING_OUTCOME_STATUS_SET.has(status)
}

export function timingOutcomeGotRecruiterResponse(status: string): boolean {
  return isApplicationTimingOutcomeStatus(status) && status !== "withdrawn"
}

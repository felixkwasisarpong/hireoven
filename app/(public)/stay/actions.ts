"use server"

import { lookupEmployerForStay, type EmployerStayLookup } from "@/lib/stay/queries"
import { recordStayOutcome, type RecordOutcomeInput, type RecordOutcomeResult } from "@/lib/stay/outcomes"
import { getPrevailingWageBands, type PrevailingWageBands } from "@/lib/stay/wage-level-query"
import { recordTalentProfile, type TalentProfileInput, type RecordTalentResult } from "@/lib/stay/talent"

/**
 * Score an employer against the visitor's situation using Hireoven's real
 * sponsorship graph. Powers the "paste any job / type a company" checker on /stay.
 */
export async function checkEmployerStay(input: {
  query: string
  salary: number
  isStem: boolean
}): Promise<EmployerStayLookup> {
  const salary = Number.isFinite(input.salary) ? Math.min(400_000, Math.max(30_000, input.salary)) : 78_000
  return lookupEmployerForStay({
    query: String(input.query ?? "").slice(0, 120),
    salary,
    isStem: Boolean(input.isStem),
  })
}

/** Record a community outcome report (the flywheel). Returns the refreshed tally. */
export async function submitStayOutcome(input: RecordOutcomeInput): Promise<RecordOutcomeResult> {
  return recordStayOutcome(input)
}

/** Real local DOL wage-level cutoffs for a role + state, to upgrade the odds from
 *  national "estimated" to local "modeled". Null when there isn't enough data. */
export async function modeledBandsFor(input: {
  socGroup: string
  stateAbbr: string
}): Promise<PrevailingWageBands | null> {
  return getPrevailingWageBands(input)
}

/** Candidate opts into the reverse marketplace (sponsor-verified employers only). */
export async function submitTalentProfile(input: TalentProfileInput): Promise<RecordTalentResult> {
  return recordTalentProfile(input)
}


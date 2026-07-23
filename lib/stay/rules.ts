/**
 * "Sponsorship Truth" — what the 2026 rules actually mean for a given person.
 *
 * The panic around the 2026 changes is enormous and, for students, often wrong.
 * The trust wedge is being the source that says plainly "here's what applies to
 * YOU." This encodes the three shocks and the one big misconception (the $100k
 * fee mostly does NOT hit F-1 students filing a change of status from inside the
 * US). Pure + deterministic; never legal advice.
 */

export type FilingContext = "change_of_status_in_us" | "consular_outside_us" | "unknown"
export type StayStatus = "f1_student" | "opt" | "stem_opt" | "other"

export type Applicability = "applies" | "maybe" | "does_not_apply"

export interface RuleVerdict {
  key: "wage_lottery" | "fee_100k" | "duration_of_status"
  title: string
  applicability: Applicability
  /** Plain-English "what this means for you." */
  meaning: string
}

export interface RulesInput {
  status: StayStatus
  filingContext: FilingContext
  /** The candidate is targeting cap-exempt (university/nonprofit/research) roles. */
  capExemptPath?: boolean
}

const isStudentStatus = (s: StayStatus): boolean =>
  s === "f1_student" || s === "opt" || s === "stem_opt"

/**
 * The $100k fee (Sept 2025 proclamation) targets petitions that need consular
 * processing / beneficiaries outside the US — it largely does NOT apply to an
 * F-1 already here filing a change of status. This is the reassuring, most-
 * misunderstood one.
 */
export function feeVerdict(input: RulesInput): RuleVerdict {
  let applicability: Applicability
  let meaning: string
  if (input.filingContext === "change_of_status_in_us") {
    applicability = "does_not_apply"
    meaning =
      "You're filing a change of status from inside the US, so the $100,000 fee most likely does NOT apply to you. The headline number is scaring people it was never aimed at — verify your specific case, but don't let the fear steer your search."
  } else if (input.filingContext === "consular_outside_us") {
    applicability = "applies"
    meaning =
      "A petition needing consular processing (you're outside the US) is the case the $100,000 fee targets. This materially chills employer appetite — lean hard toward employers with deep sponsorship budgets, or cap-exempt roles."
  } else {
    applicability = "maybe"
    meaning =
      "Whether the $100,000 fee applies hinges on change-of-status-in-US (usually exempt) vs consular processing (targeted). Most students already here file a change of status and are not hit — confirm your path."
  }
  return { key: "fee_100k", title: "The $100,000 H-1B fee", applicability, meaning }
}

export function lotteryVerdict(input: RulesInput): RuleVerdict {
  if (input.capExemptPath) {
    return {
      key: "wage_lottery",
      title: "Wage-weighted lottery",
      applicability: "does_not_apply",
      meaning:
        "Cap-exempt employers (universities, nonprofit research, teaching hospitals) file H-1B year-round with no lottery — the 2026 weighted-selection rule doesn't touch that path. It's the strongest structural move for entry-level talent.",
    }
  }
  return {
    key: "wage_lottery",
    title: "Wage-weighted lottery",
    applicability: "applies",
    meaning:
      "For any cap-subject H-1B, selection is now weighted by DOL wage level — Level I entries are far less likely to be picked than Level IV. A typical new-grad offer drops from ~35% to roughly 15% per draw. Raising your wage level (higher pay / higher-band title) directly raises your odds.",
  }
}

export function durationOfStatusVerdict(input: RulesInput): RuleVerdict {
  if (isStudentStatus(input.status)) {
    return {
      key: "duration_of_status",
      title: "The 30-day Duration-of-Status rule",
      applicability: "applies",
      meaning:
        "As an F-1, your stay is now capped at a fixed admission period (max 4 years), the post-completion grace period is halved to 30 days, and extensions are formal USCIS filings that can be denied. Treat your OPT clock as a hard countdown and file early — a revised I-20 no longer fixes a timing slip.",
    }
  }
  return {
    key: "duration_of_status",
    title: "The 30-day Duration-of-Status rule",
    applicability: "does_not_apply",
    meaning:
      "This rule reshapes F-1/J-1/I nonimmigrant stays. It doesn't govern your current status, but it changes the runway for anyone moving through F-1 OPT.",
  }
}

/** All three verdicts for a person, in priority order. */
export function applicableRules(input: RulesInput): RuleVerdict[] {
  return [lotteryVerdict(input), durationOfStatusVerdict(input), feeVerdict(input)]
}

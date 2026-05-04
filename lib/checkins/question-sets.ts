export type CheckinQuestionOption = {
  value: string
  label: string
}

export type CheckinQuestion = {
  id: string
  prompt: string
  type: "choice" | "scale" | "text" | "boolean"
  options?: CheckinQuestionOption[]
  optional?: boolean
  /** Maps to a post_hire_checkins column when extracted */
  mapsTo?: string
}

export type CheckinSet = {
  type: "day_30" | "day_90" | "day_180" | "day_365" | "exit"
  openingMessage: (companyName: string) => string
  questions: CheckinQuestion[]
}

export const DAY_30_CHECKIN: CheckinSet = {
  type: "day_30",
  openingMessage: (company) =>
    `It's been about a month since you started at ${company}. How is it going?`,
  questions: [
    {
      id: "role_match",
      prompt: "Is the role what was described in the interviews?",
      type: "choice",
      mapsTo: "role_as_described",
      options: [
        { value: "yes", label: "Yes, exactly" },
        { value: "mostly", label: "Mostly — small differences" },
        { value: "no", label: "No, it's quite different" },
      ],
    },
    {
      id: "team_quality",
      prompt: "How is the team so far?",
      type: "choice",
      options: [
        { value: "great", label: "Great" },
        { value: "good", label: "Good" },
        { value: "okay", label: "Okay" },
        { value: "difficult", label: "Difficult" },
      ],
    },
    {
      id: "surprises",
      prompt: "Any surprises — good or bad? (You can skip this one)",
      type: "text",
      optional: true,
    },
    {
      id: "satisfaction",
      prompt: "Overall satisfaction so far, 1 to 5?",
      type: "scale",
      mapsTo: "satisfaction_score",
    },
    {
      id: "recommend",
      prompt: "Would you recommend this company to a friend job searching?",
      type: "choice",
      mapsTo: "would_recommend",
      options: [
        { value: "yes", label: "Yes" },
        { value: "maybe", label: "Maybe" },
        { value: "no", label: "No" },
      ],
    },
    {
      id: "comp_accurate",
      prompt: "Is the compensation matching what was in the offer?",
      type: "choice",
      mapsTo: "compensation_accurate",
      options: [
        { value: "yes", label: "Yes, accurate" },
        { value: "close", label: "Close, minor difference" },
        { value: "different", label: "Different from offer" },
      ],
    },
  ],
}

export const DAY_90_CHECKIN: CheckinSet = {
  type: "day_90",
  openingMessage: (company) =>
    `Three months in at ${company}. How are things?`,
  questions: [
    {
      id: "settled",
      prompt: "How settled do you feel?",
      type: "choice",
      options: [
        { value: "fully", label: "Fully settled in" },
        { value: "mostly", label: "Mostly settled" },
        { value: "still_adjusting", label: "Still adjusting" },
      ],
    },
    {
      id: "growth",
      prompt: "Is the growth opportunity real?",
      type: "choice",
      options: [
        { value: "yes", label: "Yes, clear path" },
        { value: "too_early", label: "Too early to say" },
        { value: "no", label: "Not really" },
      ],
    },
    {
      id: "leadership",
      prompt: "How is leadership?",
      type: "choice",
      options: [
        { value: "strong", label: "Strong" },
        { value: "okay", label: "Okay" },
        { value: "concerning", label: "Concerning" },
      ],
    },
    {
      id: "red_flags",
      prompt: "Any red flags you've noticed?",
      type: "choice",
      mapsTo: "red_flags_found",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
    {
      id: "red_flag_type",
      prompt: "What kind of red flags? (skip if none)",
      type: "choice",
      mapsTo: "red_flag_details",
      optional: true,
      options: [
        { value: "culture", label: "Culture issues" },
        { value: "leadership", label: "Leadership problems" },
        { value: "financial", label: "Financial instability" },
        { value: "product", label: "Product direction" },
        { value: "other", label: "Other" },
      ],
    },
    {
      id: "satisfaction",
      prompt: "Satisfaction 1 to 5?",
      type: "scale",
      mapsTo: "satisfaction_score",
    },
    {
      id: "stay_12mo",
      prompt: "Are you planning to stay for 12+ months?",
      type: "choice",
      mapsTo: "planning_to_leave",
      options: [
        { value: "yes", label: "Yes" },
        { value: "unsure", label: "Unsure" },
        { value: "no", label: "Probably not" },
      ],
    },
  ],
}

export const DAY_180_CHECKIN: CheckinSet = {
  type: "day_180",
  openingMessage: (company) =>
    `Six months at ${company} — real talk, how is it going?`,
  questions: [
    {
      id: "recommend",
      prompt: "Would you recommend this company to someone in their job search?",
      type: "boolean",
      mapsTo: "would_recommend",
    },
    {
      id: "comp_accurate",
      prompt: "Has compensation stayed accurate?",
      type: "choice",
      mapsTo: "compensation_accurate",
      options: [
        { value: "yes", label: "Yes" },
        { value: "increased", label: "Yes, increased" },
        { value: "decreased", label: "Decreased — not as promised" },
      ],
    },
    {
      id: "instability",
      prompt: "Any layoff signals or instability you've noticed?",
      type: "choice",
      mapsTo: "red_flags_found",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
    {
      id: "instability_detail",
      prompt: "Briefly — what kind of instability? (skip if none)",
      type: "text",
      mapsTo: "red_flag_details",
      optional: true,
    },
    {
      id: "culture",
      prompt: "Culture as described in the interview?",
      type: "choice",
      mapsTo: "culture_as_described",
      options: [
        { value: "yes", label: "Yes, accurate" },
        { value: "mostly", label: "Mostly" },
        { value: "not_at_all", label: "Not at all" },
      ],
    },
    {
      id: "planning",
      prompt: "Still planning to stay?",
      type: "choice",
      mapsTo: "planning_to_leave",
      options: [
        { value: "yes", label: "Yes" },
        { value: "unsure", label: "Unsure" },
        { value: "looking", label: "Actively looking to leave" },
      ],
    },
    {
      id: "what_changed",
      prompt: "What changed? (optional)",
      type: "text",
      mapsTo: "leave_reason",
      optional: true,
    },
    {
      id: "satisfaction",
      prompt: "Satisfaction 1 to 5?",
      type: "scale",
      mapsTo: "satisfaction_score",
    },
  ],
}

export const DAY_365_CHECKIN: CheckinSet = {
  type: "day_365",
  openingMessage: (company) =>
    `One year at ${company}. Full picture — how was it?`,
  questions: [
    {
      id: "overall",
      prompt: "Overall experience 1 to 5?",
      type: "scale",
      mapsTo: "satisfaction_score",
    },
    {
      id: "recommend",
      prompt: "Would you recommend this employer?",
      type: "boolean",
      mapsTo: "would_recommend",
    },
    {
      id: "promoted",
      prompt: "Did you get promoted or take on more responsibility in year 1?",
      type: "boolean",
    },
    {
      id: "comp_growth",
      prompt: "Compensation growth in year 1?",
      type: "choice",
      options: [
        { value: "none", label: "None" },
        { value: "1_5_pct", label: "1–5%" },
        { value: "5_10_pct", label: "5–10%" },
        { value: "10_plus", label: "10%+" },
      ],
    },
    {
      id: "return",
      prompt: "Would you work here again if you left?",
      type: "choice",
      options: [
        { value: "yes", label: "Yes" },
        { value: "maybe", label: "Maybe" },
        { value: "no", label: "No" },
      ],
    },
    {
      id: "positive_surprise",
      prompt: "Biggest positive surprise? (optional)",
      type: "text",
      optional: true,
    },
    {
      id: "negative_surprise",
      prompt: "Biggest negative surprise? (optional)",
      type: "text",
      optional: true,
    },
    {
      id: "stay_another",
      prompt: "Planning to stay another year?",
      type: "choice",
      mapsTo: "planning_to_leave",
      options: [
        { value: "yes", label: "Yes" },
        { value: "unsure", label: "Unsure" },
        { value: "no", label: "No" },
      ],
    },
  ],
}

export const EXIT_CHECKIN: CheckinSet = {
  type: "exit",
  openingMessage: (company) =>
    `You marked ${company} as a past employer. If you're up for it — what happened?`,
  questions: [
    {
      id: "leave_reason",
      prompt: "Why did you leave?",
      type: "choice",
      mapsTo: "leave_reason",
      options: [
        { value: "better_opportunity", label: "Better opportunity" },
        { value: "layoff", label: "Laid off" },
        { value: "fired", label: "Let go" },
        { value: "culture", label: "Culture wasn't a fit" },
        { value: "compensation", label: "Compensation" },
        { value: "growth", label: "Limited growth" },
        { value: "personal", label: "Personal reasons" },
      ],
    },
    {
      id: "time_to_find",
      prompt: "How long did it take to find a new role?",
      type: "choice",
      optional: true,
      options: [
        { value: "still_looking", label: "Still looking" },
        { value: "under_1mo", label: "Under 1 month" },
        { value: "1_3mo", label: "1–3 months" },
        { value: "3_6mo", label: "3–6 months" },
        { value: "6_plus", label: "6+ months" },
      ],
    },
    {
      id: "recommend",
      prompt: "Would you still recommend this employer despite leaving?",
      type: "boolean",
      mapsTo: "would_recommend",
    },
    {
      id: "what_to_know",
      prompt: "What should job seekers know before joining? (optional)",
      type: "text",
      mapsTo: "red_flag_details",
      optional: true,
    },
    {
      id: "satisfaction",
      prompt: "Overall satisfaction 1 to 5?",
      type: "scale",
      mapsTo: "satisfaction_score",
    },
  ],
}

export const CHECKIN_SETS: Record<string, CheckinSet> = {
  day_30: DAY_30_CHECKIN,
  day_90: DAY_90_CHECKIN,
  day_180: DAY_180_CHECKIN,
  day_365: DAY_365_CHECKIN,
  exit: EXIT_CHECKIN,
}

export function getCheckinSet(type: string): CheckinSet | null {
  return CHECKIN_SETS[type] ?? null
}

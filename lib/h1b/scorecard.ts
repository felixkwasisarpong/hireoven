import type { ScoreBucket } from "@/types/h1b-scorecard"

export type { Grade, ScoreHue, ScoreBucket, ScorecardPayload } from "@/types/h1b-scorecard"

// Deterministic presentation layer over the existing companies.sponsorship_confidence
// value (0-100). This does NOT compute a new score — it maps the existing integer to a
// shareable letter grade + label. Boundaries are inclusive lower bounds.
export function scoreBucket(confidence: number): ScoreBucket {
  const c = Number.isFinite(confidence) ? confidence : 0
  if (c >= 90)
    return {
      grade: "A+",
      label: "Top-Tier Sponsor",
      short: "Top-Tier",
      hue: "emerald",
      description: "Files H-1B petitions at high volume with strong approval outcomes.",
    }
  if (c >= 80)
    return {
      grade: "A",
      label: "Strong Sponsor",
      short: "Strong",
      hue: "green",
      description: "Consistent H-1B sponsor with reliable certification rates.",
    }
  if (c >= 70)
    return {
      grade: "B",
      label: "Reliable Sponsor",
      short: "Reliable",
      hue: "blue",
      description: "Sponsors H-1B candidates regularly across multiple years.",
    }
  if (c >= 60)
    return {
      grade: "C",
      label: "Occasional Sponsor",
      short: "Occasional",
      hue: "amber",
      description: "Sponsors selectively. Confirm role-level support before applying.",
    }
  if (c >= 40)
    return {
      grade: "D",
      label: "Limited Sponsor",
      short: "Limited",
      hue: "orange",
      description: "Limited H-1B history. Likely case-by-case.",
    }
  return {
    grade: "F",
    label: "Unlikely to Sponsor",
    short: "Unlikely",
    hue: "red",
    description: "No or minimal H-1B sponsorship history in public data.",
  }
}

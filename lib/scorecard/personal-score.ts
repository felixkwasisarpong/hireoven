import type { ScoreHue } from "@/types/h1b-scorecard"
import {
  computeDemandScore,
  computeRarityScore,
  computeExperienceScore,
  computeEducationScore,
  type DegreeLevel,
  type ExperienceAlignment,
} from "./personal-score-components"

export type { DegreeLevel, ExperienceAlignment }

// Candidate grade ladder — DIVERGES from the company scoreBucket on purpose (decision 1):
// no D/F, floor at C with a kind label. Same hue palette as the company card so the
// "franchise" still reads. This is the only place candidate grades are defined.
export type PersonalGrade = "A+" | "A" | "B+" | "B" | "C"

export interface PersonalBucket {
  grade: PersonalGrade
  label: string
  hue: ScoreHue
}

export function personalScoreBucket(total: number): PersonalBucket {
  if (total >= 85) return { grade: "A+", label: "Exceptional Profile", hue: "emerald" }
  if (total >= 80) return { grade: "A", label: "Strong Profile", hue: "green" }
  if (total >= 72) return { grade: "B+", label: "Competitive Profile", hue: "lime" }
  if (total >= 64) return { grade: "B", label: "Solid Profile", hue: "lime" }
  return { grade: "C", label: "Building Profile", hue: "amber" } // floor — never "Limited"/"Unlikely"
}

export type ScoreComponentKey = "demand" | "rarity" | "experience" | "education"

const COMPONENT_LABEL: Record<ScoreComponentKey, string> = {
  demand: "Skills demand",
  rarity: "Skills rarity",
  experience: "Experience fit",
  education: "Education",
}

// Resolved inputs (the data layer turns a resume + DB counts into this). Kept free of DB
// access so scoring stays pure and testable.
export interface PersonalScoreInput {
  matched_postings: number
  skill_demands: number[] // sponsor-posting counts for the user's top skills
  skills: string[] // parallel to skill_demands; used to name the rarest skill
  years_of_experience: number | null
  seniority_level: string | null
  degree_level: DegreeLevel
  is_stem: boolean
  has_us_work_auth: boolean
}

export interface PersonalScoreResult {
  total: number // 0-100
  bucket: PersonalBucket
  components: {
    demand: { score: number; matched_postings: number }
    rarity: { score: number; rarest_skill: string | null }
    experience: { score: number; alignment: ExperienceAlignment }
    education: { score: number }
  }
  // Strongest component drives the page framing ("Your skills demand is exceptional").
  strongest: { key: ScoreComponentKey; label: string; score: number }
}

export function computePersonalScore(input: PersonalScoreInput): PersonalScoreResult {
  const demand = computeDemandScore(input.matched_postings)
  const rarity = computeRarityScore(input.skill_demands)
  const experience = computeExperienceScore(input.years_of_experience, input.seniority_level)
  const education = computeEducationScore(input)

  const total = demand + rarity.score + experience.score + education
  const bucket = personalScoreBucket(total)
  const rarest_skill =
    rarity.rarest_index != null ? input.skills[rarity.rarest_index] ?? null : null

  const scores: Record<ScoreComponentKey, number> = {
    demand,
    rarity: rarity.score,
    experience: experience.score,
    education,
  }
  const strongestKey = (Object.keys(scores) as ScoreComponentKey[]).reduce((a, b) =>
    scores[b] > scores[a] ? b : a
  )

  return {
    total,
    bucket,
    components: {
      demand: { score: demand, matched_postings: input.matched_postings },
      rarity: { score: rarity.score, rarest_skill },
      experience: { score: experience.score, alignment: experience.alignment },
      education: { score: education },
    },
    strongest: {
      key: strongestKey,
      label: COMPONENT_LABEL[strongestKey],
      score: scores[strongestKey],
    },
  }
}

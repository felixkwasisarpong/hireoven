// Pure scoring components for the Personal Sponsorability Scorecard. Each returns 0-25.
// No DB access here — the data layer resolves counts/flags and passes them in, which keeps
// these unit-testable and the scoring transparent.

export type DegreeLevel = "phd" | "masters" | "bachelors" | "associate" | "none"
export type ExperienceAlignment = "below" | "fit" | "above"

// Component 1 — Skills Demand: how many sponsor postings want the user's skills.
// Log scale so ubiquitous skills don't dwarf everything; capped at 25.
export function computeDemandScore(matchedPostings: number): number {
  if (matchedPostings <= 0) return 0
  return Math.min(25, Math.round(Math.log10(matchedPostings + 1) * 8))
}

// Per-skill rarity: rarer (fewer sponsor postings) scores higher, but the skill must
// still be in demand (count > 0). Returns 0..1.
function rarityPoints(count: number): number {
  if (count <= 0) return 0
  return Math.max(0, 1 - Math.log10(count + 1) / Math.log10(15000))
}

// Component 2 — Skills Rarity (demand-only proxy for v1; no candidate-side corpus yet).
// Floored at 3 so common-skill candidates aren't punished into a low grade.
// TODO(spec-future): replace the proxy with true (postings / candidates-with-skill) once
// user volume gives us a candidate-side denominator.
export function computeRarityScore(skillDemands: number[]): {
  score: number
  rarest_index: number | null
} {
  const considered = skillDemands.slice(0, 5)
  if (considered.length === 0) return { score: 3, rarest_index: null }
  const pts = considered.map(rarityPoints)
  const avg = pts.reduce((s, x) => s + x, 0) / pts.length
  const score = Math.min(25, Math.max(3, Math.round(avg * 32)))
  let rarest_index: number | null = null
  let best = -1
  considered.forEach((c, i) => {
    const p = rarityPoints(c)
    if (c > 0 && p > best) {
      best = p
      rarest_index = i
    }
  })
  return { score, rarest_index }
}

const SENIORITY_BANDS: Record<string, [number, number]> = {
  entry: [0, 2], junior: [0, 2], associate: [0, 2],
  mid: [2, 5], intermediate: [2, 5],
  senior: [5, 8],
  staff: [8, 99], principal: [8, 99], lead: [8, 99], director: [8, 99], executive: [10, 99],
}

// Component 3 — Experience Fit: does YoE align with the stated seniority band?
// v1 uses resumes.seniority_level + years_of_experience (no resume-side SOC inference).
// TODO(spec-future): infer SOC and compare YoE to the wage-level band LCA filings pay.
export function computeExperienceScore(
  yoe: number | null,
  seniority: string | null
): { score: number; alignment: ExperienceAlignment } {
  const years = Math.max(0, yoe ?? 0)
  const band = SENIORITY_BANDS[(seniority ?? "").toLowerCase().trim()]
  if (!band) {
    // No stated seniority — treat YoE as self-consistent; reward experience modestly.
    return { score: Math.min(24, 16 + Math.min(8, Math.round(years))), alignment: "fit" }
  }
  const [lo, hi] = band
  if (years < lo) return { score: 15, alignment: "below" }
  if (years > hi) return { score: 23, alignment: "above" } // overqualified reads as credible for sponsorship
  return { score: 24, alignment: "fit" }
}

// Component 4 — Education + Credentials. Models LCA approval patterns (advanced + STEM),
// NOT a judgment of worth. is_us_degree dropped (not stored). Capped at 25.
export function computeEducationScore(input: {
  degree_level: DegreeLevel
  is_stem: boolean
  has_us_work_auth: boolean
}): number {
  // PhD base sits 6 above master's so the doctorate still differentiates after bonuses
  // (master's + STEM + auth = 23, below the cap; PhD reaches it).
  const base: Record<DegreeLevel, number> = {
    phd: 24,
    masters: 18,
    bachelors: 14,
    associate: 8,
    none: 3,
  }
  let s = base[input.degree_level]
  if (input.is_stem) s += 3
  if (input.has_us_work_auth) s += 2
  return Math.min(25, s)
}

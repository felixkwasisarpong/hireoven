/**
 * Wage-weighted H-1B lottery model — the 2026 rule change.
 *
 * On 2025-12-29 DHS finalized a rule (effective 2026-02-27, first applied to the
 * FY2027 cap season) that replaces the random H-1B lottery with a *wage-weighted*
 * selection: each registrant gets entries equal to the DOL prevailing-wage level
 * of the offered role — Level I = 1 entry, Level II = 2, Level III = 3,
 * Level IV = 4. Higher-paid roles are far more likely to be selected.
 *
 * These are ESTIMATES built from public projections, not guarantees. The
 * per-level selection probabilities below are calibrated to widely-cited FY2027
 * modeling (e.g. Level I ≈ 15%, Level IV ≈ 61%), which already fold in the
 * expected registrant mix — they are not a naive 1:2:3:4 of the raw entry
 * weights. Present everything downstream as ranges / likelihoods, never promises.
 */

export type WageLevel = 1 | 2 | 3 | 4

export interface WageLevelMeta {
  level: WageLevel
  label: string
  /** Single-draw selection probability under the FY2027 weighted model (0–1). */
  singleDrawOdds: number
  /** Raw entry weight assigned by the rule (informational). */
  entryWeight: number
}

export const WAGE_LEVEL_META: Record<WageLevel, WageLevelMeta> = {
  1: { level: 1, label: "Level I", singleDrawOdds: 0.15, entryWeight: 1 },
  2: { level: 2, label: "Level II", singleDrawOdds: 0.3, entryWeight: 2 },
  3: { level: 3, label: "Level III", singleDrawOdds: 0.45, entryWeight: 3 },
  4: { level: 4, label: "Level IV", singleDrawOdds: 0.61, entryWeight: 4 },
}

/** Pre-2026 flat random-lottery baseline, for the "it used to be ~35%" comparison. */
export const LEGACY_SINGLE_DRAW_ODDS = 0.35

/**
 * OPT gives a fixed runway, and each March registration inside it is one lottery
 * attempt. STEM OPT (36 months) realistically spans ~3 cap seasons; standard OPT
 * (12 months) usually gets a single shot ("one, maybe two"). We use the
 * conservative counts so the survival odds are never over-stated.
 */
export const STEM_OPT_CYCLES = 3
export const STANDARD_OPT_CYCLES = 1

export function optCyclesFor(isStem: boolean): number {
  return isStem ? STEM_OPT_CYCLES : STANDARD_OPT_CYCLES
}

/**
 * National salary bands used to estimate a DOL wage level when we don't have the
 * exact OES prevailing-wage table for the role's SOC code + worksite area.
 *
 * IMPORTANT: real DOL wage levels are SOC- and area-specific (L1≈17th pctile,
 * L2≈34th, L3≈50th, L4≈67th of the local OES wage). These national bands are a
 * deliberately-rough fallback; pass `prevailingWageBands` when the OES data is
 * available to get an accurate level. Confidence is reported accordingly.
 */
export const DEFAULT_WAGE_LEVEL_BANDS: readonly number[] = [85_000, 120_000, 160_000]

export type WageLevelConfidence = "estimated" | "modeled"

export interface WageLevelEstimate {
  level: WageLevel
  meta: WageLevelMeta
  confidence: WageLevelConfidence
  /** Human-readable basis, e.g. "salary band" or "OES SOC 15-1252, NYC". */
  basis: string
}

export interface EstimateWageLevelInput {
  /** Offered / posted annual salary in USD. */
  salary: number | null | undefined
  /**
   * Optional SOC+area prevailing-wage cutoffs [L2min, L3min, L4min] in USD. When
   * present the level is read off the real local wage distribution (modeled),
   * not the national fallback bands (estimated).
   */
  prevailingWageBands?: readonly number[] | null
  basisLabel?: string | null
}

function levelFromBands(salary: number, bands: readonly number[]): WageLevel {
  // bands are the lower cutoffs for L2, L3, L4.
  if (salary < bands[0]) return 1
  if (salary < bands[1]) return 2
  if (salary < bands[2]) return 3
  return 4
}

/**
 * Estimate the DOL wage level (and therefore the lottery weight) for a role.
 * Returns null only when there is no salary at all to reason from.
 */
export function estimateWageLevel(input: EstimateWageLevelInput): WageLevelEstimate | null {
  const salary =
    typeof input.salary === "number" && Number.isFinite(input.salary) && input.salary > 0
      ? input.salary
      : null
  if (salary == null) return null

  const usingReal =
    Array.isArray(input.prevailingWageBands) && input.prevailingWageBands.length === 3
  const bands = usingReal ? (input.prevailingWageBands as readonly number[]) : DEFAULT_WAGE_LEVEL_BANDS
  const level = levelFromBands(salary, bands)

  return {
    level,
    meta: WAGE_LEVEL_META[level],
    confidence: usingReal ? "modeled" : "estimated",
    basis: input.basisLabel?.trim() || (usingReal ? "local prevailing wage" : "national salary band"),
  }
}

/**
 * H-1B cap registration opens the first business day of March each year. Count
 * how many of those windows a student can still register in before their OPT/
 * STEM-OPT runway ends — i.e. their real number of remaining lottery attempts.
 * (Cap-gap bridges a selected petition's Oct-1 start, so we gate on the March
 * registration date, not the Oct start.) `asOf` is passed in so this stays pure.
 */
export function remainingCapSeasons(input: { asOf: Date; runwayEndISO: string | null }): number {
  const { asOf, runwayEndISO } = input
  if (!runwayEndISO) return 0
  const end = new Date(runwayEndISO)
  if (Number.isNaN(end.getTime()) || Number.isNaN(asOf.getTime())) return 0
  if (end.getTime() <= asOf.getTime()) return 0

  let count = 0
  // The earliest registration year to consider is the current one; walk forward.
  for (let year = asOf.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    const registration = new Date(Date.UTC(year, 2, 1)) // March 1
    if (registration.getTime() > asOf.getTime() && registration.getTime() <= end.getTime()) {
      count += 1
    }
  }
  return count
}

/** Probability of being selected at least once across `cycles` independent draws. */
export function cumulativeOdds(singleDrawOdds: number, cycles: number): number {
  const p = Math.min(1, Math.max(0, singleDrawOdds))
  const n = Math.max(0, Math.floor(cycles))
  if (n === 0) return 0
  return 1 - Math.pow(1 - p, n)
}

export interface LotteryOdds {
  level: WageLevel
  levelLabel: string
  /** 0–100, single registration. */
  singleDrawPct: number
  /** 0–100, across the OPT runway's cap seasons. */
  cumulativePct: number
  cycles: number
  isStem: boolean
  /** 0–100 legacy flat-lottery odds, for the before/after comparison. */
  legacySingleDrawPct: number
  confidence: WageLevelConfidence
  basis: string
}

const pct = (v: number): number => Math.round(v * 100)

export interface NextLevelTarget {
  currentLevel: WageLevel
  nextLevel: WageLevel
  nextLevelLabel: string
  /** Salary that reaches the next level (the band cutoff). */
  salaryNeeded: number
  /** How much more than the given salary that is. */
  salaryGap: number
  currentSingleDrawPct: number
  nextSingleDrawPct: number
  currentCumulativePct: number
  nextCumulativePct: number
  /** Percentage-point jump in cumulative odds. */
  cumulativeDeltaPct: number
}

/**
 * The "raise your odds" move — reframes immigration survival as a
 * career-optimization problem. Given a salary, returns the salary that would
 * bump the role to the next DOL wage level and the resulting odds jump. Null
 * when there's no salary or the role is already Level IV (the top).
 */
export function nextLevelTarget(input: {
  salary: number | null | undefined
  isStem: boolean
  prevailingWageBands?: readonly number[] | null
}): NextLevelTarget | null {
  const est = estimateWageLevel({ salary: input.salary, prevailingWageBands: input.prevailingWageBands })
  if (!est || est.level === 4) return null

  const usingReal =
    Array.isArray(input.prevailingWageBands) && input.prevailingWageBands.length === 3
  const bands = usingReal ? (input.prevailingWageBands as readonly number[]) : DEFAULT_WAGE_LEVEL_BANDS
  const salaryNeeded = bands[est.level - 1] // [L2min, L3min, L4min]

  const nextLevel = (est.level + 1) as WageLevel
  const cycles = optCyclesFor(input.isStem)
  const curSingle = est.meta.singleDrawOdds
  const nextSingle = WAGE_LEVEL_META[nextLevel].singleDrawOdds
  const salary = input.salary as number

  return {
    currentLevel: est.level,
    nextLevel,
    nextLevelLabel: WAGE_LEVEL_META[nextLevel].label,
    salaryNeeded,
    salaryGap: Math.max(0, salaryNeeded - salary),
    currentSingleDrawPct: pct(curSingle),
    nextSingleDrawPct: pct(nextSingle),
    currentCumulativePct: pct(cumulativeOdds(curSingle, cycles)),
    nextCumulativePct: pct(cumulativeOdds(nextSingle, cycles)),
    cumulativeDeltaPct: pct(cumulativeOdds(nextSingle, cycles)) - pct(cumulativeOdds(curSingle, cycles)),
  }
}

/**
 * Full weighted-lottery readout for a salary + STEM status. This is the number
 * that powers the landing gauge and the Stay Score's lottery component.
 */
export function computeLotteryOdds(input: {
  salary: number | null | undefined
  isStem: boolean
  prevailingWageBands?: readonly number[] | null
  basisLabel?: string | null
}): LotteryOdds | null {
  const est = estimateWageLevel({
    salary: input.salary,
    prevailingWageBands: input.prevailingWageBands,
    basisLabel: input.basisLabel,
  })
  if (!est) return null

  const cycles = optCyclesFor(input.isStem)
  const single = est.meta.singleDrawOdds

  return {
    level: est.level,
    levelLabel: est.meta.label,
    singleDrawPct: pct(single),
    cumulativePct: pct(cumulativeOdds(single, cycles)),
    cycles,
    isStem: input.isStem,
    legacySingleDrawPct: pct(LEGACY_SINGLE_DRAW_ODDS),
    confidence: est.confidence,
    basis: est.basis,
  }
}

/**
 * The Level Gap: how much more salary moves a role up one H-1B wage level, and whether that
 * number is already inside the employer's own advertised band.
 *
 * Under the wage-weighted lottery (eff. 27 Feb 2026) the DOL wage level sets the registrant's
 * entry count — Level I = 1 entry, II = 2, III = 3, IV = 4. So a candidate at the bottom of a
 * posted band can materially change their odds by asking for a number the employer has already
 * published. That is the whole feature.
 *
 * Pure: takes the exact published thresholds (from oflc_wage_levels) plus the posted band, and
 * returns what to say. It anchors on the band's FLOOR, because that is what a candidate is
 * offered by default and the gap is measured from there.
 */

import type { WageLevel } from "./lottery-odds"

export interface LevelGapInput {
  /** Annual USD Level I-IV thresholds, ascending. */
  levels: readonly [number, number, number, number]
  salaryMin: number | null | undefined
  salaryMax: number | null | undefined
}

export interface LevelGap {
  /** Level implied by the band floor (or the only figure we have). */
  currentLevel: WageLevel
  /** Salary the gap is measured from — the band floor. */
  anchorSalary: number
  /** Next level up, or null when already Level IV. */
  nextLevel: WageLevel | null
  nextThreshold: number | null
  /** Raise needed to reach nextLevel from the anchor. */
  increaseNeeded: number | null
  /**
   * True when nextThreshold is at or below the band's ceiling — i.e. the candidate can reach the
   * next level without asking for more than the employer already advertised. This is the line
   * that makes the card worth showing.
   */
  nextLevelWithinBand: boolean
  /** Highest level reachable anywhere inside the posted band. */
  bestLevelInBand: WageLevel
  /**
   * The band's ceiling sits below the Level II threshold, so the req is structurally weak for a
   * lottery candidate no matter how they negotiate.
   */
  ceilingBelowLevelTwo: boolean
  /**
   * The band floor is beneath the Level I prevailing wage. An H-1B cannot be filed below the
   * prevailing wage, so the bottom of this band is not a sponsorable offer.
   */
  belowPrevailingWage: boolean
}

/** Level implied by a salary: the highest threshold it clears. Below Level I still reads as I. */
function levelFor(salary: number, levels: readonly [number, number, number, number]): WageLevel {
  if (salary >= levels[3]) return 4
  if (salary >= levels[2]) return 3
  if (salary >= levels[1]) return 2
  return 1
}

export function computeLevelGap(input: LevelGapInput): LevelGap | null {
  const { levels } = input
  if (!levels || levels.length !== 4) return null
  if (!levels.every((l) => Number.isFinite(l) && l > 0)) return null
  // Thresholds must ascend; a non-monotonic row means bad data and we say nothing.
  if (!(levels[0] < levels[1] && levels[1] < levels[2] && levels[2] < levels[3])) return null

  const min = Number.isFinite(input.salaryMin as number) ? (input.salaryMin as number) : null
  const max = Number.isFinite(input.salaryMax as number) ? (input.salaryMax as number) : null

  // Anchor on the floor — that is the default offer. Fall back to whichever figure exists.
  const anchor = min ?? max
  if (anchor === null || anchor <= 0) return null
  const ceiling = max ?? min ?? anchor

  const currentLevel = levelFor(anchor, levels)
  const bestLevelInBand = levelFor(ceiling, levels)

  const nextLevel = currentLevel < 4 ? ((currentLevel + 1) as WageLevel) : null
  const nextThreshold = nextLevel ? levels[nextLevel - 1] : null
  const increaseNeeded = nextThreshold !== null ? Math.max(0, Math.round(nextThreshold - anchor)) : null

  return {
    currentLevel,
    anchorSalary: Math.round(anchor),
    nextLevel,
    nextThreshold,
    increaseNeeded,
    nextLevelWithinBand: nextThreshold !== null && ceiling >= nextThreshold,
    bestLevelInBand,
    ceilingBelowLevelTwo: ceiling < levels[1],
    belowPrevailingWage: anchor < levels[0],
  }
}

/**
 * Copy-ready negotiation line, or null when there is nothing actionable to say.
 *
 * `occupationLabel` is the SOC occupation *category* ("Software Developers") — a plural
 * classification, not this job's title — so it is quoted as a classification rather than
 * dropped into the sentence as a role name.
 */
export function negotiationLine(gap: LevelGap, occupationLabel?: string | null): string | null {
  if (!gap.nextLevel || gap.nextThreshold === null || !gap.nextLevelWithinBand) return null
  const occupation = occupationLabel?.trim()
    ? ` This role classifies under "${occupationLabel.trim()}" for prevailing-wage purposes.`
    : ""
  return (
    `Based on the DOL prevailing wage for this occupation and worksite, a base salary of ` +
    `$${gap.nextThreshold.toLocaleString()} would place this position at wage Level ${romanLevel(gap.nextLevel)}. ` +
    `That figure is within the posted range, and I'd like to target it.${occupation}`
  )
}

function romanLevel(level: WageLevel): string {
  return (["I", "II", "III", "IV"] as const)[level - 1]
}

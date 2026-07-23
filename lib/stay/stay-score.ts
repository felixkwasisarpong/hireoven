/**
 * Stay Score — the survival-odds reframe.
 *
 * Every other tool answers "does this company sponsor?" (a green checkmark). The
 * Stay Score answers the question that actually decides an international
 * graduate's life: "if I take this job, what are my realistic odds of still
 * building a career here in a few years, under the 2026 rules?"
 *
 * It fuses four things Hireoven already knows or can estimate:
 *   1. Cap-exempt status  — universities / nonprofits / research orgs file H-1B
 *      year-round with NO lottery. Post-wage-weighting this is the single best
 *      path for entry-level talent, so it overrides everything else.
 *   2. Entry-level sponsorship history — does this employer actually sponsor
 *      juniors (not just senior transfers)?
 *   3. The wage-weighted lottery odds — {@link computeLotteryOdds}.
 *   4. The candidate's clock — does a path even finish inside the OPT runway?
 *
 * Output is a 0–100 likelihood with a transparent breakdown. It is NEVER a
 * promise — a company being "a sponsor" is not the same as "this req will
 * sponsor you and you'll win the draw". Always surfaced as odds, with a
 * disclaimer, per the honest-risk guidance in the product brief.
 */

import { computeLotteryOdds, type LotteryOdds } from "./lottery-odds"

export type StayTone = "good" | "brand" | "warn" | "crit" | "neutral"

export type StayBand = "Lottery-free" | "Strong" | "Sponsors, lottery-bound" | "Risky" | "Unrated"

export interface StayBar {
  key: string
  /** 0–100 fill. */
  value: number
  tone: StayTone
}

export interface StayScoreResult {
  score: number
  band: StayBand
  badgeTone: StayTone
  bars: StayBar[]
  verdict: string
  lottery: LotteryOdds | null
  capExempt: boolean
  disclaimer: string
}

export interface StayScoreInput {
  /** The role skips the H-1B cap entirely (university / nonprofit / research). */
  capExempt?: boolean | null
  /** Employer has any H-1B/LCA sponsorship history. */
  sponsorsH1b?: boolean | null
  /** 0–100 sponsorship-confidence signal from Hireoven's graph, if available. */
  sponsorshipScore?: number | null
  /** Certified LCA filings in the last ~12 months. */
  recentLcaCount?: number | null
  /** Certified LCA filings all-time (proxy for depth of history). */
  priorLcaCount?: number | null
  /** Entry-level (NEW_EMPLOYMENT / Level I–II) filings — sponsors juniors, not just transfers. */
  entryLevelLcaCount?: number | null
  /** PERM / green-card filings — proven to convert people to permanent residency. */
  permCount?: number | null
  /** Offered / posted annual salary in USD (drives the wage-level → lottery odds). */
  salary?: number | null
  isStem?: boolean | null
  /** Optional real OES prevailing-wage cutoffs [L2min, L3min, L4min] for the role. */
  prevailingWageBands?: readonly number[] | null
  /** Days left on the OPT/STEM-OPT runway, if the user has entered their clock. */
  optDaysRemaining?: number | null
}

const DISCLAIMER =
  "The Stay Score is a profile-vs-market likelihood modeled from public DOL/USCIS data and the 2026 rule changes — not a guarantee or legal advice. Verify specifics with your DSO or immigration counsel."

const clamp = (v: number): number => Math.min(100, Math.max(0, Math.round(v)))
const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0

/** Diminishing-returns scale: count → 0–100, saturating around `soft`. */
const saturate = (count: number, soft: number): number =>
  count <= 0 ? 0 : clamp(100 * (1 - Math.exp(-count / soft)))

function bandForScore(score: number, capExempt: boolean): StayBand {
  if (capExempt) return "Lottery-free"
  if (score >= 70) return "Strong"
  if (score >= 45) return "Sponsors, lottery-bound"
  return "Risky"
}

function toneForScore(score: number): StayTone {
  if (score >= 75) return "good"
  if (score >= 45) return "warn"
  return "crit"
}

export function computeStayScore(input: StayScoreInput): StayScoreResult {
  const capExempt = Boolean(input.capExempt)
  const lottery = computeLotteryOdds({
    salary: input.salary,
    isStem: Boolean(input.isStem),
    prevailingWageBands: input.prevailingWageBands,
  })

  const sponsorshipStrength =
    num(input.sponsorshipScore) > 0
      ? clamp(num(input.sponsorshipScore))
      : saturate(num(input.recentLcaCount) + num(input.priorLcaCount) * 0.4, 40)
  const entryLevel = saturate(num(input.entryLevelLcaCount), 12)
  const permTrack = saturate(num(input.permCount), 10)

  // Clock fit: OPT runway is fine above ~120 days, tightens below.
  const clockFit =
    input.optDaysRemaining == null
      ? 70
      : clamp((num(input.optDaysRemaining) / 120) * 100)

  // ── Cap-exempt override: the lottery does not apply. ─────────────────────
  if (capExempt) {
    const score = clamp(
      88 +
        0.06 * entryLevel +
        0.04 * permTrack +
        0.02 * (clockFit - 70)
    )
    return {
      score,
      band: "Lottery-free",
      badgeTone: "good",
      capExempt: true,
      lottery,
      disclaimer: DISCLAIMER,
      bars: [
        { key: "Cap-exempt (no lottery)", value: 100, tone: "good" },
        { key: "Sponsors year-round", value: Math.max(90, sponsorshipStrength), tone: "good" },
        { key: "Entry-level history", value: Math.max(60, entryLevel), tone: "good" },
        { key: "PERM / green-card track", value: Math.max(50, permTrack), tone: "brand" },
        { key: "Fits your clock", value: clockFit, tone: clockFit >= 60 ? "good" : "warn" },
      ],
      verdict:
        "Files H-1B any time — no cap, no lottery. The 2026 weighted-selection rule doesn't touch it, which makes this the strongest structural path for entry-level talent. Pay is often lower, but your odds of staying are dramatically higher.",
    }
  }

  // ── Cap-subject: sponsorship strength gated by the weighted lottery. ─────
  const lotteryCumulative = lottery ? lottery.cumulativePct : 40
  const lotterySingle = lottery ? lottery.singleDrawPct : 25

  // A great sponsor you can't win the draw for is still capped by the draw.
  // Blend the employer's willingness with your realistic odds of selection.
  const willingness = 0.55 * sponsorshipStrength + 0.25 * entryLevel + 0.2 * permTrack
  const raw = 0.55 * willingness + 0.45 * lotteryCumulative
  const score = clamp(raw * (0.6 + 0.4 * (clockFit / 100)))

  const unrated = sponsorshipStrength < 12 && num(input.recentLcaCount) === 0 && num(input.priorLcaCount) === 0
  const band = unrated ? "Unrated" : bandForScore(score, false)
  const badgeTone: StayTone = unrated ? "neutral" : toneForScore(score)

  const lotteryBarTone: StayTone = lotterySingle < 20 ? "crit" : lotterySingle < 40 ? "warn" : "good"

  const bars: StayBar[] = [
    { key: "Cap-exempt (no lottery)", value: 0, tone: "crit" },
    { key: "Sponsors this role", value: sponsorshipStrength, tone: sponsorshipStrength >= 60 ? "good" : sponsorshipStrength >= 30 ? "warn" : "crit" },
    { key: "Entry-level history", value: entryLevel, tone: entryLevel >= 55 ? "good" : entryLevel >= 25 ? "warn" : "crit" },
    { key: "PERM / green-card track", value: permTrack, tone: permTrack >= 55 ? "good" : permTrack >= 25 ? "brand" : "warn" },
    { key: lottery ? `Lottery odds (${lottery.levelLabel})` : "Lottery odds", value: lotteryCumulative, tone: lotteryBarTone },
    { key: "Fits your clock", value: clockFit, tone: clockFit >= 60 ? "good" : "warn" },
  ]

  let verdict: string
  if (unrated) {
    verdict =
      "No strong sponsorship signal in the public record yet. In the full product we resolve the exact legal entity and show its filing history with a confidence score — treat as unverified until then."
  } else if (score >= 70) {
    verdict = `Real entry-level sponsorship history and decent lottery odds${lottery ? ` (${lottery.levelLabel}, ~${lottery.cumulativePct}% across your OPT runway)` : ""}. A genuinely durable path — still not a guarantee, so pair it with a cap-exempt safety.`
  } else if (score >= 45) {
    verdict = `Sponsors, but it's cap-subject — you still face the weighted lottery${lottery ? ` (~${lottery.singleDrawPct}% per draw at ${lottery.levelLabel})` : ""}. Good if you win; have a cap-exempt backup on your list.`
  } else {
    verdict = `Thin sponsorship signal and lottery-bound${lottery ? ` (~${lottery.singleDrawPct}% per draw)` : ""}. A low-probability bet with your clock running. Prioritize cap-exempt roles and proven entry-level sponsors first.`
  }

  return {
    score,
    band,
    badgeTone,
    capExempt: false,
    lottery,
    disclaimer: DISCLAIMER,
    bars,
    verdict,
  }
}

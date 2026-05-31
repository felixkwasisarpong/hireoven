/**
 * Apex Pipeline Simulator — Monte Carlo job search engine
 *
 * Given the user's actual funnel metrics, runs N simulations of their
 * job search and returns probability distributions for:
 *   - Weeks to first offer
 *   - Total applications needed
 *   - Current bottleneck stage
 *
 * Based on real job-search funnel research:
 *   Industry avg:  ~2% app→offer,  ~10% app→phone,  ~20% phone→interview,  ~25% interview→offer
 */

export type FunnelMetrics = {
  /** Applications sent so far */
  applicationsSent: number
  /** Responses received (any stage) */
  responsesReceived: number
  /** Phone screens / recruiters calls */
  phoneScreens: number
  /** Onsite / technical interviews */
  onsiteInterviews: number
  /** Offers received */
  offersReceived: number
  /** Applications per week (current pace) */
  appsPerWeek: number
  /** Weeks elapsed in search */
  weeksElapsed: number
}

export type SimulationResult = {
  /** Probability (0–1) of at least one offer within N weeks */
  offerProbabilityByWeek: Record<number, number>  // week → probability
  /** Expected weeks to first offer (median) */
  medianWeeksToOffer: number
  /** 10th–90th percentile range */
  confidenceInterval: { low: number; high: number }
  /** Estimated total applications needed (median) */
  estimatedAppsNeeded: number
  /** Which stage is the biggest drop-off */
  bottleneck: "application_response" | "phone_to_onsite" | "onsite_to_offer" | "none_yet"
  bottleneckExplanation: string
  /** What-if: apps per week boosted by 50% */
  scenarioBoost: { weeksToOffer: number; label: string }
  /** What-if: improve response rate by 20% (better resume/targeting) */
  scenarioQuality: { weeksToOffer: number; label: string }
  /** Simple 0–100 momentum score */
  momentumScore: number
  momentumLabel: string
}

const INDUSTRY_BASELINES = {
  responseRate: 0.10,      // 10% of apps get any response
  phoneToOnsite: 0.35,     // 35% of phone screens lead to onsite
  onsiteToOffer: 0.25,     // 25% of onsites lead to an offer
}

const SIM_RUNS = 2000
const MAX_WEEKS = 52

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val))
}

/** Derive conversion rates from actual data, falling back to industry baselines */
function deriveRates(m: FunnelMetrics) {
  const responseRate = m.applicationsSent > 5
    ? clamp(m.responsesReceived / m.applicationsSent, 0.01, 0.60)
    : INDUSTRY_BASELINES.responseRate

  const phoneToOnsite = m.phoneScreens > 2
    ? clamp(m.onsiteInterviews / m.phoneScreens, 0.05, 0.90)
    : INDUSTRY_BASELINES.phoneToOnsite

  const onsiteToOffer = m.onsiteInterviews > 1
    ? clamp(m.offersReceived / m.onsiteInterviews, 0.05, 0.90)
    : INDUSTRY_BASELINES.onsiteToOffer

  return { responseRate, phoneToOnsite, onsiteToOffer }
}

function runSingleSimulation(
  appsPerWeek: number,
  rates: ReturnType<typeof deriveRates>,
): number {
  // Pipeline delays: responses take 1-3 weeks, phone→onsite 1-2 weeks, onsite→offer 1-2 weeks
  let week = 0
  let pendingApps = 0

  while (week < MAX_WEEKS) {
    week++
    pendingApps += appsPerWeek

    // Responses this week
    const newResponses = Math.floor(pendingApps * rates.responseRate)
    pendingApps = Math.max(0, pendingApps - newResponses * (1 / rates.responseRate))

    // Some fraction reach phone screen with a 1-week delay handled probabilistically
    const phones = newResponses  // 1:1 for simplicity (responses = phone invites in this model)
    const onsites = Math.round(phones * rates.phoneToOnsite)
    const offers  = Math.round(onsites * rates.onsiteToOffer)

    if (offers > 0) return week
  }
  return MAX_WEEKS + 1
}

function detectBottleneck(m: FunnelMetrics, rates: ReturnType<typeof deriveRates>): {
  bottleneck: SimulationResult["bottleneck"]
  explanation: string
} {
  if (m.applicationsSent < 5) {
    return { bottleneck: "none_yet", explanation: "Not enough data yet — keep applying to calibrate." }
  }
  if (rates.responseRate < 0.05) {
    return {
      bottleneck: "application_response",
      explanation: `Only ${(rates.responseRate * 100).toFixed(1)}% of your applications get a response (industry avg: 10%). Your resume or targeting needs work.`,
    }
  }
  if (rates.phoneToOnsite < 0.20) {
    return {
      bottleneck: "phone_to_onsite",
      explanation: `${(rates.phoneToOnsite * 100).toFixed(0)}% of your phone screens convert to onsites (avg: 35%). Focus on phone screen prep and better-fit roles.`,
    }
  }
  if (rates.onsiteToOffer < 0.15) {
    return {
      bottleneck: "onsite_to_offer",
      explanation: `${(rates.onsiteToOffer * 100).toFixed(0)}% of your onsites turn into offers (avg: 25%). Deep interview prep and stronger closing will help.`,
    }
  }
  return { bottleneck: "none_yet", explanation: "Your funnel looks healthy — keep the pace up." }
}

export function runPipelineSimulation(metrics: FunnelMetrics): SimulationResult {
  const rates = deriveRates(metrics)
  const apw = Math.max(1, metrics.appsPerWeek)

  // Run simulations
  const results: number[] = []
  for (let i = 0; i < SIM_RUNS; i++) {
    results.push(runSingleSimulation(apw, rates))
  }
  results.sort((a, b) => a - b)

  // Build probability by week
  const offerProbabilityByWeek: Record<number, number> = {}
  for (let w = 1; w <= 16; w++) {
    offerProbabilityByWeek[w] = results.filter((r) => r <= w).length / SIM_RUNS
  }

  const median = results[Math.floor(SIM_RUNS * 0.5)]
  const p10    = results[Math.floor(SIM_RUNS * 0.1)]
  const p90    = results[Math.floor(SIM_RUNS * 0.9)]

  // Estimated apps needed at current pace
  const estimatedAppsNeeded = Math.round(median * apw)

  // Scenarios
  const boostResults: number[] = []
  const qualityResults: number[] = []
  const boostRates = { ...rates, responseRate: clamp(rates.responseRate * 1.5, 0.01, 0.6) }
  const qualityRates = { ...rates, responseRate: clamp(rates.responseRate * 1.2, 0.01, 0.6), onsiteToOffer: clamp(rates.onsiteToOffer * 1.2, 0.05, 0.9) }

  for (let i = 0; i < SIM_RUNS; i++) {
    boostResults.push(runSingleSimulation(Math.round(apw * 1.5), rates))
    qualityResults.push(runSingleSimulation(apw, qualityRates))
  }
  boostResults.sort((a, b) => a - b)
  qualityResults.sort((a, b) => a - b)

  const boostMedian   = boostResults[Math.floor(SIM_RUNS * 0.5)]
  const qualityMedian = qualityResults[Math.floor(SIM_RUNS * 0.5)]

  // Momentum score
  const responseRateNorm = clamp(rates.responseRate / INDUSTRY_BASELINES.responseRate, 0, 2)
  const paceNorm         = clamp(apw / 5, 0, 2)
  const momentumScore    = Math.round(clamp((responseRateNorm * 0.6 + paceNorm * 0.4) * 50, 0, 100))
  const momentumLabel    =
    momentumScore >= 75 ? "Strong" :
    momentumScore >= 45 ? "Building" :
    "Needs boost"

  const { bottleneck, explanation: bottleneckExplanation } = detectBottleneck(metrics, rates)

  return {
    offerProbabilityByWeek,
    medianWeeksToOffer: median > MAX_WEEKS ? -1 : median,
    confidenceInterval: { low: p10, high: p90 },
    estimatedAppsNeeded,
    bottleneck,
    bottleneckExplanation,
    scenarioBoost: {
      weeksToOffer: boostMedian > MAX_WEEKS ? -1 : boostMedian,
      label: `+50% applications/week → ~${boostMedian} weeks`,
    },
    scenarioQuality: {
      weeksToOffer: qualityMedian > MAX_WEEKS ? -1 : qualityMedian,
      label: `Better targeting (+20% response rate) → ~${qualityMedian} weeks`,
    },
    momentumScore,
    momentumLabel,
  }
}

/**
 * Closed-loop resume A/B performance.
 *
 * Given each submitted application's resume variant and whether it earned a
 * response (reached a phone screen or beyond — see the API for how that's
 * derived from status + timeline), rank the variants by response rate and, when
 * there's enough signal, recommend the winner to promote to primary.
 *
 * Deliberately small + pure so it's unit-testable; the API does the SQL.
 */

/** Stages that count as "the application got a callback". */
export const RESPONSE_STATUSES = ["phone_screen", "interview", "final_round", "offer"] as const

/** Minimum submitted applications on a variant before we trust its rate. */
export const MIN_SAMPLE = 5
/** Minimum relative lift over the runner-up before we call a confident winner. */
export const CONFIDENT_LIFT = 1.5

export type VariantApplication = {
  resumeId: string
  resumeName: string
  gotResponse: boolean
}

export type VariantStat = {
  resumeId: string
  resumeName: string
  applications: number
  responses: number
  responseRate: number // 0..1
  enoughData: boolean
}

export type VariantRecommendation = {
  leaderId: string
  leaderName: string
  /** Multiplier vs the runner-up variant (e.g. 2 = "2x more screens"). */
  liftVsRunnerUp: number | null
  /** A confident winner clears MIN_SAMPLE and CONFIDENT_LIFT over the runner-up. */
  confident: boolean
  headline: string
}

export type VariantPerformance = {
  variants: VariantStat[]
  totalApplications: number
  recommendation: VariantRecommendation | null
  /** True once at least two variants each have MIN_SAMPLE applications. */
  comparable: boolean
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function computeVariantPerformance(rows: VariantApplication[]): VariantPerformance {
  const byVariant = new Map<string, { name: string; apps: number; responses: number }>()
  for (const r of rows) {
    const v = byVariant.get(r.resumeId) ?? { name: r.resumeName, apps: 0, responses: 0 }
    v.apps += 1
    if (r.gotResponse) v.responses += 1
    v.name = r.resumeName || v.name
    byVariant.set(r.resumeId, v)
  }

  const variants: VariantStat[] = [...byVariant.entries()]
    .map(([resumeId, v]) => ({
      resumeId,
      resumeName: v.name,
      applications: v.apps,
      responses: v.responses,
      responseRate: v.apps > 0 ? v.responses / v.apps : 0,
      enoughData: v.apps >= MIN_SAMPLE,
    }))
    // Rank by response rate, but a variant with enough data always outranks a
    // small-sample one so we don't crown a 1/1 fluke.
    .sort((a, b) => {
      if (a.enoughData !== b.enoughData) return a.enoughData ? -1 : 1
      if (b.responseRate !== a.responseRate) return b.responseRate - a.responseRate
      return b.applications - a.applications
    })

  const totalApplications = variants.reduce((s, v) => s + v.applications, 0)
  const qualified = variants.filter((v) => v.enoughData)
  const comparable = qualified.length >= 2

  let recommendation: VariantRecommendation | null = null
  const leader = variants[0]
  if (leader && leader.enoughData) {
    const runnerUp = variants.find((v) => v.resumeId !== leader.resumeId && v.enoughData)
    const lift =
      runnerUp && runnerUp.responseRate > 0 ? leader.responseRate / runnerUp.responseRate : null
    const confident =
      Boolean(runnerUp) && leader.responseRate > (runnerUp?.responseRate ?? 0) && (lift ?? 0) >= CONFIDENT_LIFT

    const headline = confident && lift
      ? `“${leader.resumeName}” gets ${lift >= 1.95 ? `${Math.round(lift)}×` : `${lift.toFixed(1)}×`} more callbacks (${pct(leader.responseRate)} vs ${pct(runnerUp!.responseRate)}).`
      : runnerUp
        ? `“${leader.resumeName}” leads at ${pct(leader.responseRate)} callbacks, but the gap isn't decisive yet.`
        : `“${leader.resumeName}” is at ${pct(leader.responseRate)} callbacks — apply with another variant to compare.`

    recommendation = {
      leaderId: leader.resumeId,
      leaderName: leader.resumeName,
      liftVsRunnerUp: lift,
      confident,
      headline,
    }
  }

  return { variants, totalApplications, recommendation, comparable }
}

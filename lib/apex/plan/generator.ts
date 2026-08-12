import type { CareerTwinDimension, CareerTwinSnapshot } from "@/lib/apex/career-twin/types"
import type { ApexNudge } from "@/lib/apex/nudges"
import type { ApexStrategyBoard } from "@/lib/apex/types"
import { JOB_SECTOR_LABELS, ROLE_CATEGORY_LABELS } from "@/lib/apex/outcomes/categorizers"

export type TodayPlanItem = {
  id: string
  eyebrow: string
  title: string
  detail: string
  impact: string
  query: string
}

export type TodayPlanModel = {
  items: TodayPlanItem[]
  activeLimit: number
  contextNote: string | null
}

type BuildTodayPlanModelArgs = {
  board: ApexStrategyBoard | null
  nudges: ApexNudge[]
  hasData: boolean
  twin: CareerTwinSnapshot | null
  history?: CareerTwinSnapshot[]
}

function dimensionScore(snapshot: CareerTwinSnapshot | null, key: string): number | null {
  return snapshot?.dimensions.find((dimension) => dimension.key === key)?.score ?? null
}

function roleLabel(snapshot: CareerTwinSnapshot | null): string | null {
  if (!snapshot?.primaryRoleCategory) return null
  return ROLE_CATEGORY_LABELS[snapshot.primaryRoleCategory] ?? snapshot.primaryRoleCategory
}

function sectorLabel(snapshot: CareerTwinSnapshot | null): string | null {
  if (!snapshot?.primarySector) return null
  return JOB_SECTOR_LABELS[snapshot.primarySector] ?? snapshot.primarySector
}

function previousSnapshot(
  twin: CareerTwinSnapshot | null,
  history: CareerTwinSnapshot[]
): CareerTwinSnapshot | null {
  if (!twin) return null
  return history.find((snapshot) => snapshot.id !== twin.id) ?? null
}

function maxDimensionDelta(
  current: CareerTwinSnapshot | null,
  previous: CareerTwinSnapshot | null
): number {
  if (!current || !previous) return 0

  const previousMap = new Map<string, CareerTwinDimension>(
    previous.dimensions.map((dimension) => [dimension.key, dimension])
  )

  return current.dimensions.reduce((max, dimension) => {
    const prior = previousMap.get(dimension.key)
    if (!prior) return max
    return Math.max(max, Math.abs(dimension.score - prior.score))
  }, 0)
}

function dedupeItems(items: TodayPlanItem[]): TodayPlanItem[] {
  const seen = new Set<string>()
  const normalized = new Set<string>()
  const next: TodayPlanItem[] = []

  for (const item of items) {
    const titleKey = item.title.trim().toLowerCase()
    if (seen.has(item.id) || normalized.has(titleKey)) continue
    seen.add(item.id)
    normalized.add(titleKey)
    next.push(item)
  }

  return next
}

function adaptiveTwinItems(
  twin: CareerTwinSnapshot | null,
  history: CareerTwinSnapshot[]
): { items: TodayPlanItem[]; activeLimit: number; contextNote: string | null } {
  if (!twin) {
    return {
      items: [],
      activeLimit: 3,
      contextNote: null,
    }
  }

  const items: TodayPlanItem[] = []
  const prior = previousSnapshot(twin, history)
  const burnoutRisk = dimensionScore(twin, "burnout_risk_score")
  const responseStrength = dimensionScore(twin, "response_strength_score")
  const pipelineMomentum = dimensionScore(twin, "pipeline_momentum_score")
  const sponsorshipConstraint = dimensionScore(twin, "sponsorship_constraint_score")
  const driftDelta = maxDimensionDelta(twin, prior)
  const roleShifted = roleLabel(twin) && roleLabel(prior) && roleLabel(twin) !== roleLabel(prior)
  const sectorShifted = sectorLabel(twin) && sectorLabel(prior) && sectorLabel(twin) !== sectorLabel(prior)
  const driftDetected = Boolean(roleShifted || sectorShifted || driftDelta >= 12)

  let activeLimit = 3
  let contextNote: string | null = null

  if (burnoutRisk !== null && burnoutRisk >= 65) {
    activeLimit = 2
    // Welcome-review #6: frame this as a deliberate pacing choice, not a clinical
    // "burnout risk" inference. No unearned psychology, no throughput silently
    // taken away — a smaller, higher-conviction batch is the recommendation, and
    // the user can always ask for more.
    contextNote = "Today's plan is deliberately small — a focused, high-conviction batch."
    items.push({
      id: "twin:pace",
      eyebrow: "Pace",
      title: "Operate in a smaller, higher-conviction batch",
      detail: "A tighter plan today keeps decision quality high — better to move a few strong-fit roles forward than spread thin across a long queue. Want more? Just ask.",
      impact: "Protects decision quality and keeps progress moving without pushing the search into a lower-signal grind.",
      query: "Show me more roles and next steps for today",
    })
  }

  if (driftDetected) {
    const currentRole = roleLabel(twin)
    const currentSector = sectorLabel(twin)
    const laneLabel = currentRole ?? currentSector ?? "your strongest lane"
    if (!contextNote) {
      contextNote = "Plan adjusted because Career Twin detected drift in your search profile."
    }
    items.push({
      id: "twin:drift",
      eyebrow: "Recalibrate",
      title: `Re-rank today around ${laneLabel}`,
      detail: "Your Twin signals shifted enough that Apex should re-prioritize roles before you spend effort on stale assumptions.",
      impact: "Keeps the day aligned to the lane that is currently converting instead of the lane you started with.",
      query: `Re-rank my opportunities around ${laneLabel} and tell me what deserves attention today`,
    })
  }

  if (responseStrength !== null && responseStrength <= 35) {
    items.push({
      id: "twin:response",
      eyebrow: "Signal",
      title: "Bias toward fresh high-match roles",
      detail: "Response quality is weak right now, so Apex should cut marginal roles and focus on high-fit openings with fresher demand.",
      impact: "Improves the chance that today’s work changes response quality rather than adding more low-return applications.",
      query: "Show recent high-match jobs only and explain which ones deserve action first",
    })
  }

  if (pipelineMomentum !== null && pipelineMomentum <= 40) {
    items.push({
      id: "twin:pipeline",
      eyebrow: "Stabilize",
      title: "Triage the pipeline before expanding search",
      detail: "Momentum is soft enough that Apex should identify whether the next win comes from follow-up, refinement, or a new application.",
      impact: "Prevents busywork by forcing the next move to come from the most leverage point in the current funnel.",
      query: "Review my active applications and tell me the best next move before I broaden the search",
    })
  }

  if (sponsorshipConstraint !== null && sponsorshipConstraint >= 60) {
    items.push({
      id: "twin:sponsorship",
      eyebrow: "Constraint",
      title: "Tighten to sponsorship-friendly employers",
      detail: "Sponsorship is still a material constraint, so Apex should protect time by pushing friendly employers up the queue.",
      impact: "Raises practical odds by removing roles that look good on paper but are structurally less likely to convert.",
      query: "Show sponsorship-friendly roles matching my current lane and rank them by likelihood",
    })
  }

  const twinFocus = twin.recommendedFocus[0]
  if (twinFocus) {
    items.push({
      id: "twin:focus",
      eyebrow: "Twin Focus",
      title: twinFocus,
      detail: "This is the top operating focus the current Twin model wants Apex to enforce today.",
      impact: "Turns the user model into an explicit daily priority instead of leaving it buried in diagnostics.",
      query: `Turn this Career Twin focus into an action plan: ${twinFocus}`,
    })
  }

  return {
    items,
    activeLimit,
    contextNote,
  }
}

function strategyItems(board: ApexStrategyBoard | null, nudges: ApexNudge[], hasData: boolean): TodayPlanItem[] {
  const items: TodayPlanItem[] = []

  for (const focus of board?.todayFocus.slice(0, 2) ?? []) {
    items.push({
      id: `focus:${focus}`,
      eyebrow: "Priority",
      title: focus,
      detail: "Apex flagged this as one of the highest-leverage moves for today.",
      impact: "Keeps your search aligned to the strongest lane Apex currently sees instead of reacting to random noise.",
      query: `Help me execute this priority: ${focus}`,
    })
  }

  for (const move of board?.nextMoves ?? []) {
    if (items.length >= 3) break
    items.push({
      id: `move:${move.id}`,
      eyebrow: "Next Move",
      title: move.title,
      detail: move.description,
      impact: "Turns strategy into immediate execution so today produces movement instead of more planning.",
      query: `Let's execute this next move: ${move.title}`,
    })
  }

  for (const nudge of nudges) {
    if (items.length >= 3) break
    items.push({
      id: `nudge:${nudge.id}`,
      eyebrow: nudge.severity === "warning" ? "Risk" : nudge.severity === "opportunity" ? "Opportunity" : "Signal",
      title: nudge.title,
      detail: nudge.description,
      impact: "Addresses a live risk or opportunity Apex detected in your current search behavior.",
      query: `Help me act on this: ${nudge.title}`,
    })
  }

  if (items.length > 0) return items.slice(0, 3)

  if (hasData) {
    return [
      {
        id: "default-search",
        eyebrow: "Priority",
        title: "Re-rank my strongest open opportunities",
        detail: "Start from the jobs and applications already in your system before broadening the search.",
        impact: "Cuts wasted effort by making the best current opportunities visible first.",
        query: "Show jobs worth my time and rank them by fit",
      },
      {
        id: "default-compare",
        eyebrow: "Next Move",
        title: "Pressure-test the top saved roles",
        detail: "Apex should narrow the field and explain which role deserves effort today.",
        impact: "Prevents split attention across similar roles and concentrates effort on the best upside.",
        query: "Compare my top saved jobs and pick the best one",
      },
      {
        id: "default-tailor",
        eyebrow: "Execution",
        title: "Prepare one tailored application",
        detail: "Convert analysis into output by drafting the next strongest application package.",
        impact: "Creates a tangible pipeline step instead of leaving strong opportunities idle.",
        query: "Tailor my resume for my strongest match",
      },
    ]
  }

  return [
    {
      id: "fresh-plan",
      eyebrow: "Start",
      title: "Build today’s search plan",
      detail: "Let Apex establish a realistic route based on your profile before chasing volume.",
      impact: "Gives the day a structure before you spend effort on low-conviction roles.",
      query: "Create a practical search plan for me",
    },
    {
      id: "fresh-sponsorship",
      eyebrow: "Constraint",
      title: "Filter for sponsorship-friendly roles",
      detail: "Reduce wasted effort by targeting employers with stronger visa signals first.",
      impact: "Improves odds by focusing on openings that better fit your hardest constraint.",
      query: "Find sponsorship-friendly roles matching my profile",
    },
    {
      id: "fresh-apply",
      eyebrow: "Automation",
      title: "Set up 1-click apply rules",
      detail: "Define the lane once so Apex can prepare high-fit applications for review.",
      impact: "Turns repeated filtering work into a reusable operating rule Apex can execute with you.",
      query: "Set up 1-click apply for my top matches",
    },
  ]
}

export function buildTodayPlanModel({
  board,
  nudges,
  hasData,
  twin,
  history = [],
}: BuildTodayPlanModelArgs): TodayPlanModel {
  const twinModel = adaptiveTwinItems(twin, history)
  const baseItems = strategyItems(board, nudges, hasData)
  const items = dedupeItems([...twinModel.items, ...baseItems]).slice(0, twinModel.activeLimit)

  return {
    items,
    activeLimit: twinModel.activeLimit,
    contextNote: twinModel.contextNote,
  }
}

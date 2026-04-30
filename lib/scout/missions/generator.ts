/**
 * Scout Daily Mission Generator — deterministic, zero AI calls.
 *
 * Generates 1–3 focused daily missions from existing context data
 * already fetched by the shell (strategy board, behavior signals,
 * market signals, search profile). No DB queries, no LLM calls.
 *
 * Rules:
 *   - Max 3 missions per day
 *   - Ordered: high → medium → low priority
 *   - Never shame or fake urgency
 *   - Every mission must be actionable
 */

import type { ScoutMission, ScoutMissionType } from "./types"
import type { ScoutStrategyBoard } from "@/lib/scout/types"
import type { ScoutBehaviorSignals } from "@/lib/scout/behavior"
import type { MarketSignal } from "@/lib/scout/market-intelligence"
import type { ScoutSearchProfile } from "@/lib/scout/search-profile"

export type MissionContext = {
  board:         ScoutStrategyBoard | null
  signals:       ScoutBehaviorSignals | null
  marketSignals: MarketSignal[]
  searchProfile: ScoutSearchProfile | null
  hasResume:     boolean
}

type MissionCandidate = Omit<ScoutMission, "generatedAt" | "status">

const MAX_MISSIONS = 3

function makeId(type: ScoutMissionType, suffix: string): string {
  return `mission-${type}-${suffix}`
}

// ── Individual rule functions ──────────────────────────────────────────────────

function bulkApplicationMission(ctx: MissionContext): MissionCandidate | null {
  const saved = ctx.board?.snapshot.savedJobs ?? 0
  if (saved < 2) return null

  const velocity = ctx.signals?.recentApplicationVelocity ?? "none"
  const priority = velocity === "none" ? "high" : velocity === "low" ? "medium" : "low"

  const topRole = ctx.signals?.preferredRoles?.[0]
  const rolePhrase = topRole ? ` ${topRole}` : ""
  const countStr = saved >= 8 ? "your top 5" : saved >= 4 ? "3–4" : "a few"

  return {
    id:       makeId("applications", "bulk"),
    type:     "applications",
    title:    `Prepare ${countStr} applications today`,
    summary:  `You have ${saved} saved job${saved !== 1 ? "s" : ""}${rolePhrase ? ` in ${rolePhrase} and related areas` : ""}. Queue and prepare them now, then review each before submitting.`,
    priority,
    suggestedActions: [`Prepare applications for my top ${saved >= 5 ? "5" : "3"} saved jobs`],
  }
}

function followUpMission(ctx: MissionContext): MissionCandidate | null {
  const active = ctx.board?.snapshot.activeApplications ?? 0
  if (active === 0) return null

  return {
    id:       makeId("follow_up", "pipeline"),
    type:     "follow_up",
    title:    `Follow up on ${active} active application${active !== 1 ? "s" : ""}`,
    summary:  `You have ${active} application${active !== 1 ? "s" : ""} in progress. Check for updates and identify any that need a follow-up message.`,
    priority: "medium",
    suggestedActions: ["Which of my applications need attention or a follow-up?"],
  }
}

function compareMission(ctx: MissionContext): MissionCandidate | null {
  const saved = ctx.board?.snapshot.savedJobs ?? 0
  if (saved < 3) return null

  const topRole = ctx.signals?.preferredRoles?.[0]
  const rolePhrase = topRole ? ` ${topRole}` : " backend"

  return {
    id:       makeId("compare", "saved-jobs"),
    type:     "compare",
    title:    "Compare your top saved matches",
    summary:  `${saved} saved roles ready to rank. Scout will compare by match score, sponsorship signal, and role fit so you know where to focus first.`,
    priority: "medium",
    suggestedActions: [`Compare my saved${rolePhrase} jobs and tell me which to apply to first`],
  }
}

function resumeTailorMission(ctx: MissionContext): MissionCandidate | null {
  if (!ctx.hasResume) return null
  const topRole = ctx.signals?.preferredRoles?.[0] ?? ctx.searchProfile?.preferredRoles?.[0]
  if (!topRole) return null

  const avgScore = ctx.board?.snapshot.averageMatchScore
  const scoreContext = typeof avgScore === "number" && avgScore < 70
    ? ` Average match score is ${avgScore}% — a tailored resume could improve your fit significantly.`
    : ""

  return {
    id:       makeId("resume", "tailor"),
    type:     "resume",
    title:    `Tailor your resume for ${topRole} roles`,
    summary:  `${topRole} roles are a strong focus for you.${scoreContext} Tailor once and reuse across similar applications.`,
    priority: "medium",
    suggestedActions: [`Tailor my resume for ${topRole} roles and show me what to change`],
  }
}

function marketResearchMission(ctx: MissionContext): MissionCandidate | null {
  const spike = ctx.marketSignals.find(
    (s) => s.type === "hiring_spike" && s.severity === "positive"
  )
  if (!spike) return null

  const role = spike.relatedRoles?.[0] ?? "your target roles"
  return {
    id:       makeId("market_research", spike.id),
    type:     "market_research",
    title:    `Review active hiring in ${role}`,
    summary:  spike.summary,
    priority: "low",
    suggestedActions: [`Find ${role} roles posted in the last week that sponsor H-1B`],
  }
}

function sponsorshipMission(ctx: MissionContext): MissionCandidate | null {
  const sensitivity = ctx.signals?.sponsorshipSensitivity
  if (sensitivity !== "high") return null

  const workMode = ctx.searchProfile?.preferredWorkModes?.[0] ?? "remote"

  return {
    id:       makeId("market_research", "sponsorship"),
    type:     "market_research",
    title:    "Find visa-friendly roles",
    summary:  "Filter for companies with confirmed H-1B sponsorship and strong LCA filing history — the highest-quality targets for your situation.",
    priority: "high",
    suggestedActions: [`Find ${workMode} roles where companies explicitly sponsor H-1B visas`],
  }
}

function missingResumeMission(ctx: MissionContext): MissionCandidate | null {
  if (ctx.hasResume) return null
  return {
    id:       makeId("resume", "upload"),
    type:     "resume",
    title:    "Upload your resume to unlock AI tailoring",
    summary:  "Scout can tailor your resume for specific roles, analyze match scores, and prep cover letters — all require a resume in your library.",
    priority: "high",
    suggestedActions: ["How do I upload my resume to Hireoven?"],
  }
}

// ── Momentum line ──────────────────────────────────────────────────────────────

export function buildMomentumLine(ctx: MissionContext): string | undefined {
  const velocity = ctx.signals?.recentApplicationVelocity
  const recentApps = ctx.board?.snapshot.recentApplications ?? 0
  const topRole = ctx.signals?.preferredRoles?.[0]
  const avgScore = ctx.board?.snapshot.averageMatchScore

  const lines: string[] = []

  if (velocity === "healthy" && recentApps > 0) {
    lines.push(`You've submitted ${recentApps} application${recentApps !== 1 ? "s" : ""} recently — solid momentum.`)
  } else if (velocity === "none" && (ctx.board?.snapshot.savedJobs ?? 0) > 0) {
    lines.push("You have saved jobs ready to go — today is a good day to queue a few applications.")
  }

  if (topRole && typeof avgScore === "number" && avgScore >= 75) {
    lines.push(`Your strongest matches are in ${topRole} roles.`)
  }

  const hiringSpike = ctx.marketSignals.find((s) => s.type === "hiring_spike" && s.severity === "positive")
  if (hiringSpike && lines.length === 0) {
    lines.push(hiringSpike.summary)
  }

  return lines.length > 0 ? lines.join(" ") : undefined
}

// ── Main generator ─────────────────────────────────────────────────────────────

export function generateDailyMissions(ctx: MissionContext): ScoutMission[] {
  const now = new Date().toISOString()

  const candidates: MissionCandidate[] = []

  // Priority order: highest-impact rules first
  const rules = [
    missingResumeMission,      // blocker — always first if no resume
    sponsorshipMission,        // high priority for visa-sensitive users
    bulkApplicationMission,    // primary action driver
    followUpMission,           // maintain pipeline
    compareMission,            // helps prioritize
    resumeTailorMission,       // quality improvement
    marketResearchMission,     // discovery
  ]

  for (const rule of rules) {
    if (candidates.length >= MAX_MISSIONS) break
    const candidate = rule(ctx)
    if (!candidate) continue
    // Deduplicate by type — one mission per type
    if (candidates.some((c) => c.type === candidate.type)) continue
    candidates.push(candidate)
  }

  // Sort: high → medium → low
  const ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }
  candidates.sort((a, b) => (ORDER[a.priority] ?? 1) - (ORDER[b.priority] ?? 1))

  return candidates.slice(0, MAX_MISSIONS).map((c) => ({
    ...c,
    status:      "pending" as const,
    generatedAt: now,
  }))
}

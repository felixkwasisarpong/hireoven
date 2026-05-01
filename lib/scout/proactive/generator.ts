import type { MarketSignal } from "@/lib/scout/market-intelligence"
import type { OutcomeLearningResult } from "@/lib/scout/outcomes/types"
import type { ScoutSearchProfile } from "@/lib/scout/search-profile"
import type { ScoutBehaviorSignals } from "@/lib/scout/behavior"
import type { ScoutActiveWorkflow } from "@/lib/scout/workflows/types"
import type { BulkApplicationQueue } from "@/lib/scout/bulk-application/types"
import type { ScoutProactiveEvent, ScoutProactiveSnapshot } from "./types"

export type ProactiveGeneratorInput = {
  snapshot: ScoutProactiveSnapshot | null
  marketSignals: MarketSignal[]
  outcomeLearning: OutcomeLearningResult | null
  searchProfile: ScoutSearchProfile | null
  behaviorSignals: ScoutBehaviorSignals | null
  activeWorkflow: ScoutActiveWorkflow | null
  bulkQueue: BulkApplicationQueue | null
  now?: Date
}

const SEVERITY_WEIGHT: Record<ScoutProactiveEvent["severity"], number> = {
  urgent: 0,
  important: 1,
  info: 2,
}

function addHours(iso: string, hours: number): string {
  const ms = new Date(iso).getTime()
  return new Date(ms + hours * 60 * 60 * 1000).toISOString()
}

function daysOld(iso: string): number {
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000))
}

function idFrom(type: ScoutProactiveEvent["type"], seed: string, dayKey: string): string {
  const safe = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "event"
  return `pe-${type}-${safe}-${dayKey}`
}

function topRoleHint(
  searchProfile: ScoutSearchProfile | null,
  behaviorSignals: ScoutBehaviorSignals | null,
): string | null {
  return searchProfile?.preferredRoles?.[0] ?? behaviorSignals?.preferredRoles?.[0] ?? null
}

export function generateProactiveEvents(input: ProactiveGeneratorInput): ScoutProactiveEvent[] {
  const now = input.now ?? new Date()
  const createdAt = now.toISOString()
  const dayKey = createdAt.slice(0, 10)
  const events: ScoutProactiveEvent[] = []

  const roleHint = topRoleHint(input.searchProfile, input.behaviorSignals)
  const snapshot = input.snapshot

  // 1) New high-match opportunities
  if (snapshot && snapshot.highMatches.length > 0) {
    const count = snapshot.highMatches.length
    const top = snapshot.highMatches[0]
    const roleLabel = roleHint ? `${roleHint} ` : ""
    events.push({
      id: idFrom("new_match", `${top.jobId}-${count}`, dayKey),
      type: "new_match",
      title: `Scout found ${count} new ${roleLabel}match${count === 1 ? "" : "es"}`.replace(/\s+/g, " ").trim(),
      summary:
        count === 1
          ? `${top.jobTitle}${top.companyName ? ` at ${top.companyName}` : ""} is a strong fit (${top.matchScore}% match).`
          : `${count} newly detected roles score highly against your profile. Top match: ${top.jobTitle}${top.companyName ? ` at ${top.companyName}` : ""}.`,
      severity: count >= 4 ? "important" : "info",
      relatedJobId: top.jobId,
      relatedCompanyId: top.companyId,
      createdAt,
      expiresAt: addHours(createdAt, 24),
    })
  }

  // 2) Sponsorship-friendly matches (personalized by sponsorship sensitivity)
  if (
    snapshot &&
    snapshot.sponsorshipFriendlyMatchCount > 0 &&
    input.behaviorSignals?.sponsorshipSensitivity !== "low"
  ) {
    const count = snapshot.sponsorshipFriendlyMatchCount
    events.push({
      id: idFrom("sponsorship_signal", `friendly-${count}`, dayKey),
      type: "sponsorship_signal",
      title: `Scout found ${count} sponsorship-friendly opening${count === 1 ? "" : "s"}`,
      summary: `These roles align with your sponsorship preferences and recent fit signals.`,
      severity: count >= 3 ? "important" : "info",
      createdAt,
      expiresAt: addHours(createdAt, 24),
    })
  }

  // 3) Stale saved jobs
  if (snapshot && snapshot.staleSavedJobs.length > 0) {
    const stale = snapshot.staleSavedJobs[0]
    const count = snapshot.staleSavedJobs.length
    events.push({
      id: idFrom("stale_saved_job", `${stale.applicationId}-${count}`, dayKey),
      type: "stale_saved_job",
      title: count === 1
        ? "A saved role may become stale soon"
        : `${count} saved roles may become stale soon`,
      summary: `${stale.jobTitle} at ${stale.companyName} has been saved for ${stale.daysOld} days.`,
      severity: stale.daysOld >= 21 ? "important" : "info",
      relatedJobId: stale.jobId,
      createdAt,
      expiresAt: addHours(createdAt, 36),
    })
  }

  // 4) Workflow paused for too long
  const pausedAt = input.activeWorkflow?.pausedAt
  if (input.activeWorkflow && pausedAt && daysOld(pausedAt) >= 0) {
    const pausedMs = Date.now() - new Date(pausedAt).getTime()
    if (pausedMs >= 90 * 60 * 1000) {
      events.push({
        id: idFrom("workflow_reminder", `${input.activeWorkflow.id}-${input.activeWorkflow.activeStepId ?? "step"}`, dayKey),
        type: "workflow_reminder",
        title: `Workflow paused: ${input.activeWorkflow.title}`,
        summary: "You can resume where you left off when you're ready.",
        severity: pausedMs >= 6 * 60 * 60 * 1000 ? "important" : "info",
        createdAt,
        expiresAt: addHours(createdAt, 48),
      })
    }
  }

  // 5) Queue ready for review
  if (input.bulkQueue) {
    const ready = input.bulkQueue.jobs.filter((j) => j.status === "ready" || j.status === "needs_review")
    if (ready.length > 0) {
      const first = ready[0]
      events.push({
        id: idFrom("queue_ready", `${input.bulkQueue.id}-${ready.length}`, dayKey),
        type: "queue_ready",
        title: `${ready.length} application${ready.length === 1 ? "" : "s"} ready for review`,
        summary: `${first.jobTitle}${first.company ? ` at ${first.company}` : ""} is ready in your preparation queue.`,
        severity: ready.length >= 3 ? "important" : "info",
        relatedJobId: first.jobId,
        createdAt,
        expiresAt: addHours(createdAt, 18),
      })
    }
  }

  // 6) Follow-up recommendations
  if (snapshot && snapshot.followUpCandidates.length > 0) {
    const top = snapshot.followUpCandidates[0]
    const count = snapshot.followUpCandidates.length
    events.push({
      id: idFrom("application_followup", `${top.applicationId}-${top.urgency}-${count}`, dayKey),
      type: "application_followup",
      title: count === 1
        ? "An application may need follow-up"
        : `${count} applications may need follow-up`,
      summary: `${top.jobTitle} at ${top.companyName} is ${top.daysStale} days since last activity.`,
      severity: top.urgency === "high" ? "urgent" : "important",
      relatedJobId: top.jobId,
      createdAt,
      expiresAt: addHours(createdAt, 24),
    })
  }

  // 7) Interview reminders
  if (snapshot && snapshot.interviewsSoon.length > 0) {
    const soonest = [...snapshot.interviewsSoon].sort((a, b) => a.hoursUntil - b.hoursUntil)[0]
    const urgency: ScoutProactiveEvent["severity"] =
      soonest.hoursUntil <= 12 ? "urgent" : soonest.hoursUntil <= 36 ? "important" : "info"
    events.push({
      id: idFrom("interview_reminder", `${soonest.applicationId}-${soonest.roundName}`, dayKey),
      type: "interview_reminder",
      title: `Interview reminder: ${soonest.roundName}`,
      summary: `${soonest.jobTitle} at ${soonest.companyName} is coming up in ~${soonest.hoursUntil}h.`,
      severity: urgency,
      relatedJobId: soonest.jobId,
      relatedCompanyId: soonest.companyId,
      createdAt,
      expiresAt: addHours(createdAt, 16),
    })
  }

  // 8) Market shifts (derived from existing market intelligence)
  const primaryMarketShift = input.marketSignals.find(
    (s) => s.severity === "warning" || s.type === "hiring_spike" || s.type === "market_cooling"
  )
  if (primaryMarketShift) {
    events.push({
      id: idFrom("market_shift", primaryMarketShift.id, dayKey),
      type: "market_shift",
      title: primaryMarketShift.title,
      summary: primaryMarketShift.summary,
      severity: primaryMarketShift.severity === "warning" ? "important" : "info",
      createdAt,
      expiresAt: addHours(createdAt, 30),
    })
  }

  // 9) Company activity spikes
  if (snapshot && snapshot.companySpikes.length > 0) {
    const spike = snapshot.companySpikes[0]
    events.push({
      id: idFrom("company_activity", `${spike.companyId}-${spike.freshRoleCount}`, dayKey),
      type: "company_activity",
      title: `${spike.companyName} shows fresh hiring activity`,
      summary: `${spike.freshRoleCount} new role${spike.freshRoleCount === 1 ? "" : "s"} posted recently in your target pool.`,
      severity: spike.freshRoleCount >= 4 ? "important" : "info",
      relatedCompanyId: spike.companyId,
      createdAt,
      expiresAt: addHours(createdAt, 24),
    })
  }

  // 10) Skill opportunities (gap signals from market demand)
  if (snapshot && snapshot.skillGaps.length > 0) {
    const gap = snapshot.skillGaps[0]
    events.push({
      id: idFrom("skill_signal", `${gap.skill}-${gap.demandCount}`, dayKey),
      type: "skill_signal",
      title: `${gap.skill} appears frequently in your strongest matches`,
      summary: `${gap.skill} shows up in ${gap.demandCount} relevant active postings. Strengthening this skill may expand your options.`,
      severity: gap.demandCount >= 8 ? "important" : "info",
      createdAt,
      expiresAt: addHours(createdAt, 72),
    })
  }

  // 11) V2 outcome learning — traction, sector, sponsorship, workflow signals
  // Each dimension generates its own targeted event. Capped at 2 to avoid flood.
  if (input.outcomeLearning?.signals.length) {
    let outcomeSlotsUsed = 0
    const MAX_OUTCOME_EVENTS = 2

    for (const sig of input.outcomeLearning.signals) {
      if (outcomeSlotsUsed >= MAX_OUTCOME_EVENTS) break
      // Skip general momentum signals — they're already shown in the ApplicationMode panel
      if (sig.id === "momentum-up" || sig.id === "momentum-down") continue

      if (sig.dimension === "role_type" || sig.dimension === "work_mode") {
        events.push({
          id:       idFrom("skill_signal", `outcome-${sig.id}`, dayKey),
          type:     "skill_signal",
          title:    "Traction pattern detected",
          summary:  sig.signal,
          severity: sig.confidence === "high" ? "important" : "info",
          createdAt,
          expiresAt: addHours(createdAt, 48),
        })
        outcomeSlotsUsed++
      } else if (sig.dimension === "company_type") {
        events.push({
          id:       idFrom("company_activity", `outcome-${sig.id}`, dayKey),
          type:     "company_activity",
          title:    "Sector traction pattern",
          summary:  sig.signal,
          severity: sig.confidence === "high" ? "important" : "info",
          createdAt,
          expiresAt: addHours(createdAt, 48),
        })
        outcomeSlotsUsed++
      } else if (sig.dimension === "sponsorship") {
        events.push({
          id:       idFrom("sponsorship_signal", `outcome-${sig.id}`, dayKey),
          type:     "sponsorship_signal",
          title:    "Sponsorship response pattern",
          summary:  sig.signal,
          severity: sig.confidence === "high" ? "important" : "info",
          createdAt,
          expiresAt: addHours(createdAt, 48),
        })
        outcomeSlotsUsed++
      } else if (sig.dimension === "general" && !snapshot?.skillGaps.length) {
        // Only use general signals as fallback when no skill gap data
        events.push({
          id:       idFrom("skill_signal", `outcome-${sig.id}`, dayKey),
          type:     "skill_signal",
          title:    "Application pattern insight",
          summary:  sig.signal,
          severity: sig.confidence === "high" ? "important" : "info",
          createdAt,
          expiresAt: addHours(createdAt, 24),
        })
        outcomeSlotsUsed++
      }
    }
  }

  // Prioritize high-signal events and cap visible generation payload.
  return events
    .sort((a, b) => {
      const aw = SEVERITY_WEIGHT[a.severity]
      const bw = SEVERITY_WEIGHT[b.severity]
      if (aw !== bw) return aw - bw
      const aMs = new Date(a.createdAt).getTime()
      const bMs = new Date(b.createdAt).getTime()
      return bMs - aMs
    })
    .slice(0, 10)
}

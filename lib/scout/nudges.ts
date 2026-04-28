/**
 * Scout Nudges — Phase 2.4: Proactive, deterministic surface hints.
 *
 * All nudges are computed from existing data with zero AI calls.
 * No DB writes, no destructive actions, no autonomous execution.
 */

import type { ScoutMode, ScoutAction, ScoutStrategyBoard } from "@/lib/scout/types"
import type { ScoutBehaviorSignals } from "@/lib/scout/behavior"

export type ScoutNudgeSeverity = "info" | "warning" | "opportunity"

export type ScoutNudge = {
  id: string
  title: string
  description: string
  severity: ScoutNudgeSeverity
  /** Optional safe action the user can choose to execute */
  action?: ScoutAction
}

export type ScoutNudgeOptions = {
  /** Whether Focus Mode is currently active on the feed */
  isFocusMode?: boolean
  /** Primary resume ID — used to generate tailor actions when relevant */
  resumeId?: string | null
}

// Maximum nudges surfaced at once — keeps the UI uncluttered
const MAX_NUDGES = 3

/**
 * Returns up to MAX_NUDGES deterministic nudges based on:
 * - Current Scout mode (page context)
 * - Behavior signals inferred from user activity
 * - Strategy board snapshot, risks, and moves
 * - Optional overrides (focus mode state, resume ID)
 *
 * Nudges are ordered: warnings → opportunities → info.
 * Within each tier, more actionable nudges come first.
 */
export function getScoutNudges(
  mode: ScoutMode,
  signals: ScoutBehaviorSignals,
  board: ScoutStrategyBoard,
  opts: ScoutNudgeOptions = {}
): ScoutNudge[] {
  const { isFocusMode = false, resumeId } = opts
  const hasResume = !!resumeId

  const warnings: ScoutNudge[] = []
  const opportunities: ScoutNudge[] = []
  const info: ScoutNudge[] = []

  // ── Shared shortcuts ────────────────────────────────────────────────────
  const onScoutOrFeed = mode === "scout" || mode === "feed"
  const onScoutOrApps = mode === "scout" || mode === "applications"
  const velocityLow =
    signals.recentApplicationVelocity === "none" ||
    signals.recentApplicationVelocity === "low"
  const sponsorshipRisk = board.risks.find((r) => r.id === "sponsorship-uncertainty")

  // ── WARNINGS ────────────────────────────────────────────────────────────

  // Low / stalled application velocity with existing pipeline
  if (
    onScoutOrApps &&
    signals.recentApplicationVelocity === "none" &&
    board.snapshot.savedJobs > 0
  ) {
    warnings.push({
      id: "low-velocity",
      title: "Application pace is low",
      description:
        "No applications submitted in the last 14 days. Momentum may be dropping — consider targeting 1–2 roles this week.",
      severity: "warning",
    })
  }

  // Low average match scores (enough data to be meaningful)
  if (
    board.snapshot.averageMatchScore !== null &&
    board.snapshot.averageMatchScore < 55 &&
    board.snapshot.savedJobs > 0
  ) {
    warnings.push({
      id: "low-match-scores",
      title: "Recent match scores are low",
      description: `Average match score is ${board.snapshot.averageMatchScore}%. Tailoring your resume to target roles could significantly improve this.`,
      severity: "warning",
      action: hasResume
        ? {
            type: "OPEN_RESUME_TAILOR",
            payload: { resumeId: resumeId! },
            label: "Open resume tailor",
          }
        : undefined,
    })
  }

  // Sponsorship uncertainty in watchlist targets (high-sensitivity users only)
  if (sponsorshipRisk && signals.sponsorshipSensitivity === "high") {
    warnings.push({
      id: "sponsorship-uncertainty",
      title: "Sponsorship uncertainty in your targets",
      description: sponsorshipRisk.description,
      severity: "warning",
      action: {
        type: "APPLY_FILTERS",
        payload: { sponsorship: "high" },
        label: "Filter for high sponsorship",
      },
    })
  }

  // Missing resume context (blocks match scores and tailoring)
  if (board.risks.some((r) => r.id === "missing-resume-context") && !hasResume) {
    warnings.push({
      id: "missing-resume-context",
      title: "Resume context is missing",
      description:
        "Upload and parse a resume to unlock match scores, tailoring, and deeper Scout analysis.",
      severity: "warning",
    })
  }

  // ── OPPORTUNITIES ────────────────────────────────────────────────────────

  // Focus Mode is off — surface on Scout Home and feed mode
  if (onScoutOrFeed && !isFocusMode) {
    opportunities.push({
      id: "focus-mode-off",
      title: "Focus Mode is off",
      description:
        "Turn on Focus Mode to sort your feed by best match, recency, and sponsorship signals — cuts out the noise.",
      severity: "opportunity",
      action: {
        type: "SET_FOCUS_MODE",
        payload: { enabled: true, reason: "Sort feed by best match and sponsorship" },
        label: "Turn on Focus Mode",
      },
    })
  }

  // Saved jobs with no recent applications
  if (
    onScoutOrApps &&
    board.snapshot.savedJobs > 0 &&
    board.snapshot.recentApplications === 0
  ) {
    opportunities.push({
      id: "unapplied-saved-jobs",
      title: "Saved jobs with no applications",
      description: `You have ${board.snapshot.savedJobs} saved job${board.snapshot.savedJobs !== 1 ? "s" : ""} but no recent applications. Ready to start your pipeline?`,
      severity: "opportunity",
    })
  }

  // High sponsorship sensitivity + no sponsorship filter active (feed mode only)
  if (
    mode === "feed" &&
    signals.sponsorshipSensitivity === "high" &&
    !sponsorshipRisk // avoid duplicate with the sponsorship-uncertainty warning
  ) {
    opportunities.push({
      id: "sponsorship-filter",
      title: "No sponsorship filter active",
      description:
        "You often focus on sponsorship-friendly roles. Filter by high sponsorship to reduce noise in your feed.",
      severity: "opportunity",
      action: {
        type: "APPLY_FILTERS",
        payload: { sponsorship: "high" },
        label: "Filter by sponsorship",
      },
    })
  }

  // Good momentum — healthy velocity but low average match (opportunity to tighten targeting)
  if (
    onScoutOrFeed &&
    signals.recentApplicationVelocity === "healthy" &&
    board.snapshot.averageMatchScore !== null &&
    board.snapshot.averageMatchScore < 65
  ) {
    opportunities.push({
      id: "high-velocity-low-match",
      title: "Applying fast but match scores are modest",
      description:
        "High application velocity is great — but match scores suggest you may be casting too wide. Focus on better-fit roles.",
      severity: "opportunity",
    })
  }

  // ── INFO ────────────────────────────────────────────────────────────────

  // Resume not set up (info level when no board risk is present)
  if (!hasResume && (mode === "scout" || mode === "resume")) {
    info.push({
      id: "missing-resume",
      title: "Resume not uploaded",
      description:
        "Add a resume to unlock match scores, tailoring suggestions, and deeper Scout guidance.",
      severity: "info",
    })
  }

  // Active pipeline but no recent applications (stale follow-up signal)
  if (
    mode === "applications" &&
    board.snapshot.activeApplications > 3 &&
    velocityLow
  ) {
    info.push({
      id: "stale-pipeline",
      title: "Active pipeline may need a follow-up",
      description: `You have ${board.snapshot.activeApplications} active applications but haven't applied recently. Consider following up.`,
      severity: "info",
    })
  }

  // Incomplete profile preferences
  if (
    mode === "scout" &&
    board.risks.some((r) => r.id === "empty-preferences") &&
    signals.preferredRoles.length === 0
  ) {
    info.push({
      id: "empty-preferences",
      title: "Search preferences are incomplete",
      description:
        "Add desired roles and locations to your profile to improve job ranking and filter quality.",
      severity: "info",
    })
  }

  // Combine in priority order: warnings → opportunities → info
  return [...warnings, ...opportunities, ...info].slice(0, MAX_NUDGES)
}

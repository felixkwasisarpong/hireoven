import { getPostgresPool } from "@/lib/postgres/server"
import type { BurnoutState } from "./classifier"

export type InterventionResult = {
  message: string
  subtext: string | null
  ctaLabel: string
  ctaQuery: string
  tone: "warm" | "direct" | "soft"
  suppressBulkApply: boolean
  missionCountOverride: number | null
  showMaxJobs: number | null
  returnReminder: boolean
}

const INTERVENTION_DISMISSED_TTL_HOURS = 24

export async function executeIntervention(
  userId: string,
  burnoutState: BurnoutState
): Promise<InterventionResult> {
  const pool = getPostgresPool()

  // Check if this intervention was already shown recently (avoid spam)
  const recentResult = await pool.query<{ intervention_shown_at: string | null }>(
    `SELECT intervention_shown_at
     FROM public.user_burnout_states
     WHERE user_id = $1
       AND intervention_type = $2
       AND intervention_shown_at IS NOT NULL
       AND intervention_shown_at > NOW() - INTERVAL '${INTERVENTION_DISMISSED_TTL_HOURS} hours'
     ORDER BY classified_at DESC LIMIT 1`,
    [userId, burnoutState.interventionType]
  )

  const alreadyShownRecently = recentResult.rows.length > 0

  // Mark as shown
  if (!alreadyShownRecently) {
    await pool.query(
      `UPDATE public.user_burnout_states
       SET intervention_shown_at = now()
       WHERE user_id = $1
         AND intervention_type = $2
         AND intervention_shown_at IS NULL
       ORDER BY classified_at DESC NULLS LAST
       LIMIT 1`,
      [userId, burnoutState.interventionType]
    ).catch(() => {})
  }

  // Pull application stats for context
  const statsResult = await pool.query<{
    saved_count: string
    active_count: string
    top_role: string | null
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'saved')::text AS saved_count,
       COUNT(*) FILTER (WHERE status NOT IN ('saved', 'rejected', 'withdrawn'))::text AS active_count,
       mode() WITHIN GROUP (ORDER BY job_title) AS top_role
     FROM job_applications
     WHERE user_id = $1 AND is_archived = false`,
    [userId]
  )
  const stats = statsResult.rows[0]
  const savedCount = parseInt(stats?.saved_count ?? "0", 10)
  const activeCount = parseInt(stats?.active_count ?? "0", 10)
  const topRole = stats?.top_role ?? "roles you care about"

  // Pull outcome learning for strategy reset
  let topPerformingType = ""
  if (burnoutState.interventionType === "strategy_reset") {
    const outcomeResult = await pool.query<{ job_title: string; pos_rate: string }>(
      `SELECT job_title, ROUND(AVG(CASE WHEN status IN ('phone_screen','interview','final_round','offer') THEN 1.0 ELSE 0.0 END) * 100)::text AS pos_rate
       FROM job_applications
       WHERE user_id = $1 AND is_archived = false AND status != 'saved'
       GROUP BY job_title
       HAVING COUNT(*) >= 2
       ORDER BY AVG(CASE WHEN status IN ('phone_screen','interview','final_round','offer') THEN 1.0 ELSE 0.0 END) DESC
       LIMIT 1`,
      [userId]
    )
    topPerformingType = outcomeResult.rows[0]?.job_title ?? topRole
  }

  switch (burnoutState.interventionType) {
    case "gentle_nudge": {
      if (burnoutState.state === "anxious") {
        return {
          message: "You've been applying broadly. Focusing on your strongest matches tends to get better results.",
          subtext: "Based on your profile, your top matches have a much higher response rate than broad applications.",
          ctaLabel: "Show my top 5 matches",
          ctaQuery: "Show me the 5 roles that match me best right now",
          tone: "warm",
          suppressBulkApply: true,
          missionCountOverride: null,
          showMaxJobs: 5,
          returnReminder: false,
        }
      }
      return {
        message: "Your pace has eased up a little. Want me to find a few strong matches to apply to today?",
        subtext: savedCount > 0 ? `You have ${savedCount} saved ${savedCount === 1 ? "role" : "roles"} already waiting.` : null,
        ctaLabel: "Find 3 strong matches",
        ctaQuery: "Find 3 roles that match me well and are worth applying to today",
        tone: "warm",
        suppressBulkApply: false,
        missionCountOverride: null,
        showMaxJobs: null,
        returnReminder: false,
      }
    }

    case "reframe": {
      return {
        message: `Here's what's working in your search: ${topRole} applications have been your strongest. One clear focus for this week: ${savedCount > 0 ? "pick 2–3 of your saved roles and apply" : "add 3 strong roles to your saved list and apply today"}.`,
        subtext: activeCount > 0 ? `You have ${activeCount} active application${activeCount !== 1 ? "s" : ""} in progress — momentum is still there.` : null,
        ctaLabel: "Reset my focus for this week",
        ctaQuery: "Help me refocus my job search for this week with a clear plan",
        tone: "direct",
        suppressBulkApply: false,
        missionCountOverride: 2,
        showMaxJobs: null,
        returnReminder: false,
      }
    }

    case "rest_suggestion": {
      return {
        message: "Job searching is genuinely hard work. Taking time to recharge is not quitting — it often leads to better outcomes. Come back when you feel ready.",
        subtext: savedCount > 0 ? `Your ${savedCount} saved role${savedCount !== 1 ? "s" : ""} will be here when you return.` : "Your pipeline is here whenever you're ready.",
        ctaLabel: "I'm ready to pick back up",
        ctaQuery: "I'm ready to get back to my job search — what should I focus on?",
        tone: "soft",
        suppressBulkApply: true,
        missionCountOverride: 2,
        showMaxJobs: 5,
        returnReminder: true,
      }
    }

    case "strategy_reset": {
      return {
        message: `Looking at your application history, ${topPerformingType} roles have had the strongest outcomes. Want to refocus your search there and rebuild a shorter, sharper target list?`,
        subtext: "A focused list of 10 strong-fit roles typically outperforms broad applying.",
        ctaLabel: "Run a strategy reset",
        ctaQuery: `Audit my recent applications and help me refocus on ${topPerformingType} roles with a clear target list`,
        tone: "direct",
        suppressBulkApply: false,
        missionCountOverride: 2,
        showMaxJobs: 10,
        returnReminder: false,
      }
    }

    case "emergency_reengagement": {
      return {
        message: `Your search is paused. You have ${savedCount} saved role${savedCount !== 1 ? "s" : ""}${activeCount > 0 ? ` and ${activeCount} application${activeCount !== 1 ? "s" : ""} in progress` : ""}. Ready to pick up where you left off?`,
        subtext: null,
        ctaLabel: "Show me what's new",
        ctaQuery: "Show me what's changed since I was last here and what I should focus on first",
        tone: "warm",
        suppressBulkApply: false,
        missionCountOverride: 2,
        showMaxJobs: 5,
        returnReminder: false,
      }
    }

    default:
      return {
        message: burnoutState.recommendation,
        subtext: null,
        ctaLabel: "What should I focus on today?",
        ctaQuery: "What should I focus on in my job search today?",
        tone: "warm",
        suppressBulkApply: false,
        missionCountOverride: null,
        showMaxJobs: null,
        returnReminder: false,
      }
  }
}

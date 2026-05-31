/**
 * Apex Feature Flags — V1
 *
 * Environment-variable driven feature flags for controlled rollout.
 * All flags default to ENABLED (opt-out pattern) so existing deployments
 * are unaffected. Set the env var to "false" to disable a feature.
 *
 * Usage:
 *   import { APEX_FLAGS } from "@/lib/apex/flags"
 *   if (!APEX_FLAGS.browserOperatorEnabled) return null
 *
 * All vars must be NEXT_PUBLIC_ prefixed so client components can read them.
 * Server-side guards use the same values (no secret exposure risk).
 */

function flag(envKey: string, defaultEnabled = true): boolean {
  const val = process.env[envKey]
  if (val === undefined || val === "") return defaultEnabled
  return val !== "false" && val !== "0"
}

export const APEX_FLAGS = {
  /** Master switch: disable to fall back to the legacy Apex page */
  apexOsEnabled:           flag("NEXT_PUBLIC_APEX_OS_ENABLED"),
  /** Extension postMessage bridge (browser context + autofill relay) */
  extensionBridgeEnabled:   flag("NEXT_PUBLIC_APEX_EXTENSION_BRIDGE_ENABLED"),
  /** Supervised browser operator (autofill dispatch, field focus, etc.) */
  browserOperatorEnabled:   flag("NEXT_PUBLIC_APEX_BROWSER_OPERATOR_ENABLED"),
  /** Bulk application queue */
  bulkQueueEnabled:         flag("NEXT_PUBLIC_APEX_BULK_QUEUE_ENABLED"),
  /** Autonomous research mode */
  researchModeEnabled:      flag("NEXT_PUBLIC_APEX_RESEARCH_MODE_ENABLED"),
  /** Career strategy engine */
  careerStrategyEnabled:    flag("NEXT_PUBLIC_APEX_CAREER_STRATEGY_ENABLED"),
  /** Interview copilot workspace */
  interviewCopilotEnabled:  flag("NEXT_PUBLIC_APEX_INTERVIEW_COPILOT_ENABLED"),
  /** Recruiter outreach copilot */
  outreachCopilotEnabled:   flag("NEXT_PUBLIC_APEX_OUTREACH_COPILOT_ENABLED"),
  /** Timeline + session replay panel */
  timelineEnabled:          flag("NEXT_PUBLIC_APEX_TIMELINE_ENABLED"),
  /** Proactive companion events */
  proactiveEnabled:         flag("NEXT_PUBLIC_APEX_PROACTIVE_ENABLED"),
  /** Multi-agent orchestrator (parallel context agents before Claude) */
  orchestratorEnabled:      flag("NEXT_PUBLIC_APEX_ORCHESTRATOR_ENABLED"),
} as const

export type ApexFlagKey = keyof typeof APEX_FLAGS

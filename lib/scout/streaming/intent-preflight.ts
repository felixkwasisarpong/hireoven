/**
 * Pre-flight intent detection — runs CLIENT-SIDE, zero latency.
 *
 * When the user submits a command, we detect intent immediately and morph
 * the workspace before the network request starts. This creates the feeling
 * of instant responsiveness — the UI moves first, Claude catches up.
 *
 * Conservative: only morphs when confidence is high. Falls back to "idle"
 * (workspace stays put) when intent is ambiguous.
 */

import type { WorkspaceMode } from "@/lib/scout/workspace"

const COMPARE_RE    = /\b(compare|rank.*job|which.*apply.*first|side.?by.?side|shortlist)\b/i
const TAILOR_RE     = /\b(tailor|tailor.?my.?resume|tailor.*resume|open.*resume.?studio)\b/i
const BULK_PREP_RE  = /\b(prepare|queue|batch|bulk)\b.{0,80}\b(application[s]?|apply)\b/i
const WORKFLOW_RE   = /\b(workflow|step.?by.?step|roadmap|prepare.*application)\b/i
const SEARCH_RE     = /\b(find|search|show|filter|discover)\b.{0,40}\b(job[s]?|role[s]?|position[s]?)\b/i
const COMPANY_RE    = /\b(tell me about|does|what about|company|employer|sponsor)\b.{0,20}\b(sponsor|visa|h-?1b|hire|hiring)\b/i
const APPS_RE       = /\b(my applications?|pipeline|status|follow.?up|how am i doing|interview)\b/i
const RESEARCH_RE   = /^(research|analyze|analyse|investigate|find\s+companies|what\s+skills?)\b/i

/**
 * Returns the workspace mode to switch to immediately on submit,
 * or null if no confident match (workspace stays unchanged).
 */
export function detectPreflightMode(message: string): WorkspaceMode | null {
  const m = message.trim()
  if (!m) return null

  // Research takes highest priority (explicit research intent)
  if (RESEARCH_RE.test(m))  return "research"
  // Bulk prep takes priority over tailor (both match "prepare")
  if (BULK_PREP_RE.test(m)) return "bulk_application"
  if (TAILOR_RE.test(m))    return "tailor"
  if (COMPARE_RE.test(m))   return "compare"
  if (SEARCH_RE.test(m))    return "search"
  if (COMPANY_RE.test(m))   return "company"
  if (APPS_RE.test(m) || WORKFLOW_RE.test(m)) return "applications"

  return null
}

/**
 * Narrative strip shown while Claude is generating for each workspace mode.
 * Displayed immediately — replaced by actual Scout answer when stream completes.
 */
export const PREFLIGHT_NARRATIVE: Partial<Record<WorkspaceMode, string>> = {
  research:         "Initialising research — gathering evidence…",
  compare:          "Comparing your strongest saved jobs…",
  tailor:           "Preparing resume tailoring for this role…",
  search:           "Filtering the job feed for you…",
  company:          "Pulling company intelligence…",
  applications:     "Reviewing your application pipeline…",
  bulk_application: "Selecting your top matches for bulk preparation…",
}

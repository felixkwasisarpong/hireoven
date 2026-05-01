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
const BULK_PREP_RE  =
  /(?:\b(prepare|queue|batch|bulk)\b.{0,80}\b(application[s]?|apply)\b)|(?:\bapply\s+(?:to|for)\s+(?:(?:top|best|strongest|highest)\s+)?\d+\s+(?:(?:top|best|strongest|highest|matching|scored?)\s+){0,2}(?:jobs?|roles?|positions?|openings?|applications?))/i
const WORKFLOW_RE   = /\b(workflow|step.?by.?step|roadmap|prepare.*application)\b/i
const SEARCH_RE     = /\b(find|search|show|filter|discover)\b.{0,40}\b(job[s]?|role[s]?|position[s]?)\b/i
const COMPANY_RE    = /\b(tell me about|does|what about|company|employer|sponsor)\b.{0,20}\b(sponsor|visa|h-?1b|hire|hiring)\b/i
const APPS_RE           = /\b(my applications?|pipeline|status|follow.?up|how am i doing)\b/i
const INTERVIEW_PREP_RE = /\b(interview.?prep|prepare.{0,20}(for|interview)|what questions|how should i prepare|prep for (this|the)|ready for (this|the) interview)\b/i
const CAREER_RE     = /\b(career\s+(direction|path|strategy|pivot|plan)|best\s+(fit|direction|path)\s+for\s+my|where\s+should\s+i\s+(focus|go|head)|strongest\s+traction|what\s+(sector|domain|field)\s+(fits|suits|works)|career\s+positioning)\b/i
const RESEARCH_RE   = /^(research|analyze|analyse|investigate|find\s+companies|what\s+skills?)\b/i
const OUTREACH_RE   = /\b(draft|write|compose|prepare)\b.{0,30}\b(message|outreach|linkedin|recruiter\s+(message|note)|email\s+to|follow.?up|referral\s+request)\b/i

/**
 * Returns the workspace mode to switch to immediately on submit,
 * or null if no confident match (workspace stays unchanged).
 */
export function detectPreflightMode(message: string): WorkspaceMode | null {
  const m = message.trim()
  if (!m) return null

  // Outreach drafting takes highest priority (clear "draft/write message" signal)
  if (OUTREACH_RE.test(m))  return "outreach"
  // Career strategy before research (research RE also catches "career direction")
  if (CAREER_RE.test(m))    return "career_strategy"
  // Research takes priority over generic searches
  if (RESEARCH_RE.test(m))  return "research"
  // Bulk prep takes priority over tailor (both match "prepare")
  if (BULK_PREP_RE.test(m)) return "bulk_application"
  if (TAILOR_RE.test(m))    return "tailor"
  if (COMPARE_RE.test(m))   return "compare"
  if (SEARCH_RE.test(m))    return "search"
  if (COMPANY_RE.test(m))   return "company"
  if (INTERVIEW_PREP_RE.test(m)) return "interview"
  if (APPS_RE.test(m) || WORKFLOW_RE.test(m)) return "applications"

  return null
}

/**
 * Narrative strip shown while Claude is generating for each workspace mode.
 * Displayed immediately — replaced by actual Scout answer when stream completes.
 */
export const PREFLIGHT_NARRATIVE: Partial<Record<WorkspaceMode, string>> = {
  career_strategy:  "Analysing your career profile and market signals…",
  interview:        "Generating your interview prep plan…",
  outreach:         "Preparing your outreach draft…",
  research:         "Initialising research — gathering evidence…",
  compare:          "Comparing your strongest saved jobs…",
  tailor:           "Preparing resume tailoring for this role…",
  search:           "Filtering the job feed for you…",
  company:          "Pulling company intelligence…",
  applications:     "Reviewing your application pipeline…",
  bulk_application: "Selecting your top matches for bulk preparation…",
}

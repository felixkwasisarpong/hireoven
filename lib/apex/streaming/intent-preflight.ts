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

import type { WorkspaceMode } from "@/lib/apex/workspace"

const COMPARE_RE       = /\b(compare|rank.*job|which.*apply.*first|side.?by.?side|shortlist)\b/i
const OFFER_NEGOT_RE   = /\b(got\s+an?\s+offer|received\s+an?\s+offer|they\s+offered\s+me|should\s+i\s+negotiate|how\s+(?:do\s+i|to)\s+(?:negotiate|counter)|is\s+this\s+(?:salary|offer)\s+(?:fair|good|competitive)|negotiate\s+(?:my\s+)?(?:offer|salary|comp)|counter.?offer|salary\s+negotiation|evaluate\s+(?:this\s+)?offer)\b/i
const SALARY_COACH_RE  = /\b(am\s+i\s+(?:underpaid|paid\s+fairly|underselling)|what\s+should\s+i\s+(?:be\s+making|say\s+(?:when|about\s+salary))|is\s+(?:this\s+)?(?:salary|my\s+pay)\s+(?:fair|good|market\s+rate)|salary\s+(?:coaching|expectations?|floor|target|advice)|what\s+(?:is\s+market\s+rate|do\s+i\s+say\s+when\s+(?:they\s+ask|recruiter))|how\s+much\s+should\s+i\s+(?:make|ask)|am\s+i\s+targeting\s+(?:too\s+low|right)|underselling|underpaid)\b/i
const BURNOUT_RE       = /\b(feel\s+(?:stuck|lost|overwhelmed|exhausted|defeated)|this\s+is\s+(?:exhausting|too\s+much|draining)|want\s+to\s+give\s+up|nothing\s+is\s+working|haven'?t\s+applied|stopped\s+applying|losing\s+(?:hope|motivation|momentum)|should\s+i\s+take\s+a\s+break|not\s+getting\s+(?:any\s+)?responses?|been\s+searching\s+for\s+(?:months|weeks))\b/i
const BRAND_RE         = /\b(personal\s+brand|linkedin\s+(?:profile|post|content|presence|visibility|headline|about)|content\s+idea|post\s+(?:on\s+linkedin|content|something)|improve\s+my\s+(?:brand|visibility|profile|linkedin)|build\s+(?:my\s+brand|presence|audience)|writing\s+a\s+(?:linkedin|post)|how\s+do\s+i\s+(?:get\s+noticed|stand\s+out|grow\s+my\s+network|improve\s+my\s+linkedin)|visibility\s+score|brand\s+(?:score|audit|strategy))\b/i
const AUTO_APPLY_RE = /\b(1.?click apply|one.?click apply|auto.?apply|set\s?up.{0,20}apply|pre.?approve.{0,20}appl|apply.{0,15}automatically|applies?\s+for\s+me)\b/i
const TAILOR_RE     = /\b(tailor|tailor.?my.?resume|tailor.*resume|open.*resume.?studio)\b/i
const BULK_PREP_RE  =
  /(?:\b(prepare|queue|batch|bulk)\b.{0,80}\b(application[s]?|apply)\b)|(?:\bapply\s+(?:to|for)\s+(?:(?:my|the|some|a\s+few|several)\s+)?(?:(?:top|best|strongest|highest)\s+)?\d+\s+(?:\S+\s+){0,4}(?:jobs?|roles?|positions?|openings?|applications?))|(?:\bstart\s+applying\b)/i
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

  // 1-click / auto-apply setup takes highest priority — must beat BULK_PREP_RE
  // which also matches "apply to my … matches"
  if (AUTO_APPLY_RE.test(m)) return "auto_apply"
  // Outreach drafting (clear "draft/write message" signal)
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
  if (OFFER_NEGOT_RE.test(m)) return "offer_negotiation"
  if (SALARY_COACH_RE.test(m)) return "salary_coaching"
  if (BURNOUT_RE.test(m)) return "burnout_checkin"
  if (BRAND_RE.test(m)) return "personal_brand"

  return null
}

// Exported for external use
export { BURNOUT_RE }

/**
 * Narrative strip shown while Claude is generating for each workspace mode.
 * Displayed immediately — replaced by actual Apex answer when stream completes.
 */
export const PREFLIGHT_NARRATIVE: Partial<Record<WorkspaceMode, string>> = {
  career_strategy:   "Analysing your career profile and market signals…",
  interview:         "Generating your interview prep plan…",
  outreach:          "Preparing your outreach draft…",
  research:          "Initialising research — gathering evidence…",
  compare:           "Comparing your strongest saved jobs…",
  tailor:            "Preparing resume tailoring for this role…",
  search:            "Filtering the job feed for you…",
  company:           "Pulling company intelligence…",
  applications:      "Reviewing your application pipeline…",
  bulk_application:  "Selecting your top matches for bulk preparation…",
  auto_apply:        "Opening your 1-click apply settings…",
  offer_negotiation: "Benchmarking your offer against market data…",
  salary_coaching:   "Analysing your salary targeting against market rates…",
  burnout_checkin:    "Checking in on your search…",
  post_hire_checkin:  "Opening your check-in…",
  personal_brand:     "Analysing your brand visibility…",
}

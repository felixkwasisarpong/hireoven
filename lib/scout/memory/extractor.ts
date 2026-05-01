/**
 * Scout Memory Extractor
 *
 * Extracts memory candidates from three sources:
 *   1. A single chat turn (user message + Scout response)
 *   2. Accumulated behavior signals from DB
 *   3. Completed workflow context
 *
 * All extraction is pattern/heuristic-based — no LLM call.
 * This keeps extraction cheap, deterministic, and free of hallucination risk.
 *
 * Safety rules:
 *   - Never extract protected characteristics
 *   - Only extract career/workflow/preference signals
 *   - Confidence < MIN_AUTO_PERSIST_CONFIDENCE → candidate is never persisted automatically
 */

import type { ScoutResponse, ScoutAction } from "@/lib/scout/types"
import type { ScoutBehaviorSignals } from "@/lib/scout/behavior"
import type { ScoutMemoryCategory, ScoutMemorySource, MemoryCandidate } from "./types"
import { MIN_AUTO_PERSIST_CONFIDENCE } from "./types"

// ── Helpers ───────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

function makeKey(category: ScoutMemoryCategory, summary: string): string {
  return `${category}::${norm(summary).slice(0, 60)}`
}

function candidate(
  category: ScoutMemoryCategory,
  summary: string,
  confidence: number,
  source: ScoutMemorySource,
): MemoryCandidate {
  return { category, summary, confidence, source, dedupKey: makeKey(category, summary) }
}

// ── Pattern matchers ──────────────────────────────────────────────────────────

// Visa / sponsorship — explicit statements
const VISA_EXPLICIT_RE = /\b(need[s]?\s+(?:h[- ]?1b|visa|sponsorship|work\s+auth)|require[s]?\s+sponsorship|on\s+(?:opt|cpt|ead|h[- ]?1b|f[- ]?1|tn\s+visa)|i\s+need\s+sponsorship|sponsorship\s+required)\b/i
const VISA_NEGATIVE_RE = /\b(don'?t\s+need\s+(?:sponsorship|visa)|no\s+sponsorship\s+needed|citizen|green\s+card|us\s+citizen|permanent\s+resident)\b/i

// Career goal — explicit targeting statements
const CAREER_GOAL_RE = /\b(?:targeting|aiming\s+for|my\s+goal\s+is|want\s+to\s+become|career\s+goal|looking\s+to\s+(?:become|transition|get\s+to|reach|join)|long[- ]term\s+(?:goal|plan|target))\b/i

// Role preferences
const ROLE_PREF_RE = /\b(?:i\s+prefer|prefer(?:ring)?\s+(?:to\s+work|roles?|positions?|jobs?)|interested\s+in|looking\s+for\s+(?:backend|frontend|fullstack|platform|infra|ml|data|devops|sre|security))\b/i

// Salary — explicit numbers
const SALARY_EXPLICIT_RE = /\b(?:target(?:ing)?\s+\$[\d,k]+|expect(?:ing)?\s+\$[\d,k]+|minimum\s+\$[\d,k]+|salary\s+(?:range|target|expectation)[^.]{0,60}\$[\d,k]+|\$[\d,k]+[\s\-–]+\$[\d,k]+\s*(?:per\s+year|\/yr|annually)?)\b/i

// Work mode — explicit
const REMOTE_EXPLICIT_RE = /\b(?:i\s+(?:want|need|prefer)\s+(?:fully\s+)?remote|remote[- ]only|must\s+be\s+remote|only\s+(?:want|looking\s+at)\s+remote)\b/i
const HYBRID_EXPLICIT_RE = /\b(?:prefer\s+hybrid|open\s+to\s+hybrid|hybrid\s+(?:is\s+)?(?:ok|fine|preferred))\b/i

// Company preferences
const COMPANY_LIKE_RE = /\b(?:love\s+companies\s+like|prefer\s+(?:startups?|big\s+tech|faang|series[- ]?[abc])|want\s+to\s+work\s+(?:at|for)\s+(?:a\s+)?(?:startup|scale[- ]?up)|targeting\s+(?:faang|ai\s+companies?|fintech|infra\s+companies?))\b/i
const COMPANY_AVOID_RE = /\b(?:avoid|don'?t\s+(?:want|like)|not\s+interested\s+in)\s+(?:startups?|noisy|big\s+corp|consulting|agencies?|staffing)\b/i

// Skill focus — active learning signals
const SKILL_FOCUS_RE = /\b(?:(?:learning|studying|building|improving|deepening|focusing\s+on)\s+(?:my\s+)?(?:skills?\s+in|depth\s+in|knowledge\s+of\s+)?([a-z][a-z0-9+#.\s]{1,30}?)(?:\s+skills?)?|want\s+to\s+get\s+(?:better|stronger|deeper)\s+(?:at|in|with)\s+([a-z][a-z0-9+#.\s]{1,25}?))\b/i

// Interview — active prep signals
const INTERVIEW_RE = /\b(?:prep(?:aring)?\s+for\s+(?:system\s+design|behavioral|technical|coding|onsite|hiring\s+manager)|practis(?:ing|ing)\s+(?:lc|leetcode|system\s+design|coding)|interview\s+(?:is|coming|scheduled|prep))\b/i

// ── Chat turn extraction ───────────────────────────────────────────────────────

export function extractFromChatTurn(
  userMessage: string,
  response: ScoutResponse,
): MemoryCandidate[] {
  const msg = userMessage.trim()
  const candidates: MemoryCandidate[] = []
  const seen = new Set<string>()

  function add(c: MemoryCandidate) {
    if (!seen.has(c.dedupKey)) {
      seen.add(c.dedupKey)
      candidates.push(c)
    }
  }

  // ── Visa / sponsorship ────────────────────────────────────────────────────
  if (VISA_EXPLICIT_RE.test(msg)) {
    add(candidate("visa_requirement", "Requires H-1B / visa sponsorship", 0.95, "explicit_user"))
  } else if (VISA_NEGATIVE_RE.test(msg)) {
    add(candidate("visa_requirement", "Does not require sponsorship — authorized to work", 0.9, "explicit_user"))
  }

  // ── Career goal ───────────────────────────────────────────────────────────
  if (CAREER_GOAL_RE.test(msg)) {
    // Extract the actual goal text after the trigger phrase (up to 80 chars)
    const goalMatch = msg.match(
      /(?:targeting|aiming\s+for|my\s+goal\s+is|want\s+to\s+become|career\s+goal[^:]*:|looking\s+to\s+(?:become|transition|join))\s*[:\-–]?\s*(.{10,80}?)(?:\.|,|$)/i,
    )
    const goalText = goalMatch?.[1]?.trim()
    if (goalText) {
      const summary = `Career goal: ${goalText.charAt(0).toUpperCase()}${goalText.slice(1)}`
      add(candidate("career_goal", summary, 0.9, "explicit_user"))
    }
  }

  // ── Role preference ───────────────────────────────────────────────────────
  const TECH_ROLES = [
    "backend", "frontend", "full[- ]?stack", "platform", "infrastructure", "infra",
    "machine learning", "ml", "data engineering", "data science", "devops", "sre",
    "site reliability", "security", "cloud", "distributed systems", "systems",
    "ai", "llm", "embedded", "mobile", "android", "ios",
  ]
  const rolePattern = new RegExp(
    `(?:prefer|interested in|looking for|targeting)\\s+(?:a\\s+)?(?:${TECH_ROLES.join("|")})(?:\\s+(?:engineering|engineer|developer|role|position|jobs?))?`,
    "i",
  )
  const roleMatch = msg.match(rolePattern)
  if (roleMatch) {
    const raw = roleMatch[0].trim()
    const summary = `Prefers ${raw.replace(/^(prefer|interested in|looking for|targeting)\s+/i, "").trim()} roles`
    add(candidate("role_preference", summary.charAt(0).toUpperCase() + summary.slice(1), 0.85, "explicit_user"))
  }

  // ── Work mode ─────────────────────────────────────────────────────────────
  if (REMOTE_EXPLICIT_RE.test(msg)) {
    add(candidate("search_preference", "Prefers remote-only positions", 0.9, "explicit_user"))
  } else if (HYBRID_EXPLICIT_RE.test(msg)) {
    add(candidate("search_preference", "Open to or prefers hybrid work arrangements", 0.8, "explicit_user"))
  }

  // ── Salary ────────────────────────────────────────────────────────────────
  const salaryMatch = msg.match(SALARY_EXPLICIT_RE)
  if (salaryMatch) {
    const raw = salaryMatch[0].trim()
    add(candidate("salary_preference", `Salary target: ${raw}`, 0.9, "explicit_user"))
  }

  // ── Company preferences ───────────────────────────────────────────────────
  if (COMPANY_LIKE_RE.test(msg)) {
    const companyMatch = msg.match(
      /(?:love|prefer|want\s+to\s+work\s+(?:at|for)|targeting)\s+(?:companies?\s+like\s+|a\s+)?([a-z][a-z0-9\s,/&+-]{3,60}?)(?:\.|,|$)/i,
    )
    const detail = companyMatch?.[1]?.trim()
    if (detail) {
      add(candidate("company_preference", `Likes: ${detail}`, 0.8, "explicit_user"))
    }
  }
  if (COMPANY_AVOID_RE.test(msg)) {
    const avoidMatch = msg.match(
      /(?:avoid|not\s+interested\s+in|don'?t\s+(?:want|like))\s+([a-z][a-z0-9\s,/&+-]{3,60}?)(?:\.|,|$)/i,
    )
    const detail = avoidMatch?.[1]?.trim()
    if (detail) {
      add(candidate("company_preference", `Avoids: ${detail}`, 0.8, "explicit_user"))
    }
  }

  // ── Skill focus ───────────────────────────────────────────────────────────
  const skillMatch = msg.match(SKILL_FOCUS_RE)
  if (skillMatch) {
    const skill = (skillMatch[1] ?? skillMatch[2] ?? "").trim()
    if (skill.length > 2) {
      const summary = `Actively building depth in ${skill}`
      add(candidate("skill_focus", summary.charAt(0).toUpperCase() + summary.slice(1), 0.8, "explicit_user"))
    }
  }

  // ── Interview pattern ─────────────────────────────────────────────────────
  if (INTERVIEW_RE.test(msg)) {
    const intMatch = msg.match(
      /(?:prep(?:aring)?\s+for|practis(?:ing|ing))\s+([a-z][a-z0-9\s]{3,50}?)(?:\s+interview[s]?)?(?:\.|,|$)/i,
    )
    const detail = intMatch?.[1]?.trim()
    if (detail) {
      add(candidate("interview_pattern", `Preparing for ${detail} interviews`, 0.8, "explicit_user"))
    }
  }

  // ── APPLY_FILTERS actions — reliable search preferences ───────────────────
  const filterAction = response.actions?.find(
    (a): a is Extract<ScoutAction, { type: "APPLY_FILTERS" }> => a.type === "APPLY_FILTERS",
  )
  if (filterAction) {
    const p = filterAction.payload
    if (p.sponsorship === "high") {
      add(candidate("search_preference", "Consistently filters for sponsorship-friendly roles", 0.75, "search_history"))
    }
    if (p.workMode === "remote") {
      add(candidate("search_preference", "Consistently filters for remote roles", 0.75, "search_history"))
    }
    if (p.workMode === "hybrid") {
      add(candidate("search_preference", "Consistently filters for hybrid roles", 0.72, "search_history"))
    }
    if (p.query && typeof p.query === "string" && p.query.trim().length > 2) {
      const q = p.query.trim()
      add(candidate("search_preference", `Frequently searches for: "${q}"`, 0.72, "search_history"))
    }
  }

  // ── Infer from the message itself — softer signals ────────────────────────

  // "find me remote backend jobs" → remote preference + role preference
  if (/\b(remote|work from home|wfh)\b/i.test(msg) && /\b(find|show|search|look)\b/i.test(msg)) {
    add(candidate("search_preference", "Frequently looks for remote positions", 0.70, "search_history"))
  }

  // H-1B / sponsorship in search queries
  if (/\b(h[- ]?1b|sponsor|visa)\b/i.test(msg) && /\b(find|show|search|apply|jobs?|roles?)\b/i.test(msg)) {
    add(candidate("visa_requirement", "Consistently searches for H-1B sponsoring roles", 0.80, "search_history"))
  }

  // Role type from search/apply intent
  const SEARCH_ROLE_RE = /\b(?:find|show|search|apply|look(?:ing)?\s+for)\b.{0,30}\b(backend|frontend|fullstack|full[- ]stack|platform|infrastructure|ml|machine\s+learning|data\s+eng(?:ineer(?:ing)?)?|devops|sre|security|cloud|mobile|android|ios|ai|llm)\b/i
  const searchRoleMatch = msg.match(SEARCH_ROLE_RE)
  if (searchRoleMatch) {
    const role = searchRoleMatch[1].trim()
    add(candidate("role_preference", `Frequently searches for ${role} roles`, 0.72, "search_history"))
  }

  // Salary from apply context ("apply to jobs paying over $150k")
  const contextSalaryMatch = msg.match(/(?:pay(?:ing)?|salary|comp(?:ensation)?)\s+(?:over|above|more\s+than|\$)[\s$]?(\d+)[k]?/i)
  if (contextSalaryMatch) {
    const raw = contextSalaryMatch[0].trim()
    add(candidate("salary_preference", `Salary target context: ${raw}`, 0.72, "search_history"))
  }

  return candidates
}

// ── Behavior signal extraction ────────────────────────────────────────────────

/**
 * Converts ScoutBehaviorSignals (server-side, DB-derived) into memory candidates.
 * These have lower confidence since they are inferred, not stated.
 */
export function extractFromBehaviorSignals(
  signals: ScoutBehaviorSignals,
): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = []
  const seen = new Set<string>()

  function add(c: MemoryCandidate) {
    if (!seen.has(c.dedupKey)) { seen.add(c.dedupKey); candidates.push(c) }
  }

  if (signals.sponsorshipSensitivity === "high") {
    add(candidate("visa_requirement", "Likely requires H-1B / visa sponsorship based on profile", 0.75, "behavior"))
  }

  if (signals.preferredRoles.length >= 2) {
    const roles = signals.preferredRoles.slice(0, 3).join(", ")
    add(candidate("role_preference", `Inferred role interests: ${roles}`, 0.70, "behavior"))
  }

  if (signals.preferredLocations.includes("Remote") && signals.preferredLocations.length === 1) {
    add(candidate("search_preference", "Application patterns suggest remote-only preference", 0.70, "behavior"))
  }

  if (signals.savedJobPatterns.some((p) => /sponsorship/i.test(p))) {
    add(candidate("search_preference", "Watchlist skews toward sponsorship-friendly companies", 0.70, "behavior"))
  }

  return candidates.filter((c) => (c.confidence ?? 0) >= MIN_AUTO_PERSIST_CONFIDENCE)
}

// ── Workflow extraction ───────────────────────────────────────────────────────

/**
 * Extracts a workflow_pattern memory when a Scout workflow is completed.
 * Called once per workflow completion — not per step.
 */
export function extractFromWorkflowCompletion(
  workflowType: string,
  jobTitle?: string | null,
  company?: string | null,
): MemoryCandidate | null {
  const label = workflowType === "tailor_and_prepare"
    ? "Typically tailors resume before applying to a role"
    : workflowType === "compare_and_prioritize"
    ? "Uses compare-and-prioritize workflow for shortlisting"
    : workflowType === "interview_prep"
    ? "Uses Scout interview prep before interviews"
    : null

  if (!label) return null

  return candidate("workflow_pattern", label, 0.75, "workflow")
}

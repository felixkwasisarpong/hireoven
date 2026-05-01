/**
 * Scout Memory Retriever
 *
 * Scores active memories by relevance to the current request context,
 * selects the top-N, and formats them for Claude prompt injection.
 *
 * Design goals:
 *   - Never inject all memories blindly — keep context lean
 *   - Always inject high-confidence, always-relevant memories (visa, career goal)
 *   - Mode and message context boosts topic-specific memories
 *   - Max injection: 6 memories (avoids prompt bloat)
 */

import type { ScoutMode } from "@/lib/scout/types"
import type { ScoutMemory, ScoutMemoryCategory } from "./types"
import { MEMORY_CATEGORY_LABELS, MAX_MEMORY_INJECTION } from "./types"

// ── Relevance scoring ─────────────────────────────────────────────────────────

type ScoringContext = {
  mode:    ScoutMode
  message: string
}

// Category base weights — how generically important each category is
const BASE_WEIGHTS: Record<ScoutMemoryCategory, number> = {
  visa_requirement:   1.0,   // always critical if it exists
  career_goal:        0.9,   // always useful
  role_preference:    0.85,
  salary_preference:  0.60,
  company_preference: 0.65,
  search_preference:  0.70,
  skill_focus:        0.65,
  interview_pattern:  0.50,
  workflow_pattern:   0.45,
  resume_preference:  0.45,
}

// Mode-to-category boosts — which categories matter more in a given workspace mode
const MODE_BOOSTS: Partial<Record<ScoutMode, Partial<Record<ScoutMemoryCategory, number>>>> = {
  feed:         { search_preference: 0.25, role_preference: 0.15, visa_requirement: 0.15 },
  job:          { role_preference: 0.20, company_preference: 0.20, salary_preference: 0.20 },
  company:      { company_preference: 0.30, visa_requirement: 0.10 },
  resume:       { resume_preference: 0.35, skill_focus: 0.25, role_preference: 0.15 },
  applications: { workflow_pattern: 0.20, interview_pattern: 0.15 },
  scout:        { career_goal: 0.15, role_preference: 0.10 },
  general:      {},
}

// Message keyword-to-category boosts
const MSG_BOOSTS: Array<{ pattern: RegExp; category: ScoutMemoryCategory; boost: number }> = [
  { pattern: /\b(salary|compensation|pay|offer)\b/i,         category: "salary_preference",   boost: 0.3 },
  { pattern: /\b(visa|sponsorship|h[- ]?1b|opt|cpt)\b/i,    category: "visa_requirement",     boost: 0.2 },
  { pattern: /\b(interview|prep|practise|behavioral|design)\b/i, category: "interview_pattern", boost: 0.35 },
  { pattern: /\b(tailor|resume|cv|bullet|edit)\b/i,          category: "resume_preference",    boost: 0.3 },
  { pattern: /\b(skill|learn|build|grow|gap)\b/i,            category: "skill_focus",          boost: 0.25 },
  { pattern: /\b(company|startup|faang|culture)\b/i,         category: "company_preference",   boost: 0.25 },
  { pattern: /\b(remote|hybrid|onsite|location)\b/i,         category: "search_preference",    boost: 0.20 },
  { pattern: /\b(career|goal|transition|path|direction)\b/i, category: "career_goal",          boost: 0.20 },
  { pattern: /\b(apply|queue|batch|workflow)\b/i,            category: "workflow_pattern",     boost: 0.25 },
]

function scoreMemory(memory: ScoutMemory, ctx: ScoringContext): number {
  let score = BASE_WEIGHTS[memory.category] ?? 0.5

  // Confidence multiplier: high-confidence memories score higher
  score *= 0.6 + 0.4 * memory.confidence

  // Mode boost
  const modeBoost = MODE_BOOSTS[ctx.mode]?.[memory.category] ?? 0
  score += modeBoost

  // Message boost
  for (const { pattern, category, boost } of MSG_BOOSTS) {
    if (memory.category === category && pattern.test(ctx.message)) {
      score += boost
      break
    }
  }

  return score
}

// ── Top-N selection ───────────────────────────────────────────────────────────

/**
 * Returns the most relevant memories for injection, capped at MAX_MEMORY_INJECTION.
 * Always includes visa_requirement and career_goal if present (they're always relevant).
 */
export function selectRelevantMemories(
  memories: ScoutMemory[],
  ctx: ScoringContext,
  maxCount = MAX_MEMORY_INJECTION,
): ScoutMemory[] {
  if (memories.length === 0) return []

  const active = memories.filter((m) => m.active)
  if (active.length === 0) return []

  // Score all, then sort descending
  const scored = active
    .map((m) => ({ memory: m, score: scoreMemory(m, ctx) }))
    .sort((a, b) => b.score - a.score)

  // Always-first: visa and career_goal (if they exist and scored reasonably)
  const pinned = scored
    .filter((s) => ["visa_requirement", "career_goal"].includes(s.memory.category) && s.score >= 0.5)
    .slice(0, 2)
    .map((s) => s.memory)

  const pinnedIds = new Set(pinned.map((m) => m.id))
  const rest = scored
    .filter((s) => !pinnedIds.has(s.memory.id))
    .slice(0, maxCount - pinned.length)
    .map((s) => s.memory)

  return [...pinned, ...rest]
}

// ── Prompt formatter ──────────────────────────────────────────────────────────

/**
 * Formats selected memories as a compact block for the Claude system prompt.
 *
 * Memories are MORE authoritative than behavior signals — they represent
 * stated or confirmed preferences, not just inferred patterns.
 *
 * Claude instruction: treat these as trusted context, not "soft hints".
 */
export function formatMemoriesForClaude(memories: ScoutMemory[]): string {
  if (memories.length === 0) return ""

  const lines = memories.map((m) => {
    const categoryLabel = MEMORY_CATEGORY_LABELS[m.category] ?? m.category
    const confidence =
      m.confidence >= 0.9 ? "stated explicitly" :
      m.confidence >= 0.75 ? "high confidence" :
      "inferred"
    const sourceLabel = m.source === "explicit_user"  ? "user stated" :
                        m.source === "behavior"        ? "from patterns" :
                        m.source === "workflow"        ? "from workflow" :
                                                         "from searches"
    return `- [${categoryLabel}] ${m.summary} (${confidence} — ${sourceLabel})`
  })

  return `Scout Memory (persistent user context — treat as trusted, not soft hints):
${lines.join("\n")}

Memory rules:
- Use these preferences to personalise recommendations, filter suggestions, and bias advice.
- A visa_requirement memory means the user NEEDS sponsorship — always factor this in.
- Do not contradict a career_goal memory unless the user explicitly requests a different direction.
- If the user's current message conflicts with a memory, prioritise the current message and note the change.
- Never reference these memories in a surveillance-like way ("I see you prefer..."). Use them silently.`
}

// ── Context-aware summary for injection count decisions ───────────────────────

export type MemoryInjectionSummary = {
  totalActive: number
  injected:    number
  hasVisa:     boolean
  hasGoal:     boolean
}

export function buildInjectionSummary(
  allActive: ScoutMemory[],
  injected: ScoutMemory[],
): MemoryInjectionSummary {
  return {
    totalActive: allActive.length,
    injected:    injected.length,
    hasVisa:     injected.some((m) => m.category === "visa_requirement"),
    hasGoal:     injected.some((m) => m.category === "career_goal"),
  }
}

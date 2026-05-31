/**
 * Scout Memory Engine — Types V1
 *
 * Persistent, server-side, user-controlled long-term context for Scout.
 * Each memory is a single, human-readable fact about the user's career
 * preferences, goals, or patterns — never sensitive demographics.
 *
 * Privacy rules (non-negotiable):
 *   - Never infer protected characteristics (race, religion, health, politics)
 *   - Never store demographic form answers
 *   - Only persist career-relevant, actionable preferences
 *   - User can view, edit, disable, or delete any memory at any time
 */

// ── Core types ────────────────────────────────────────────────────────────────

export type ScoutMemoryCategory =
  | "career_goal"          // "Targeting senior IC at AI infrastructure companies"
  | "role_preference"      // "Prefers backend / platform engineering roles"
  | "company_preference"   // "Likes Series B–D startups; dislikes noisy corp culture"
  | "visa_requirement"     // "Requires H-1B sponsorship"
  | "salary_preference"    // "Targeting $180k–$220k base in NYC or remote"
  | "workflow_pattern"     // "Usually tailors resume before applying"
  | "resume_preference"    // "Prefers concise, achievement-focused bullet style"
  | "interview_pattern"    // "Preparing for system design rounds"
  | "search_preference"    // "Filters to remote-only, senior IC, fintech / fininfra"
  | "skill_focus"          // "Actively building Kubernetes and Rust depth"

export type ScoutMemorySource =
  | "explicit_user"    // User stated this directly in a message
  | "behavior"         // Inferred from repeated search / application patterns
  | "workflow"         // Learned from completed Scout workflow
  | "search_history"   // Extracted from APPLY_FILTERS actions

export type ScoutMemory = {
  id:         string
  category:   ScoutMemoryCategory
  summary:    string
  confidence: number           // 0.0–1.0  (1.0 = explicit, <0.7 = inferred)
  source:     ScoutMemorySource
  active:     boolean
  createdAt:  string           // ISO timestamp
  updatedAt:  string
}

// ── Input shapes ──────────────────────────────────────────────────────────────

export type CreateMemoryInput = {
  category:    ScoutMemoryCategory
  summary:     string
  confidence?: number            // defaults to 0.8
  source?:     ScoutMemorySource // defaults to "explicit_user"
}

export type UpdateMemoryInput = {
  summary?:    string
  confidence?: number
  active?:     boolean
}

// Candidate extracted by the engine before persisting — may be discarded
export type MemoryCandidate = CreateMemoryInput & {
  dedupKey: string  // category + normalised summary fingerprint for deduplication
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const MEMORY_CATEGORY_LABELS: Record<ScoutMemoryCategory, string> = {
  career_goal:        "Career Goal",
  role_preference:    "Role Preference",
  company_preference: "Company Preference",
  visa_requirement:   "Visa / Authorization",
  salary_preference:  "Salary Preference",
  workflow_pattern:   "Workflow Pattern",
  resume_preference:  "Resume Preference",
  interview_pattern:  "Interview Pattern",
  search_preference:  "Search Preference",
  skill_focus:        "Skill Focus",
}

export const MEMORY_CATEGORY_ICONS: Record<ScoutMemoryCategory, string> = {
  career_goal:        "🎯",
  role_preference:    "💼",
  company_preference: "🏢",
  visa_requirement:   "🌐",
  salary_preference:  "💰",
  workflow_pattern:   "⚙️",
  resume_preference:  "📄",
  interview_pattern:  "🎤",
  search_preference:  "🔍",
  skill_focus:        "🧠",
}

export const VALID_MEMORY_CATEGORIES = new Set<ScoutMemoryCategory>([
  "career_goal", "role_preference", "company_preference", "visa_requirement",
  "salary_preference", "workflow_pattern", "resume_preference",
  "interview_pattern", "search_preference", "skill_focus",
])

export const VALID_MEMORY_SOURCES = new Set<ScoutMemorySource>([
  "explicit_user", "behavior", "workflow", "search_history",
])

// Minimum confidence to auto-persist an extracted candidate
export const MIN_AUTO_PERSIST_CONFIDENCE = 0.70

// Max active memories injected into a single Claude prompt
export const MAX_MEMORY_INJECTION = 6

// Hard cap per user — prevents unbounded growth
export const MAX_MEMORIES_PER_USER = 50

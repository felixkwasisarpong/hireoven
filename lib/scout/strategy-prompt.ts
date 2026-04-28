/**
 * Scout Strategy Mode — AI prompt, context formatter, and response parser.
 *
 * Separate from strategy.ts (deterministic board) intentionally:
 * this module owns everything that touches Claude for strategy generation.
 */

import type { ScoutContext } from "@/lib/scout/context"
import type { ScoutStrategyBoard, ScoutAIStrategy, ScoutActionType } from "@/lib/scout/types"
import { normalizeScoutActions } from "@/lib/scout/actions"

// Strategy Mode only allows filter/resume/focus actions — no navigation or page-context actions
const STRATEGY_ALLOWED_ACTION_TYPES = new Set<ScoutActionType>([
  "APPLY_FILTERS",
  "OPEN_RESUME_TAILOR",
  "SET_FOCUS_MODE",
])

export const STRATEGY_SYSTEM_PROMPT = `You are Scout in Strategy Mode — Hireoven's AI job-search strategist.

Your job is to generate a focused, SPECIFIC weekly strategy for this job seeker based ONLY on data in the provided context.

Rules you must follow:
1. ONLY use data from the context. Do NOT invent job titles, companies, scores, percentages, or timelines.
2. Be SPECIFIC. Reference actual roles, skills, companies, or signals when they exist in the context.
   - BAD: "Apply to more backend roles"
   - GOOD: "Apply to 2 Python/FastAPI roles this week — your velocity is low and 3 saved jobs match your top skills"
3. Max 4 items per section. Return FEWER if the data does not support more — never pad with generic filler.
4. If context is sparse (no resume, no applications), return realistic onboarding guidance instead of generic job-search advice.
5. Actions must ONLY use IDs listed in the "Available IDs" section. Never invent IDs.
6. Allowed action types for "actions" array: APPLY_FILTERS, OPEN_RESUME_TAILOR, SET_FOCUS_MODE only.
   (Do NOT use OPEN_JOB, OPEN_COMPANY, HIGHLIGHT_JOBS, or RESET_CONTEXT.)

Section definitions:
- "focus": 2–3 strategic themes for this week. Where should the job seeker direct their energy?
- "prioritize": 2–3 specific opportunity types, companies, or signals to pursue first (grounded in context).
- "avoid": 1–2 patterns, role types, or signals to stop wasting time on. Must be based on evidence (bad fit, sponsorship issues, rejection patterns, etc.).
- "improve": 2–3 concrete, specific resume or profile improvements. Only suggest fixes with evidence (e.g., "Add FastAPI — your last 4 applied jobs list it as required").
- "thisWeek": 3–4 completable tasks for this specific week. Be concrete and time-bounded.
- "actions": 0–3 Scout UI actions to immediately help execute the strategy. Only reference IDs from context.

OUTPUT FORMAT — MANDATORY JSON ONLY
Your ENTIRE response MUST be a single valid JSON object. No prose, no markdown, no explanation.
- Start with { and end with } — literally nothing else in your response
- No code fences (do not wrap in \`\`\`json)
- Always include all 6 keys, use [] for empty arrays

Required schema (replace placeholder strings with real content):
{
  "focus": ["string"],
  "prioritize": ["string"],
  "avoid": ["string"],
  "improve": ["string"],
  "thisWeek": ["string"],
  "actions": []
}`

/**
 * Formats Scout context + strategy board into a compact string for Claude's user message.
 */
export function formatStrategyContext(
  context: ScoutContext,
  board: ScoutStrategyBoard
): string {
  const parts: string[] = []

  // ── Snapshot ──
  parts.push(
    `Job Search Snapshot:
- Saved jobs / watchlist entries: ${board.snapshot.savedJobs}
- Active applications: ${board.snapshot.activeApplications}
- Recent applications (last 14 days): ${board.snapshot.recentApplications}
- Average match score: ${
      board.snapshot.averageMatchScore !== null
        ? `${board.snapshot.averageMatchScore}%`
        : "No scored matches yet"
    }`
  )

  // ── Profile ──
  if (context.user.profile) {
    const p = context.user.profile
    const profileLines = [
      `- Visa status: ${p.visa_status ?? "Not specified"}`,
      `- Requires sponsorship: ${p.requires_sponsorship ? "Yes" : "No"}`,
      `- Years of experience: ${p.years_of_experience ?? "Not specified"}`,
    ]
    if (Array.isArray(p.preferred_locations) && p.preferred_locations.length > 0) {
      profileLines.push(`- Preferred locations: ${p.preferred_locations.join(", ")}`)
    }
    parts.push(`User Profile:\n${profileLines.join("\n")}`)
  }

  // ── Resume ──
  if (context.resume) {
    const r = context.resume
    const skills: string[] = []
    if (Array.isArray(r.top_skills) && r.top_skills.length > 0) {
      skills.push(...r.top_skills.slice(0, 8))
    } else if (r.skills) {
      if (Array.isArray(r.skills.technical)) skills.push(...r.skills.technical.slice(0, 8))
    }

    const resumeLines = [
      `- Seniority level: ${r.seniority_level ?? "Not specified"}`,
      `- Top skills: ${skills.length > 0 ? skills.join(", ") : "None listed"}`,
    ]
    if (r.summary) {
      resumeLines.push(`- Summary (excerpt): ${r.summary.substring(0, 200)}`)
    }
    if (r.work_experience && r.work_experience.length > 0) {
      const recentRoles = r.work_experience
        .slice(0, 3)
        .map((e) => `${e.title ?? "Unknown"} at ${e.company ?? "Unknown"}`)
        .join(", ")
      resumeLines.push(`- Recent roles: ${recentRoles}`)
    }
    parts.push(`Resume:\n${resumeLines.join("\n")}`)
  } else {
    parts.push("Resume: Not available — no completed resume on file.")
  }

  // ── Risk signals ──
  if (board.risks.length > 0) {
    const riskLines = board.risks
      .map((r) => `- [${r.severity.toUpperCase()}] ${r.title}: ${r.description}`)
      .join("\n")
    parts.push(`Risk Signals:\n${riskLines}`)
  } else {
    parts.push("Risk Signals: None detected.")
  }

  // ── Deterministic next moves ──
  if (board.nextMoves.length > 0) {
    const moveLines = board.nextMoves
      .map((m) => `- ${m.title}: ${m.description}`)
      .join("\n")
    parts.push(`Recommended Next Moves (deterministic):\n${moveLines}`)
  }

  // ── Behavior signals ──
  if (context.behaviorSignals) {
    const b = context.behaviorSignals
    const sigLines: string[] = []

    if (b.preferredRoles.length > 0) {
      sigLines.push(`- Inferred preferred roles: ${b.preferredRoles.join(", ")}`)
    }
    if (b.preferredLocations.length > 0) {
      sigLines.push(`- Inferred preferred locations: ${b.preferredLocations.join(", ")}`)
    }
    if (b.commonSkills.length > 0) {
      sigLines.push(`- Resume skills (top): ${b.commonSkills.slice(0, 5).join(", ")}`)
    }
    const sensitivityMap = {
      high: "high (likely requires sponsorship)",
      medium: "medium (visa type may require sponsorship)",
      low: "low (likely authorized to work)",
      unknown: "unknown",
    }
    if (b.sponsorshipSensitivity !== "unknown") {
      sigLines.push(`- Sponsorship sensitivity: ${sensitivityMap[b.sponsorshipSensitivity]}`)
    }
    const velocityMap = {
      none: "none — 0 applications in last 14 days",
      low: "low — 1–3 applications in last 14 days",
      healthy: "healthy — 4+ applications in last 14 days",
    }
    sigLines.push(`- Application velocity: ${velocityMap[b.recentApplicationVelocity]}`)

    if (b.savedJobPatterns.length > 0) {
      sigLines.push(`- Watchlist patterns: ${b.savedJobPatterns.join(", ")}`)
    }
    if (b.avoidSignals.length > 0) {
      sigLines.push(`- Avoid signals (detected): ${b.avoidSignals.join("; ")}`)
    }

    if (sigLines.length > 0) {
      parts.push(`Behavior Signals:\n${sigLines.join("\n")}`)
    }
  }

  // ── Available IDs for actions ──
  const idLines: string[] = []
  if (context.resume) {
    idLines.push(`- Resume ID (use for OPEN_RESUME_TAILOR): ${context.resume.id}`)
  } else {
    idLines.push("- No resume ID available — do not suggest OPEN_RESUME_TAILOR")
  }
  idLines.push(
    "- No job IDs available in strategy mode (do not use OPEN_JOB unless a jobId appears above)"
  )
  parts.push(`Available IDs for Actions (use ONLY these):\n${idLines.join("\n")}`)

  return parts.join("\n\n")
}

/**
 * Extracts a JSON object from a potentially messy LLM response.
 * Handles: prose before/after JSON, markdown code fences, prefill artifacts.
 */
function extractJsonBlock(text: string): string | null {
  // 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i)
  if (fenced) return fenced[1].trim()

  // 2. Extract the outermost { ... } block (handles prose before/after JSON)
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1)
  }

  return null
}

/**
 * Parses and validates the AI strategy response.
 * Returns null if the response cannot be parsed into a valid ScoutAIStrategy.
 */
export function parseStrategyResponse(
  text: string,
  allowedResumeId?: string
): ScoutAIStrategy | null {
  const trimmed = text.trim()

  // Build candidates: extracted JSON block first, then the raw trimmed text as fallback
  const extracted = extractJsonBlock(trimmed)
  const candidates = extracted ? [extracted, trimmed] : [trimmed]

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (typeof parsed !== "object" || parsed === null) continue

      const p = parsed as Record<string, unknown>

      function toStringArray(val: unknown, max: number): string[] {
        if (!Array.isArray(val)) return []
        return val
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((s) => s.trim())
          .slice(0, max)
      }

      // Validate + normalize actions, then filter to strategy-allowed types only
      const rawActions = Array.isArray(p.actions) ? p.actions : []
      const normalized = normalizeScoutActions(rawActions).filter((a) =>
        STRATEGY_ALLOWED_ACTION_TYPES.has(a.type as ScoutActionType)
      )

      // OPEN_RESUME_TAILOR requires a known resume ID
      const validActions = normalized.filter((a) => {
        if (a.type === "OPEN_RESUME_TAILOR") {
          if (!allowedResumeId) return false
          return (
            a.payload.resumeId === allowedResumeId ||
            (typeof a.payload.jobId === "string" && a.payload.jobId.length > 0)
          )
        }
        return true
      })

      const strategy: ScoutAIStrategy = {
        focus: toStringArray(p.focus, 4),
        prioritize: toStringArray(p.prioritize, 4),
        avoid: toStringArray(p.avoid, 4),
        improve: toStringArray(p.improve, 4),
        thisWeek: toStringArray(p.thisWeek, 4),
        actions: validActions,
      }

      // Require at least one section to have content
      const hasContent =
        strategy.focus.length > 0 ||
        strategy.thisWeek.length > 0 ||
        strategy.prioritize.length > 0 ||
        strategy.improve.length > 0

      if (!hasContent) continue

      return strategy
    } catch {
      // try next candidate
    }
  }

  return null
}

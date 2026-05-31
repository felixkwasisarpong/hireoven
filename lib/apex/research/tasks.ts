/**
 * Research task templates and intent detection.
 *
 * Isomorphic — no DB, no Node.js, no React.
 * Runs on client (intent gate in handleSubmit) and server (engine).
 */

import type { ScoutResearchTask, ScoutResearchStep } from "./types"

// ── Intent detection ──────────────────────────────────────────────────────────

const RESEARCH_PRIMARY_RE =
  /^(research|analyze|analyse|investigate|find\s+companies|find\s+patterns|what\s+skills?)\b/i

const RESEARCH_PHRASE_RE =
  /\b(research|investigate|analyse|analyze|who\s+(hires?|sponsor)|what\s+skills?\s+(appear|show|most)|find\s+companies?\s+(hir|with\s+similar|sponsor)|companies?\s+hiring\s+similar|most\s+often\s+in\s+top\s+match|hiring\s+pattern|career\s+direction)\b/i

export function isResearchIntent(message: string): boolean {
  const m = message.trim()
  return RESEARCH_PRIMARY_RE.test(m) || RESEARCH_PHRASE_RE.test(m)
}

// ── Research types ────────────────────────────────────────────────────────────

export type ResearchType =
  | "visa_friendly_companies"
  | "similar_profile_companies"
  | "ai_infra_opportunities"
  | "career_direction"
  | "remote_sponsorship"
  | "skill_frequency"
  | "custom"

export function detectResearchType(message: string): ResearchType {
  const m = message.toLowerCase()
  if (/(visa.{0,20}(backend|engineer|dev|software|tech)|visa.?friendly|visa.{0,20}compan)/i.test(m)) return "visa_friendly_companies"
  if (/similar\s+(profile|background|experience|candidates?|role)/i.test(m))                         return "similar_profile_companies"
  if (/\b(ai|ml|machine.?learn|llm|gpu|platform\s+eng|infra).{0,20}(opportunit|role|job|company)/i.test(m)) return "ai_infra_opportunities"
  if (/career\s+(direction|path|pivot|progression|change|best)/i.test(m))                            return "career_direction"
  if (/(sponsor|sponsorship).{0,20}remote|remote.{0,20}(sponsor|h-?1b)/i.test(m))                   return "remote_sponsorship"
  if (/skills?\s+(appear|show|most|often|common|frequent|top\s+match)/i.test(m))                     return "skill_frequency"
  if (/(sponsor.{0,20}(friendly|compan)|visa.{0,30}compan)/i.test(m))                               return "visa_friendly_companies"
  return "custom"
}

// ── Step skeleton templates ───────────────────────────────────────────────────

type StepSkeleton = Pick<ScoutResearchStep, "id" | "title" | "agent">

const STEP_TEMPLATES: Record<ResearchType, StepSkeleton[]> = {
  visa_friendly_companies: [
    { id: "s1", title: "Scanning active job postings",          agent: "search"      },
    { id: "s2", title: "Grouping companies by hiring activity", agent: "search"      },
    { id: "s3", title: "Analyzing sponsorship signals",         agent: "company"     },
    { id: "s4", title: "Pulling market trends",                 agent: "market"      },
    { id: "s5", title: "Synthesizing findings",                 agent: "claude"      },
  ],
  similar_profile_companies: [
    { id: "s1", title: "Loading your skill profile",            agent: "resume"      },
    { id: "s2", title: "Finding roles with skill overlap",      agent: "search"      },
    { id: "s3", title: "Grouping companies hiring your profile",agent: "search"      },
    { id: "s4", title: "Analyzing top companies",               agent: "company"     },
    { id: "s5", title: "Synthesizing findings",                 agent: "claude"      },
  ],
  ai_infra_opportunities: [
    { id: "s1", title: "Scanning AI/ML infrastructure postings",agent: "search"      },
    { id: "s2", title: "Identifying skill clusters",            agent: "search"      },
    { id: "s3", title: "Analyzing AI market trends",            agent: "market"      },
    { id: "s4", title: "Mapping skill relationships",           agent: "opportunity" },
    { id: "s5", title: "Synthesizing findings",                 agent: "claude"      },
  ],
  career_direction: [
    { id: "s1", title: "Analyzing your profile and skills",     agent: "resume"      },
    { id: "s2", title: "Finding your strongest matches",        agent: "search"      },
    { id: "s3", title: "Identifying skill gaps and unlocks",    agent: "opportunity" },
    { id: "s4", title: "Reading career trajectory signals",     agent: "market"      },
    { id: "s5", title: "Synthesizing career direction insights",agent: "claude"      },
  ],
  remote_sponsorship: [
    { id: "s1", title: "Finding remote + sponsorship roles",    agent: "search"      },
    { id: "s2", title: "Grouping sponsoring companies",         agent: "search"      },
    { id: "s3", title: "Analyzing sponsorship patterns",        agent: "company"     },
    { id: "s4", title: "Market signals for remote roles",       agent: "market"      },
    { id: "s5", title: "Synthesizing findings",                 agent: "claude"      },
  ],
  skill_frequency: [
    { id: "s1", title: "Loading your skill profile",            agent: "resume"      },
    { id: "s2", title: "Fetching your highest-match jobs",      agent: "search"      },
    { id: "s3", title: "Aggregating skill frequency",           agent: "search"      },
    { id: "s4", title: "Finding skill unlock opportunities",    agent: "opportunity" },
    { id: "s5", title: "Synthesizing findings",                 agent: "claude"      },
  ],
  custom: [
    { id: "s1", title: "Gathering relevant job data",           agent: "search"      },
    { id: "s2", title: "Analyzing company patterns",            agent: "search"      },
    { id: "s3", title: "Company intelligence",                  agent: "company"     },
    { id: "s4", title: "Market signal analysis",                agent: "market"      },
    { id: "s5", title: "Synthesizing findings",                 agent: "claude"      },
  ],
}

const RESEARCH_TITLES: Record<ResearchType, string> = {
  visa_friendly_companies:   "Visa-Friendly Company Research",
  similar_profile_companies: "Companies Hiring Similar Profiles",
  ai_infra_opportunities:    "AI Infrastructure Opportunities",
  career_direction:          "Career Direction Analysis",
  remote_sponsorship:        "Remote Sponsorship Research",
  skill_frequency:           "Skill Frequency in Top Matches",
  custom:                    "Custom Research",
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function buildResearchTask(
  message: string
): { task: ScoutResearchTask; type: ResearchType } {
  const type = detectResearchType(message)
  const skeletons = STEP_TEMPLATES[type]

  const steps: ScoutResearchStep[] = skeletons.map((s) => ({
    id:     s.id,
    title:  s.title,
    agent:  s.agent,
    status: "pending",
  }))

  const task: ScoutResearchTask = {
    id:        `research-${Date.now()}`,
    title:     RESEARCH_TITLES[type],
    objective: message.trim(),
    status:    "queued",
    steps,
    findings:  [],
    createdAt: new Date().toISOString(),
  }

  return { task, type }
}

// ── Follow-up command suggestions ─────────────────────────────────────────────

export function getResearchFollowUps(type: ResearchType): string[] {
  switch (type) {
    case "visa_friendly_companies":
    case "remote_sponsorship":
      return ["Queue those jobs", "Show those companies", "Filter for remote roles with sponsorship"]
    case "similar_profile_companies":
      return ["Queue those jobs", "Tailor my resume for the top match", "Show those companies"]
    case "ai_infra_opportunities":
      return ["Show those jobs", "Which skill should I learn next?", "Queue the strongest matches"]
    case "career_direction":
      return ["Show my top matches", "What skills should I focus on?", "Tailor my resume"]
    case "skill_frequency":
      return ["Which skill should I add next?", "Filter jobs by that skill", "Show my skill gaps"]
    default:
      return ["Queue those jobs", "Refine this research", "Show those companies"]
  }
}

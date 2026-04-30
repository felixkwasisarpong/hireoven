import type { WorkspaceMode } from "./workspace"

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommandGroup =
  | "context"
  | "search"
  | "resume"
  | "compare"
  | "applications"
  | "interview"
  | "autofill"
  | "international"

export type ScoutCommand = {
  id: string
  label: string
  description?: string
  group: CommandGroup
  /** Text that fills the Scout command bar when this command is selected. */
  query: string
  /**
   * If true, the command is submitted automatically when selected.
   * Only safe for read/navigate commands — never for write/apply/fill.
   */
  autoRun: boolean
  /**
   * If set, the command is only shown when the workspace is in one of these modes.
   * Used for "context" group commands.
   */
  modes?: WorkspaceMode[]
}

// ── Group metadata ─────────────────────────────────────────────────────────────

export const GROUP_META: Record<
  CommandGroup,
  { label: string; emoji: string }
> = {
  context:       { label: "Current context",  emoji: "📌" },
  search:        { label: "Find jobs",         emoji: "🔍" },
  resume:        { label: "Resume",            emoji: "📝" },
  compare:       { label: "Compare",           emoji: "⚖️" },
  applications:  { label: "Applications",      emoji: "📋" },
  interview:     { label: "Interview prep",    emoji: "🎯" },
  autofill:      { label: "Autofill",          emoji: "⚡" },
  international: { label: "International",     emoji: "🌐" },
}

// ── Command registry ──────────────────────────────────────────────────────────

export const ALL_COMMANDS: ScoutCommand[] = [
  // ── Context commands (mode-aware, shown first) ─────────────────────────────
  {
    id: "ctx-search-remote",
    label: "Narrow to remote only",
    description: "Refine current search to remote positions",
    group: "context",
    query: "Narrow my current search to remote-only roles",
    autoRun: true,
    modes: ["search"],
  },
  {
    id: "ctx-search-h1b",
    label: "Add H-1B sponsorship filter",
    description: "Filter for companies with strong sponsorship signals",
    group: "context",
    query: "Add H-1B sponsorship filter to my current search",
    autoRun: true,
    modes: ["search"],
  },
  {
    id: "ctx-search-compare",
    label: "Compare these results",
    description: "Ask Scout to compare the top results",
    group: "context",
    query: "Compare the top jobs from my current search",
    autoRun: true,
    modes: ["search"],
  },
  {
    id: "ctx-search-senior",
    label: "Make these more senior",
    group: "context",
    query: "Filter my search to senior-level roles only",
    autoRun: true,
    modes: ["search"],
  },
  {
    id: "ctx-compare-winner",
    label: "Pick the best match",
    description: "Scout recommends which job to prioritize",
    group: "context",
    query: "Which job in this comparison should I apply to first?",
    autoRun: true,
    modes: ["compare"],
  },
  {
    id: "ctx-compare-tradeoffs",
    label: "Explain the key tradeoffs",
    group: "context",
    query: "Explain the key tradeoffs between these jobs in detail",
    autoRun: true,
    modes: ["compare"],
  },
  {
    id: "ctx-tailor-gaps",
    label: "What skills am I missing?",
    description: "Show gaps between your resume and the target role",
    group: "context",
    query: "What skills and keywords am I missing for this role?",
    autoRun: true,
    modes: ["tailor"],
  },
  {
    id: "ctx-tailor-keywords",
    label: "Show keyword gaps",
    group: "context",
    query: "Which keywords from the job description are absent from my resume?",
    autoRun: true,
    modes: ["tailor"],
  },
  {
    id: "ctx-apps-next",
    label: "What's my next step?",
    description: "Scout prioritizes your next action",
    group: "context",
    query: "What should I do next across my applications?",
    autoRun: true,
    modes: ["applications"],
  },
  {
    id: "ctx-apps-followup",
    label: "Draft a follow-up message",
    description: "Scout writes a follow-up for your in-progress applications",
    group: "context",
    query: "Draft a professional follow-up for my pending applications",
    autoRun: false, // involves composition — user should review before sending
    modes: ["applications"],
  },

  // ── Find jobs ──────────────────────────────────────────────────────────────
  {
    id: "search-remote-backend",
    label: "Find remote backend roles with sponsorship",
    group: "search",
    query: "Find remote backend engineering roles at companies that sponsor H-1B",
    autoRun: true,
  },
  {
    id: "search-senior-swe",
    label: "Show senior software engineer roles",
    group: "search",
    query: "Show senior-level software engineer roles posted in the last two weeks",
    autoRun: true,
  },
  {
    id: "search-hiring-now",
    label: "Find companies actively hiring this week",
    group: "search",
    query: "Which companies have posted the most new roles in the last 7 days?",
    autoRun: true,
  },
  {
    id: "search-contract",
    label: "Search part-time or contract roles",
    group: "search",
    query: "Find contract or part-time roles that allow visa sponsorship",
    autoRun: true,
  },
  {
    id: "search-high-sponsor",
    label: "Show roles with strong sponsorship signals",
    group: "search",
    query: "Find roles where the job description explicitly mentions H-1B sponsorship",
    autoRun: true,
  },
  {
    id: "search-ml",
    label: "Find machine learning / AI roles",
    group: "search",
    query: "Find machine learning and AI engineering roles with sponsorship",
    autoRun: true,
  },

  // ── Resume ─────────────────────────────────────────────────────────────────
  {
    id: "resume-tailor",
    label: "Tailor my resume for the current role",
    description: "Scout adapts your CV to the active job context",
    group: "resume",
    query: "Tailor my resume for the current job and show me what to change",
    autoRun: false, // involves edits — user should review
  },
  {
    id: "resume-gaps",
    label: "What's missing from my resume?",
    group: "resume",
    query: "What is missing from my resume that most job descriptions expect?",
    autoRun: true,
  },
  {
    id: "resume-keywords",
    label: "What keywords should I add?",
    group: "resume",
    query: "What keywords and skills should I add to my resume based on my target roles?",
    autoRun: true,
  },
  {
    id: "resume-strength",
    label: "Analyze my overall resume strength",
    group: "resume",
    query: "Analyze my resume and give me an honest assessment of its strengths and weaknesses",
    autoRun: true,
  },
  {
    id: "resume-summary",
    label: "Improve my resume summary",
    group: "resume",
    query: "How can I improve the summary section of my resume for tech roles?",
    autoRun: true,
  },

  // ── Compare ────────────────────────────────────────────────────────────────
  {
    id: "compare-saved",
    label: "Compare my saved jobs",
    description: "Scout ranks all saved jobs side by side",
    group: "compare",
    query: "Compare all my saved jobs and tell me which to prioritize",
    autoRun: true,
  },
  {
    id: "compare-best-match",
    label: "Which saved job is the best match?",
    group: "compare",
    query: "Which of my saved jobs is the best fit for my resume and experience?",
    autoRun: true,
  },
  {
    id: "compare-sponsorship",
    label: "Rank jobs by H-1B sponsorship signal",
    group: "compare",
    query: "Rank my saved jobs by H-1B sponsorship likelihood from strongest to weakest",
    autoRun: true,
  },
  {
    id: "compare-tradeoffs",
    label: "Show detailed tradeoffs",
    group: "compare",
    query: "What are the key tradeoffs between my top 3 saved jobs?",
    autoRun: true,
  },

  // ── Applications ───────────────────────────────────────────────────────────
  {
    id: "apps-pipeline",
    label: "Review my application pipeline",
    group: "applications",
    query: "Give me an overview of my current application pipeline and status",
    autoRun: true,
  },
  {
    id: "apps-next",
    label: "What should I do next?",
    group: "applications",
    query: "What are my highest-priority actions across all my active applications?",
    autoRun: true,
  },
  {
    id: "apps-attention",
    label: "Which applications need attention?",
    group: "applications",
    query: "Which of my applications are at risk or need follow-up soon?",
    autoRun: true,
  },
  {
    id: "apps-search-rhythm",
    label: "How's my application pace?",
    group: "applications",
    query: "Am I applying at a good pace for my job search goals?",
    autoRun: true,
  },

  // ── Interview prep ─────────────────────────────────────────────────────────
  {
    id: "interview-prep-swe",
    label: "Prepare for a software engineering interview",
    group: "interview",
    query: "Prepare me for a software engineering technical interview with practice questions",
    autoRun: true,
  },
  {
    id: "interview-questions",
    label: "What questions should I expect?",
    group: "interview",
    query: "What interview questions am I likely to get for my target role?",
    autoRun: true,
  },
  {
    id: "interview-practice",
    label: "Give me a practice question",
    group: "interview",
    query: "Give me a challenging technical practice question for my next interview",
    autoRun: true,
  },
  {
    id: "interview-company",
    label: "Research the company",
    description: "Company culture, mission, and interview process",
    group: "interview",
    query: "Help me research the company I'm interviewing at and what to expect",
    autoRun: true,
  },
  {
    id: "interview-salary",
    label: "How should I handle compensation questions?",
    group: "interview",
    query: "How should I handle compensation and salary questions in the interview?",
    autoRun: true,
  },

  // ── Autofill ───────────────────────────────────────────────────────────────
  {
    id: "autofill-explain",
    label: "How does Scout autofill work?",
    group: "autofill",
    query: "Explain how Scout's autofill feature works and how to use it",
    autoRun: true,
  },
  {
    id: "autofill-prepare",
    label: "Prepare tailored autofill for this role",
    description: "Scout creates role-specific autofill suggestions",
    group: "autofill",
    query: "Prepare a tailored autofill strategy for the current job application",
    autoRun: false, // involves preparation steps — user should confirm
  },
  {
    id: "autofill-tips",
    label: "Tips for successful autofill",
    group: "autofill",
    query: "What are the best practices for using autofill to fill job applications?",
    autoRun: true,
  },

  // ── International ──────────────────────────────────────────────────────────
  {
    id: "intl-opt",
    label: "Check my STEM OPT timeline",
    description: "Days remaining, unemployment limits, next steps",
    group: "international",
    query: "Check my OPT / STEM OPT timeline and tell me what to watch out for",
    autoRun: true,
  },
  {
    id: "intl-visa-friendly",
    label: "Find visa-friendly companies in tech",
    group: "international",
    query: "Find tech companies with strong H-1B sponsorship track records",
    autoRun: true,
  },
  {
    id: "intl-h1b-risk",
    label: "What's my H-1B risk for this role?",
    group: "international",
    query: "What is my H-1B sponsorship risk for my current target role and company?",
    autoRun: true,
  },
  {
    id: "intl-everify",
    label: "Show E-Verify employers",
    group: "international",
    query: "Find companies that use E-Verify and are more likely to sponsor STEM OPT",
    autoRun: true,
  },
  {
    id: "intl-process",
    label: "Explain the H-1B process",
    group: "international",
    query: "Explain the H-1B petition process, cap lottery, and timeline I should expect",
    autoRun: true,
  },
  {
    id: "intl-lca",
    label: "Search DOL LCA filings for a company",
    group: "international",
    query: "Search the DOL LCA database for a specific company's H-1B filing history",
    autoRun: false,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return commands that match the current workspace mode as the "context" group. */
export function getContextCommands(mode: WorkspaceMode): ScoutCommand[] {
  if (mode === "idle") return []
  return ALL_COMMANDS.filter(
    (cmd) => cmd.group === "context" && cmd.modes?.includes(mode)
  )
}

/** Filter commands by a search string (label, description, query). */
export function filterCommands(
  commands: ScoutCommand[],
  search: string
): ScoutCommand[] {
  const q = search.trim().toLowerCase()
  if (!q) return commands
  return commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(q) ||
      (cmd.description ?? "").toLowerCase().includes(q) ||
      cmd.query.toLowerCase().includes(q)
  )
}

/**
 * Build the grouped list for display, putting context commands first
 * when the workspace is not idle.
 */
export function buildDisplayGroups(
  mode: WorkspaceMode,
  search: string
): { group: CommandGroup; commands: ScoutCommand[] }[] {
  const contextCmds = search
    ? filterCommands(getContextCommands(mode), search)
    : getContextCommands(mode)

  const nonContextBase = ALL_COMMANDS.filter((c) => c.group !== "context")
  const nonContext     = filterCommands(nonContextBase, search)

  const groups: { group: CommandGroup; commands: ScoutCommand[] }[] = []

  if (contextCmds.length > 0) {
    groups.push({ group: "context", commands: contextCmds })
  }

  // Collect remaining groups in order
  const ORDER: CommandGroup[] = ["search", "resume", "compare", "applications", "interview", "autofill", "international"]
  for (const g of ORDER) {
    const cmds = nonContext.filter((c) => c.group === g)
    if (cmds.length > 0) groups.push({ group: g, commands: cmds })
  }

  return groups
}

/** Flatten grouped display into a sequential list for keyboard navigation. */
export function flattenGroups(
  groups: { group: CommandGroup; commands: ScoutCommand[] }[]
): ScoutCommand[] {
  return groups.flatMap((g) => g.commands)
}

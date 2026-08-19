/**
 * From findings to fixes.
 *
 * The review tells a user what is costing them interviews. This decides, for
 * each finding, whether AI can actually fix it — and the honest answer is that
 * it depends entirely on whether the fix requires facts the resume already
 * contains.
 *
 * Three outcomes, and the split is the whole point:
 *
 *   auto        — everything needed is already in the resume. Surfacing a skill
 *                 that is buried in a bullet, shortening a bullet, rewriting a
 *                 summary from existing content: no new claim is made, so AI can
 *                 do it unattended.
 *   needs_input — the fix requires a fact only the user has. "Add numbers to
 *                 your bullets" cannot be automated without inventing metrics;
 *                 nor can a work-authorization line, an employment-gap
 *                 explanation, or which of two current roles to close. We ask a
 *                 short question and then apply the answer.
 *   manual      — not a document edit at all. Choosing a lane, shifting which
 *                 employers you target, closing a skill gap: these are decisions
 *                 and they live in the review's own sections.
 *
 * Refusing to auto-fix the `needs_input` set is not a limitation to engineer
 * around; it is the feature. A resume generator that invents a p95 latency to
 * satisfy a "quantify your bullets" check has actively harmed the user, who now
 * has to defend a number they never measured.
 *
 * Pure module — no DB, no network, no model calls. The strategies it emits are
 * executed elsewhere.
 */

import type { ResumeFinding } from "@/lib/resume/review"
import type { ResumeSection } from "@/types"

export type FixKind = "auto" | "needs_input" | "manual"

/** How an `auto` fix is carried out. */
export type FixMechanism = "ai_edit" | "setting"

export type QuestionKind = "text" | "choice"

export interface FixQuestion {
  /** Stable id — answers are posted back keyed by this. */
  id: string
  prompt: string
  kind: QuestionKind
  placeholder?: string
  /** Present when kind is "choice". Filled from the resume at plan time. */
  choices?: string[]
}

export interface FixStrategy {
  findingId: string
  kind: FixKind
  /** Short label for the diff row or the button. */
  label: string
  /** Only for kind "auto". */
  mechanism?: FixMechanism
  /** Resume section an ai_edit touches. */
  section?: ResumeSection
  /** Why this cannot be done unattended. Shown to the user verbatim. */
  reason?: string
  questions?: FixQuestion[]
  /**
   * In-page section of the review that resolves this, for `manual` fixes.
   * Consolidation means these no longer navigate away, so the finding is never
   * lost on the way to fixing it.
   */
  panel?: "positioning" | "pivot" | "skills"
}

export interface FixPlan {
  auto: FixStrategy[]
  needsInput: FixStrategy[]
  manual: FixStrategy[]
}

/** Deep link into Studio that carries the finding, so context survives the jump. */
export function studioHrefForFinding(findingId: string, section?: ResumeSection): string {
  const params = new URLSearchParams({ mode: "preview", finding: findingId })
  if (section) params.set("section", section)
  return `/dashboard/resume/studio?${params.toString()}`
}

type Builder = (finding: ResumeFinding) => FixStrategy

const STRATEGIES: Record<string, Builder> = {
  // ── auto: everything needed is already on the resume ──────────────────────

  buried_signal: () => ({
    findingId: "buried_signal",
    kind: "auto",
    mechanism: "ai_edit",
    section: "skills",
    label: "Surface buried keywords into your skills and summary",
  }),

  weak_summary: () => ({
    findingId: "weak_summary",
    kind: "auto",
    mechanism: "ai_edit",
    section: "summary",
    label: "Rewrite your summary from your existing experience",
  }),

  dense_bullets: () => ({
    findingId: "dense_bullets",
    kind: "auto",
    mechanism: "ai_edit",
    section: "work_experience",
    label: "Shorten over-long bullets without dropping content",
  }),

  too_long: () => ({
    findingId: "too_long",
    kind: "auto",
    mechanism: "ai_edit",
    section: "work_experience",
    label: "Tighten wording to cut length",
  }),

  no_lane: () => ({
    findingId: "no_lane",
    kind: "auto",
    mechanism: "setting",
    label: "Confirm the field we match you in",
  }),

  // ── needs_input: the fix requires a fact only the user has ────────────────

  unquantified: () => ({
    findingId: "unquantified",
    kind: "needs_input",
    section: "work_experience",
    label: "Add real numbers to your strongest bullets",
    reason:
      "We will not invent metrics. A fabricated number is worse than a vague bullet, because you have to defend it in the interview.",
    questions: [
      {
        id: "metrics",
        kind: "text",
        prompt:
          "Give us the real figures for your biggest wins — scale, latency, money, users, team size, time saved. Rough is fine if it is honest.",
        placeholder: "e.g. handled 1M transactions/day at ~140ms p95; cut MTTR 35%",
      },
    ],
  }),

  authorization_silent: () => ({
    findingId: "authorization_silent",
    kind: "needs_input",
    section: "summary",
    label: "State your work authorization",
    reason: "Only you know your status, and guessing at it would be reckless.",
    questions: [
      {
        id: "authorization",
        kind: "text",
        prompt:
          "What is your work authorization, and through when? If you are on OPT with a STEM-eligible degree, say so — it means an employer needs no petition for about three years.",
        placeholder: "e.g. F-1 OPT through March 2027, STEM extension eligible",
      },
    ],
  }),

  // Filling a gap means adding a dated timeline entry, not editing prose. We
  // send the user to Studio rather than guessing at start and end dates.
  employment_gap: (finding) => ({
    findingId: "employment_gap",
    kind: "manual",
    section: "work_experience",
    label: "Add a dated entry covering the gap",
    reason: `A gap costs you nothing once it is stated, but it needs real dates. ${finding.evidence[0] ?? ""}`.trim(),
  }),

  concurrent_current_roles: (finding) => ({
    findingId: "concurrent_current_roles",
    kind: "needs_input",
    section: "work_experience",
    label: "Pick the one role that is current",
    reason: "Showing two live roles reads as unavailable, but we cannot choose which one you are ending.",
    questions: [
      {
        id: "current_role",
        kind: "choice",
        prompt: "Which role should stay marked as current? The others get an end date.",
        choices: finding.evidence,
      },
    ],
  }),

  contact_incomplete: (finding) => ({
    findingId: "contact_incomplete",
    kind: "needs_input",
    label: "Complete your contact details",
    reason: "These are yours to supply — we will not guess at an email address.",
    questions: [
      {
        id: "contact",
        kind: "text",
        prompt: `Give us the missing details. ${finding.evidence.join("; ")}`.trim(),
        placeholder: "e.g. felix@example.com · +1 555 0100 · linkedin.com/in/…",
      },
    ],
  }),

  // ── manual: a decision, not an edit. Resolved in the review's own panels. ──

  split_signal: () => ({
    findingId: "split_signal",
    kind: "manual",
    label: "Choose the lane this resume leads with",
    reason: "Which field you want to be read as is a career decision, not a wording one.",
    panel: "positioning",
  }),

  targeting_sponsorship: () => ({
    findingId: "targeting_sponsorship",
    kind: "manual",
    label: "Review the pivot toward the higher-sponsorship field",
    reason: "This is about where you send the resume, not what it says. No rewrite fixes it.",
    panel: "pivot",
  }),

  skill_gaps: () => ({
    findingId: "skill_gaps",
    kind: "manual",
    label: "Work through the skill gaps",
    reason: "Learning a skill is not an edit. Check first which of these you have done but never wrote down.",
    panel: "skills",
  }),

  academic_cv_for_industry: () => ({
    findingId: "academic_cv_for_industry",
    kind: "manual",
    label: "Cut a separate industry resume in Studio",
    reason:
      "Your CV is right for academia and should stay as it is. The industry version is a new document, not an edit to this one.",
  }),
}

/**
 * Plan a fix for every finding, grouped by what we can do unattended.
 *
 * Findings with no registered strategy are returned as `manual` with no panel,
 * so a newly added check surfaces as "you handle this" rather than silently
 * disappearing from the fix flow.
 */
export function planFixes(findings: ResumeFinding[]): FixPlan {
  const plan: FixPlan = { auto: [], needsInput: [], manual: [] }

  for (const finding of findings) {
    const build = STRATEGIES[finding.id]
    const strategy: FixStrategy = build
      ? build(finding)
      : { findingId: finding.id, kind: "manual", label: finding.title }

    if (strategy.kind === "auto") plan.auto.push(strategy)
    else if (strategy.kind === "needs_input") plan.needsInput.push(strategy)
    else plan.manual.push(strategy)
  }

  return plan
}

/** Every question across the plan, in finding order. Drives the answer queue. */
export function questionsFor(plan: FixPlan): Array<FixQuestion & { findingId: string }> {
  return plan.needsInput.flatMap((s) =>
    (s.questions ?? []).map((q) => ({ ...q, findingId: s.findingId })),
  )
}

// ── Studio hand-off ──────────────────────────────────────────────────────────

/** Studio's own section ids, which do not match the resume column names. */
export type StudioSectionId =
  | "personal"
  | "profile"
  | "skills"
  | "experience"
  | "education"
  | "projects"
  | "publications"

const SECTION_TO_STUDIO: Record<ResumeSection, StudioSectionId> = {
  summary: "profile",
  work_experience: "experience",
  skills: "skills",
  education: "education",
  projects: "projects",
}

/** Findings whose Studio destination is not implied by a resume section. */
const FINDING_TO_STUDIO: Record<string, StudioSectionId> = {
  contact_incomplete: "personal",
  authorization_silent: "profile",
  academic_cv_for_industry: "profile",
}

/**
 * Which Studio section to open for a finding.
 *
 * Studio collapses everything but Personal on load, so arriving from a finding
 * without this lands the user on a closed accordion with no indication of what
 * they came to fix — the exact context loss this hand-off exists to prevent.
 */
export function studioSectionFor(
  findingId?: string | null,
  section?: ResumeSection | null,
): StudioSectionId {
  if (findingId && FINDING_TO_STUDIO[findingId]) return FINDING_TO_STUDIO[findingId]
  if (section && SECTION_TO_STUDIO[section]) return SECTION_TO_STUDIO[section]
  return "personal"
}

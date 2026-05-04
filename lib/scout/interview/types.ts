/**
 * Scout Interview Copilot — Types V1
 *
 * Models a structured interview preparation session. The session is created
 * when Scout generates interview prep and persists in localStorage so the
 * user can return to it.
 *
 * Safety contract:
 *   - Prep-only: questions are for practice, not scripted answers for live use
 *   - No fabricated accomplishments or fake experiences
 *   - No cheating assistance during live coding/system-design interviews
 *   - All questions grounded in real job description + resume context
 */

// ── Interview session ─────────────────────────────────────────────────────────

export type ScoutInterviewType =
  | "recruiter_screen"    // phone/recruiter screen
  | "technical"           // coding / domain technical
  | "system_design"       // architecture / design round
  | "behavioral"          // STAR-format behavioral
  | "manager"             // hiring manager / cultural fit
  | "onsite"              // full onsite / interview loop

export type ScoutInterviewSessionStatus = "planned" | "active" | "completed"

export type ScoutInterviewSession = {
  id:          string
  companyId?:  string
  jobId?:      string
  companyName?: string
  jobTitle?:   string

  /** Interview round type — detected from user message or workspace_directive payload */
  type?:       ScoutInterviewType

  status:      ScoutInterviewSessionStatus

  /** Core prep themes Scout surfaced */
  focusAreas?: string[]
  /** Categorised practice questions derived from ScoutInterviewPrep */
  generatedQuestions?: ScoutInterviewQuestion[]

  createdAt:   string
  activeAt?:   string
  completedAt?: string
}

// ── Interview question ────────────────────────────────────────────────────────

export type ScoutInterviewQuestionCategory =
  | "behavioral"      // STAR-format situational questions
  | "technical"       // domain/coding questions
  | "system_design"   // architecture / scale questions
  | "resume"          // experience deep-dives
  | "company"         // company-specific / motivation

export type ScoutInterviewQuestion = {
  id:             string
  category:       ScoutInterviewQuestionCategory
  question:       string
  /** 1–3 coaching hints (e.g. STAR prompt, what to emphasise) */
  hints?:         string[]
  /** Skills most relevant to this question */
  relatedSkills?: string[]
}

// ── Category metadata (for UI display) ───────────────────────────────────────

export const QUESTION_CATEGORY_META: Record<
  ScoutInterviewQuestionCategory,
  { label: string; accent: string; bg: string }
> = {
  behavioral:    { label: "Behavioral",    accent: "text-violet-700",  bg: "bg-violet-50 border-violet-100"  },
  technical:     { label: "Technical",     accent: "text-blue-700",    bg: "bg-blue-50 border-blue-100"      },
  system_design: { label: "System Design", accent: "text-sky-700",     bg: "bg-sky-50 border-sky-100"        },
  resume:        { label: "Resume",        accent: "text-emerald-700", bg: "bg-emerald-50 border-emerald-100"},
  company:       { label: "Company",       accent: "text-amber-700",   bg: "bg-amber-50 border-amber-100"    },
}

export const INTERVIEW_TYPE_LABELS: Record<ScoutInterviewType, string> = {
  recruiter_screen: "Recruiter Screen",
  technical:        "Technical",
  system_design:    "System Design",
  behavioral:       "Behavioral",
  manager:          "Hiring Manager",
  onsite:           "Onsite Loop",
}

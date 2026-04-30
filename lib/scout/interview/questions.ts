/**
 * Interview question builder — pure computation, no I/O.
 *
 * Transforms Claude's flat ScoutInterviewPrep into categorised
 * ScoutInterviewQuestion objects with coaching hints.
 *
 * Categorisation is heuristic. When in doubt, defaults to "resume".
 * Questions are enriched with STAR hints for behavioral types.
 */

import type { ScoutInterviewPrep } from "@/lib/scout/types"
import type { ScoutInterviewQuestion, ScoutInterviewQuestionCategory } from "./types"

// ── Category detection ────────────────────────────────────────────────────────

const SYSTEM_DESIGN_RE =
  /\b(design|architect|scale|system|distributed|microservice|database|infrastructure|pipeline|platform|latency|throughput|availability|fault.tolerant|load.balanc|caching|partition)\b/i

const TECHNICAL_RE =
  /\b(implement|algorithm|data structure|complexity|code|debug|optimiz|performance|api|endpoint|function|class|library|framework|sql|query|async|concurrent|thread|memory|cpu)\b/i

const BEHAVIORAL_RE =
  /\b(tell me|describe a|give an example|how did you|walk me through|share a|time when|situation where|moment|challenge|conflict|fail|success|lead|collaborate|prioriti|decision)\b/i

const COMPANY_RE =
  /\b(why (us|this company|here)|our company|what interests you about|culture|values|mission|why (apply|join)|long.term|goal|career)\b/i

const RESUME_RE =
  /\b(your experience|on your resume|project you|role you|background|previous|past work|accomplish|achievement|built|shipped|owned|impact|metrics|result)\b/i

function categorise(question: string): ScoutInterviewQuestionCategory {
  const q = question.toLowerCase()
  if (SYSTEM_DESIGN_RE.test(q)) return "system_design"
  if (TECHNICAL_RE.test(q))     return "technical"
  if (BEHAVIORAL_RE.test(q))    return "behavioral"
  if (COMPANY_RE.test(q))       return "company"
  if (RESUME_RE.test(q))        return "resume"
  return "resume"   // safe default — always answer-able with resume context
}

// ── STAR hints ────────────────────────────────────────────────────────────────

const STAR_HINTS = [
  "Structure with STAR: Situation → Task → Action → Result",
  "Lead with impact — quantify the result where possible",
  "Keep to 2–3 minutes; avoid lengthy context-setting",
]

const SYSTEM_DESIGN_HINTS = [
  "Start with requirements: clarify scale, consistency, and latency needs",
  "Walk through components top-down before diving into details",
  "Call out trade-offs explicitly — interviewers reward this",
]

const TECHNICAL_HINTS = [
  "Think out loud — interviewers care about your process, not just the answer",
  "Ask clarifying questions before coding",
  "Consider edge cases and complexity after your initial solution",
]

function hintsFor(category: ScoutInterviewQuestionCategory): string[] {
  switch (category) {
    case "behavioral":    return STAR_HINTS
    case "system_design": return SYSTEM_DESIGN_HINTS
    case "technical":     return TECHNICAL_HINTS
    default:              return []
  }
}

// ── Public builder ────────────────────────────────────────────────────────────

/**
 * Build categorised questions from Claude's interview prep response.
 * Each practice question becomes a ScoutInterviewQuestion.
 * roleFocus skills are attached where relevant.
 */
export function buildInterviewQuestions(
  prep: ScoutInterviewPrep
): ScoutInterviewQuestion[] {
  const questions: ScoutInterviewQuestion[] = []

  const skills = prep.roleFocus ?? []

  for (let i = 0; i < prep.practiceQuestions.length; i++) {
    const question = prep.practiceQuestions[i]
    if (!question?.trim()) continue

    const category = categorise(question)
    const hints    = hintsFor(category)

    // Attach relevant skills for technical / system-design questions
    const relatedSkills =
      (category === "technical" || category === "system_design") && skills.length > 0
        ? skills.slice(0, 3)
        : undefined

    questions.push({
      id:            `q-${i + 1}`,
      category,
      question:      question.trim(),
      hints:         hints.length > 0 ? hints : undefined,
      relatedSkills,
    })
  }

  return questions
}

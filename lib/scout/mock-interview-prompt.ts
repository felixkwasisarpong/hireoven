import type { ScoutContext } from "./context"
import type { ScoutMockInterviewFeedback, ScoutMockInterviewTurn } from "./types"

export const TOTAL_QUESTIONS = 6

// ── System prompt ─────────────────────────────────────────────────────────────

export const MOCK_INTERVIEW_SYSTEM_PROMPT = `You are a professional technical interviewer helping a candidate practice for a real job interview.

You are conducting a text-based mock interview session. You have access to the candidate's resume and the job posting.

Rules:
- Ask ONE interview question at a time.
- Questions must be grounded in the job description and the candidate's actual resume — do not invent requirements.
- Do NOT fabricate or assume company interview processes you have no information about.
- Keep questions realistic for the role's seniority level.
- Mix question types across the session: behavioral (STAR-style), technical/role-specific, situational, and motivation-based.
- When evaluating an answer, be practical and constructive. Highlight real strengths first, then suggest specific improvements.
- Do not score answers numerically. Do not be harsh. Focus on growth.
- "suggestedAnswer" is optional — only include it when it would be genuinely useful to see a model answer.
- Keep feedback concise: 2–3 bullet strengths, 2–3 bullet improvements.

Always respond with valid JSON only. No markdown, no preamble, no code fences. Exact schema:
{
  "question": "string or null if complete",
  "feedback": {
    "strengths": ["string"],
    "improvements": ["string"],
    "suggestedAnswer": "string (optional)"
  },
  "questionIndex": number,
  "totalQuestions": number,
  "isComplete": boolean
}

"feedback" is only present when evaluating a submitted answer.
"question" is null only when isComplete is true.
"questionIndex" is 1-indexed (1 = first question).`

// ── Context formatter ─────────────────────────────────────────────────────────

export function formatMockInterviewContext(
  context: ScoutContext,
  history: ScoutMockInterviewTurn[],
  currentAnswer: string | undefined,
  questionIndex: number
): string {
  const sections: string[] = []

  // Job
  if (context.job) {
    const j = context.job
    sections.push(`Target Role:
- Title: ${j.title}
- Company: ${j.company_name}
- Seniority: ${j.seniority_level ?? "Not specified"}
- Location: ${j.location ?? "Not specified"}${j.is_remote ? " (Remote)" : ""}
- Employment Type: ${j.employment_type ?? "Not specified"}
${j.description ? `\nJob Description (excerpt):\n${j.description.slice(0, 600)}` : ""}`)
  } else {
    sections.push("Target Role: Not specified — ask general software engineering questions.")
  }

  // Resume
  if (context.resume) {
    const r = context.resume
    const skills: string[] = []
    if (r.top_skills?.length) skills.push(...r.top_skills.slice(0, 12))
    else if (r.skills) {
      if (Array.isArray(r.skills.technical)) skills.push(...r.skills.technical.slice(0, 8))
      if (Array.isArray(r.skills.soft)) skills.push(...r.skills.soft.slice(0, 4))
    }

    const experience = r.work_experience
      ?.slice(0, 3)
      .map((e) => `  - ${e.title ?? "Role"} at ${e.company ?? "Company"}`)
      .join("\n") ?? "  (none listed)"

    sections.push(`Candidate Resume:
- Name: ${r.full_name ?? "Candidate"}
- Seniority: ${r.seniority_level ?? "Not specified"}
- Summary: ${r.summary?.slice(0, 300) ?? "No summary provided"}
- Skills: ${skills.join(", ") || "None listed"}
Recent Experience:
${experience}`)
  } else {
    sections.push("Candidate Resume: Not available — use general questions.")
  }

  // Conversation history (previous Q&A pairs)
  if (history.length > 0) {
    const transcript = history
      .map((turn, i) => {
        let entry = `Q${i + 1}: ${turn.question}`
        if (turn.answer) entry += `\nCandidate: ${turn.answer}`
        return entry
      })
      .join("\n\n")
    sections.push(`Interview Transcript So Far:\n${transcript}`)
  }

  // Current answer being submitted
  if (currentAnswer) {
    sections.push(`Current Answer to Evaluate:\n${currentAnswer}`)
    sections.push(`Instruction: Evaluate the answer above, then provide question ${questionIndex + 1} of ${TOTAL_QUESTIONS}. If this was the last question (questionIndex will equal totalQuestions after feedback), set isComplete to true and question to null.`)
  } else if (questionIndex === 1) {
    sections.push(`Instruction: Start the interview. Ask question 1 of ${TOTAL_QUESTIONS}. Do NOT include feedback on this first call.`)
  } else {
    sections.push(`Instruction: Continue the interview. Ask question ${questionIndex} of ${TOTAL_QUESTIONS}.`)
  }

  return sections.join("\n\n")
}

// ── Response parser ───────────────────────────────────────────────────────────

type RawMockInterviewResponse = {
  question?: string | null
  feedback?: {
    strengths?: unknown
    improvements?: unknown
    suggestedAnswer?: unknown
  }
  questionIndex?: unknown
  totalQuestions?: unknown
  isComplete?: unknown
}

export function parseMockInterviewResponse(raw: string): {
  question: string | null
  feedback?: ScoutMockInterviewFeedback
  questionIndex: number
  totalQuestions: number
  isComplete: boolean
} | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
    const parsed = JSON.parse(cleaned) as RawMockInterviewResponse

    const questionIndex =
      typeof parsed.questionIndex === "number" ? parsed.questionIndex : 1
    const totalQuestions =
      typeof parsed.totalQuestions === "number" ? parsed.totalQuestions : TOTAL_QUESTIONS
    const isComplete = parsed.isComplete === true

    const question =
      typeof parsed.question === "string" && parsed.question.trim()
        ? parsed.question.trim()
        : null

    let feedback: ScoutMockInterviewFeedback | undefined
    if (parsed.feedback && typeof parsed.feedback === "object") {
      const strengths = Array.isArray(parsed.feedback.strengths)
        ? (parsed.feedback.strengths as unknown[]).filter((s) => typeof s === "string") as string[]
        : []
      const improvements = Array.isArray(parsed.feedback.improvements)
        ? (parsed.feedback.improvements as unknown[]).filter((s) => typeof s === "string") as string[]
        : []
      const suggestedAnswer =
        typeof parsed.feedback.suggestedAnswer === "string"
          ? parsed.feedback.suggestedAnswer
          : undefined

      if (strengths.length > 0 || improvements.length > 0) {
        feedback = { strengths, improvements, suggestedAnswer }
      }
    }

    return { question, feedback, questionIndex, totalQuestions, isComplete }
  } catch {
    return null
  }
}

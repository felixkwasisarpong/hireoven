import Anthropic from "@anthropic-ai/sdk"
import { getPostgresPool } from "@/lib/postgres/server"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { computeVoiceMetrics } from "./voiceMetrics"
import { computeVisionFeedback } from "./visionFeedback"
import {
  getInterviewSession,
  getTurns,
  upsertDebrief,
  getDebrief,
  type InterviewDebrief,
  type InterviewTurn,
} from "./queries"
import { buildInterviewContext } from "./context"
import { deriveSkillList } from "./context"

// ── Types ─────────────────────────────────────────────────────────────────────

type Strength = { observation: string; quote: string }
type Gap = { observation: string; suggestion: string; quote: string }
type BetterAnswer = { question: string; your_answer: string; stronger_answer: string }
type CodingFeedback = {
  correctness_pct: number
  code_quality: string
  complexity_awareness: string
  communication: string
  time_used_pct: number
  biggest_lesson: string
}

type DebriefJson = {
  overall_score: number
  headline: string
  strengths: Strength[]
  gaps: Gap[]
  sample_better_answers: BetterAnswer[]
  coding_feedback: CodingFeedback | null
  voice_feedback: null
  delivery_signals: null
  recommended_next: string[]
}

type TestResults = {
  passed: number
  failed: number
  totalWeight: number
  passedCount: number
  failedCount: number
  runtimeMs: number
}

type Snapshot = { ts: number; code: string }

type VoiceTimings = {
  totalDurationMs: number
  candidateSpeakingMs: number
  interviewerSpeakingMs: number
  silenceMs: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampScore(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)))
}

function sampleSnapshots(snapshots: Snapshot[], count = 8): Snapshot[] {
  if (snapshots.length <= count) return snapshots
  return Array.from({ length: count }, (_, i) => {
    const idx = i === 0 ? 0
      : i === count - 1 ? snapshots.length - 1
        : Math.floor(i * (snapshots.length - 1) / (count - 1))
    return snapshots[idx]
  })
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${String(rem).padStart(2, "0")}`
}

function buildTranscript(turns: InterviewTurn[], startOffset = 0): string {
  return turns
    .filter((t) => t.role !== "system")
    .map((t, i) => `[T${startOffset + i}] ${t.role}: ${t.content.replace(/<metadata>[\s\S]*?<\/metadata>/g, "").trim()}`)
    .join("\n")
}

function validateDebriefJson(d: DebriefJson, expectCoding: boolean, correctnessPct: number): string[] {
  const errs: string[] = []
  if (!Number.isInteger(d.overall_score) || d.overall_score < 0 || d.overall_score > 100) {
    errs.push("overall_score must be integer 0-100")
  }
  if (!d.headline || typeof d.headline !== "string" || d.headline.length < 5) {
    errs.push("headline must be a non-empty string")
  }
  if (!Array.isArray(d.strengths)) errs.push("strengths must be an array")
  if (!Array.isArray(d.gaps)) errs.push("gaps must be an array")
  if (!Array.isArray(d.sample_better_answers)) errs.push("sample_better_answers must be an array")
  if (!Array.isArray(d.recommended_next) || d.recommended_next.length !== 3) {
    errs.push("recommended_next must be an array of exactly 3 items")
  }
  if (expectCoding) {
    if (!d.coding_feedback || typeof d.coding_feedback !== "object") {
      errs.push("coding_feedback must be a non-null object for coding mode")
    } else if (d.coding_feedback.correctness_pct !== correctnessPct) {
      // Allow a small tolerance for rounding
      if (Math.abs(d.coding_feedback.correctness_pct - correctnessPct) > 2) {
        errs.push(`coding_feedback.correctness_pct must match structural value (${correctnessPct})`)
      }
    }
  }
  return errs
}

function buildFallbackDebrief(
  sessionId: string,
  avgScore: number,
  covPct: number,
  coveredSkills: string[],
  uncoveredSkills: string[],
  correctnessPct: number,
  sessionType: string
): Parameters<typeof upsertDebrief>[0] {
  const score = clampScore(
    sessionType === "coding"
      ? (avgScore / 5) * 50 + (covPct / 100) * 30 + correctnessPct * 0.2
      : (avgScore / 5) * 60 + (covPct / 100) * 40
  )
  return {
    sessionId,
    overallScore: score,
    headline: "Auto-debrief — review the transcript for full feedback",
    strengths: coveredSkills.length > 0
      ? [{ observation: `Covered ${coveredSkills.join(", ")}`, quote: "" }]
      : [{ observation: "Session completed", quote: "" }],
    gaps: uncoveredSkills.length > 0
      ? [{ observation: `Skills not addressed: ${uncoveredSkills.join(", ")}`, suggestion: "Run another session targeting these skills", quote: "" }]
      : [],
    sampleBetterAnswers: [],
    codingFeedback: sessionType === "coding"
      ? { correctness_pct: correctnessPct, code_quality: "Review your code in the transcript.", complexity_awareness: "", communication: "", time_used_pct: 100, biggest_lesson: "Practice under timed conditions." }
      : null,
    recommendedNext: [
      "Review your transcript and identify moments of vagueness.",
      "Run another session targeting uncovered skills.",
      "Practice STAR-format answers for behavioral questions.",
    ],
  }
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateDebrief(
  sessionId: string,
  opts: { force?: boolean } = {}
): Promise<InterviewDebrief> {
  const pool = getPostgresPool()

  // Load session
  const sessionResult = await pool.query<Record<string, unknown>>(
    `SELECT *, metadata FROM interview_sessions WHERE id = $1`,
    [sessionId]
  )
  const row = sessionResult.rows[0]
  if (!row) throw new Error("Session not found")
  if (row.status !== "completed") throw new Error("Session is not completed")

  const session = {
    id: row.id as string,
    userId: row.user_id as string,
    jobId: row.job_id as string | null,
    type: row.type as string,
    persona: row.persona as string,
    questionSet: row.question_set as string,
    durationTargetMin: row.duration_target_min as number,
    useResumeContext: row.use_resume_context as boolean,
    startedAt: row.started_at ? new Date(row.started_at as string) : null,
    endedAt: row.ended_at ? new Date(row.ended_at as string) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }

  // Check if we should skip regeneration
  if (!opts.force) {
    const existing = await getDebrief(sessionId)
    if (existing && existing.overallScore !== null) return existing
  }

  // Load turns
  const turns = await getTurns(sessionId)
  const interviewerTurns = turns.filter((t) => t.role === "interviewer")
  const candidateTurns = turns.filter((t) => t.role === "candidate")

  // Build context (handles resume + JD)
  const context = await buildInterviewContext({
    userId: session.userId,
    jobId: session.jobId,
    useResume: session.useResumeContext,
    questionSet: session.questionSet,
  })
  const skillList = deriveSkillList(session.questionSet, context.resumeSkills)

  // Structural signals
  const skillTags = interviewerTurns
    .map((t) => (t.metadata as Record<string, unknown>).skill_tag as string)
    .filter(Boolean)
  const coveredSkills = [...new Set(skillTags)]
  const uncoveredSkills = skillList.filter((s) => !coveredSkills.includes(s))
  const coveredCount = coveredSkills.length
  const totalCount = skillList.length || 1
  const covPct = Math.round((coveredCount / totalCount) * 100)

  const followUpDepth = interviewerTurns.length > 0
    ? interviewerTurns.reduce((s, t) => s + (Number((t.metadata as Record<string, unknown>).follow_up_count) || 0), 0) / interviewerTurns.length
    : 0
  const avgScore = interviewerTurns.length > 0
    ? interviewerTurns.reduce((s, t) => s + (Number((t.metadata as Record<string, unknown>).internal_score) || 3), 0) / interviewerTurns.length
    : 3

  // Actual duration
  const actualDurationMin = session.startedAt && session.endedAt
    ? Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60_000)
    : session.durationTargetMin

  // Coding data
  let attempt: Record<string, unknown> | null = null
  let problem: Record<string, unknown> | null = null
  let correctnessPct = 0
  let solveTimeMin = 0
  let solveRatio = 0

  if (session.type === "coding") {
    const aRes = await pool.query<Record<string, unknown>>(
      `SELECT ca.*, cp.title, cp.difficulty, cp.target_minutes, cp.function_signature
       FROM coding_attempts ca
       JOIN coding_problems cp ON cp.id = ca.problem_id
       WHERE ca.session_id = $1 LIMIT 1`,
      [sessionId]
    )
    if (aRes.rows[0]) {
      attempt = aRes.rows[0]
      problem = attempt
      const tr = attempt.test_results as TestResults | null
      if (tr && tr.totalWeight > 0) {
        correctnessPct = Math.round((tr.passed / tr.totalWeight) * 100)
      }
      const targetSec = (attempt.target_minutes as number) * 60
      solveTimeMin = Math.round((attempt.solve_time_sec as number || 0) / 60)
      solveRatio = targetSec > 0 ? ((attempt.solve_time_sec as number || 0) / targetSec) : 1
    }
  }

  // Voice timings
  const voiceTimings = (session.metadata.voiceTimings as VoiceTimings) ?? null

  // ── Build prompt ────────────────────────────────────────────────────────────

  const resumeSection = session.useResumeContext && context.resumeSummary
    ? `Resume summary: ${context.resumeSummary}
Top experience highlights:
${context.resumeExperienceHighlights.slice(0, 5).map((b) => `- ${b}`).join("\n")}
Skills: ${context.resumeSkills.join(", ")}`
    : "No resume context was used for this session."

  const jdSection = context.jdPriorities.length > 0
    ? `JD priorities:\n${context.jdPriorities.map((p) => `- ${p}`).join("\n")}`
    : `Role: ${context.jobTitle} at ${context.companyName}.`

  let codingSection = ""
  if (session.type === "coding" && attempt) {
    const snapshots = (attempt.code_snapshots as Snapshot[]) ?? []
    const sampled = sampleSnapshots(snapshots)
    const startTs = sampled[0]?.ts ?? Date.now()
    const finalCode = (attempt.final_code as string) || "(no code submitted)"
    const tr = attempt.test_results as TestResults | null

    codingSection = `
CODING SIGNALS
- Problem: ${problem!.title} (${problem!.difficulty})
- Language: ${attempt.language_used}
- Tests passed: ${tr?.passed ?? 0} of ${tr?.totalWeight ?? 0} (${correctnessPct}%)
- Solve time: ${solveTimeMin} min vs target ${attempt.target_minutes} min (ratio: ${solveRatio.toFixed(2)})
- Hints used: ${attempt.hints_used ?? 0} of 3
- Final code:
\`\`\`${attempt.language_used === "python" ? "python" : "javascript"}
${finalCode.slice(0, 2000)}
\`\`\`
- Code progression (${sampled.length} sampled snapshots):
${sampled.map((s, i) => `Snapshot ${i + 1} (t+${formatMs(s.ts - startTs)}):\n\`\`\`\n${s.code.slice(0, 400)}\n\`\`\``).join("\n\n")}`
  }

  const voiceSection = voiceTimings
    ? `
VOICE TIMINGS (raw)
- Total duration: ${Math.round(voiceTimings.totalDurationMs / 1000)} sec
- Candidate speaking: ${Math.round(voiceTimings.candidateSpeakingMs / 1000)} sec
- Interviewer speaking: ${Math.round(voiceTimings.interviewerSpeakingMs / 1000)} sec
- Silence: ${Math.round(voiceTimings.silenceMs / 1000)} sec`
    : ""

  const transcript = "\n" + buildTranscript(turns)

  const prompt = `You are an interview coach generating a post-session debrief.

INTERVIEW METADATA
- Type: ${session.type}
- Persona: ${session.persona}
- Question set: ${session.questionSet}
- Target role: ${context.jobTitle} at ${context.companyName}
- Duration target: ${session.durationTargetMin} minutes
- Actual duration: ${actualDurationMin} minutes

CANDIDATE CONTEXT
${resumeSection}

JOB CONTEXT
${jdSection}

STRUCTURAL SIGNALS (computed, not your job to recompute)
- Skill coverage: ${coveredCount} of ${totalCount} target skills covered (${covPct}%)
- Skills covered: ${coveredSkills.join(", ") || "none"}
- Skills NOT covered: ${uncoveredSkills.join(", ") || "none"}
- Follow-up depth average: ${followUpDepth.toFixed(1)} (0 = no probing needed; 2 = lots of probing)
- Internal score average: ${avgScore.toFixed(1)}/5
${codingSection}${voiceSection}

TRANSCRIPT${transcript}

YOUR JOB
Output ONE JSON object — no preamble, no markdown fences, no trailing commentary. The JSON object has this exact shape:

{
  "overall_score": <integer 0-100>,
  "headline": "<one sentence verdict, 12-20 words>",
  "strengths": [
    { "observation": "<specific positive thing they did>", "quote": "<exact verbatim quote from candidate>" }
  ],
  "gaps": [
    { "observation": "<specific weakness>", "suggestion": "<concrete fix actionable in the next week>", "quote": "<verbatim quote from candidate that demonstrates the weakness, or empty string if structural>" }
  ],
  "sample_better_answers": [
    { "question": "<exact question from interviewer>", "your_answer": "<2-3 sentence summary of what they actually said>", "stronger_answer": "<3-5 sentence rewrite in their voice using their real resume facts>" }
  ],
  "coding_feedback": ${session.type === "coding" ? `{
    "correctness_pct": ${correctnessPct},
    "code_quality": "<one paragraph, 2-3 sentences>",
    "complexity_awareness": "<one paragraph>",
    "communication": "<one paragraph>",
    "time_used_pct": <0-150>,
    "biggest_lesson": "<one sentence>"
  }` : "null"},
  "voice_feedback": null,
  "delivery_signals": null,
  "recommended_next": [
    "<actionable thing 1>",
    "<actionable thing 2>",
    "<actionable thing 3>"
  ]
}

CONSTRAINTS
1. STRENGTHS: 2-4 items. Each must cite a verbatim quote. If nothing measurable was said, quote the best thing they said and note it.
2. GAPS: 2-5 items. Each must be SPECIFIC with a concrete fix. Never vague.
3. SAMPLE BETTER ANSWERS: 2-3 items, only for the WEAKEST answers. The stronger_answer MUST use facts from the candidate's resume (if resume context was used). Never invent experience.
4. OVERALL SCORE: integer 0-100. Calibrate: 85-100 ready now; 70-84 solid; 55-69 needs prep; 40-54 significant gap; 0-39 wrong interview type.
5. HEADLINE: one sentence, 12-20 words, blunt and useful.
6. RECOMMENDED_NEXT: exactly 3 actionable items for the next 7 days. At least one should mention a specific skill from the gaps. At least one should reference a Apex feature ("Run a coding test on...","Start a text interview targeting system design...").
7. CODING_FEEDBACK: null for text/live. Required for coding. correctness_pct must be exactly ${correctnessPct}.
8. NEVER fabricate quotes. Empty string if none found.
9. Output the JSON object now. No other text.`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  async function callLLM(extraInstruction = ""): Promise<DebriefJson | null> {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: extraInstruction ? `${prompt}\n\n${extraInstruction}` : prompt },
    ]

    const res = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 3000,
      messages,
    })
    const text = (res.content[0] as { type: string; text: string }).text.trim()
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
    try {
      return JSON.parse(cleaned) as DebriefJson
    } catch {
      return null
    }
  }

  // Attempt 1
  let parsed = await callLLM()
  let validationErrors = parsed
    ? validateDebriefJson(parsed, session.type === "coding", correctnessPct)
    : ["JSON parse failed"]

  // Attempt 2 if validation failed
  if (validationErrors.length > 0) {
    parsed = await callLLM(
      `Your previous response failed validation: ${validationErrors.join("; ")}. Output the corrected JSON only. No preamble.`
    )
    validationErrors = parsed
      ? validateDebriefJson(parsed, session.type === "coding", correctnessPct)
      : ["JSON parse failed on retry"]
  }

  // Fallback if both attempts failed
  if (!parsed || validationErrors.length > 0) {
    const fallback = buildFallbackDebrief(
      sessionId, avgScore, covPct, coveredSkills, uncoveredSkills, correctnessPct, session.type
    )
    // Still try to compute voice metrics for fallback
    if (session.type === "live" && voiceTimings) {
      const voiceMetrics = computeVoiceMetrics({
        candidateTurns: turns.filter(t => t.role === "candidate").map(t => ({ content: t.content, startMs: (t.metadata as Record<string, unknown>).startMs as number ?? 0, endMs: (t.metadata as Record<string, unknown>).endMs as number ?? 0 })),
        voiceTimings: voiceTimings as Parameters<typeof computeVoiceMetrics>[0]["voiceTimings"],
        interviewerTurns: turns.filter(t => t.role === "interviewer").map(t => ({ startMs: (t.metadata as Record<string, unknown>).startMs as number ?? 0, endMs: (t.metadata as Record<string, unknown>).endMs as number ?? 0 })),
      })
      fallback.voiceFeedback = voiceMetrics
    }
    return await upsertDebrief(fallback)
  }

  // Post-LLM: compute voice metrics (deterministic, not LLM)
  let voiceFeedback: unknown = null
  if (session.type === "live" && voiceTimings) {
    voiceFeedback = computeVoiceMetrics({
      candidateTurns: turns.filter(t => t.role === "candidate").map(t => ({
        content: t.content,
        startMs: ((t.metadata as Record<string, unknown>).startMs as number) ?? 0,
        endMs: ((t.metadata as Record<string, unknown>).endMs as number) ?? 0,
      })),
      voiceTimings: voiceTimings as Parameters<typeof computeVoiceMetrics>[0]["voiceTimings"],
      interviewerTurns: turns.filter(t => t.role === "interviewer").map(t => ({
        startMs: ((t.metadata as Record<string, unknown>).startMs as number) ?? 0,
        endMs: ((t.metadata as Record<string, unknown>).endMs as number) ?? 0,
      })),
    })
  }

  // Post-LLM: vision feedback (behind feature flag)
  let deliverySignals: unknown = null
  if (session.type === "live") {
    deliverySignals = await computeVisionFeedback(sessionId)
  }

  return await upsertDebrief({
    sessionId,
    overallScore: clampScore(parsed.overall_score),
    headline: parsed.headline,
    strengths: parsed.strengths ?? [],
    gaps: parsed.gaps ?? [],
    sampleBetterAnswers: parsed.sample_better_answers ?? [],
    voiceFeedback,
    deliverySignals,
    codingFeedback: parsed.coding_feedback ?? null,
    recommendedNext: (parsed.recommended_next ?? []).slice(0, 3),
  })
}

import Anthropic from "@anthropic-ai/sdk"
import fs from "node:fs"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"
import {
  getInterviewSession,
  appendTurn,
  getTurns,
  type InterviewTurn,
} from "@/lib/scout/interview/queries"
import { buildInterviewContext, deriveSkillList } from "@/lib/scout/interview/context"
import { buildTextInterviewerSystemPrompt } from "@/lib/scout/interview/agentPrompts"
import { replaceEmDash, sanitizeGeneratedText } from "@/lib/text/sanitize-generated-text"

export const runtime = "nodejs"
export const maxDuration = 60

// ── Helpers ───────────────────────────────────────────────────────────────────

type MessageParam = { role: "user" | "assistant"; content: string }

function pushMessage(messages: MessageParam[], next: MessageParam) {
  const prev = messages[messages.length - 1]
  // Anthropic requires alternating roles; merge consecutive same-role turns.
  if (prev && prev.role === next.role) {
    prev.content = `${prev.content}\n\n${next.content}`
    return
  }
  messages.push(next)
}

function buildLLMMessages(existingTurns: InterviewTurn[], newContent: string): MessageParam[] {
  const messages: MessageParam[] = []

  // All conversations start with the synthetic BEGIN_INTERVIEW user message so
  // the first assistant turn (opening question) is properly grounded.
  pushMessage(messages, { role: "user", content: "BEGIN_INTERVIEW" })

  for (const turn of existingTurns) {
    if (turn.role === "interviewer") {
      pushMessage(messages, { role: "assistant", content: turn.content })
    } else if (turn.role === "candidate") {
      pushMessage(messages, { role: "user", content: turn.content })
    }
    // system turns (TIME_REMAINING etc.) are not replayed — they were already
    // part of the conversation when they were injected.
  }

  if (newContent !== "BEGIN_INTERVIEW") {
    pushMessage(messages, { role: "user", content: newContent })
  }

  return messages
}

function readAnthropicKeyFromEnvLocal(): string | null {
  if (process.env.NODE_ENV !== "development") return null
  try {
    const envPath = path.join(process.cwd(), ".env.local")
    const text = fs.readFileSync(envPath, "utf8")
    const line = text
      .split("\n")
      .find((l) => l.trimStart().startsWith("ANTHROPIC_API_KEY="))
    if (!line) return null
    const raw = line.slice(line.indexOf("=") + 1).trim()
    const unquoted = raw.replace(/^['"]|['"]$/g, "")
    return unquoted.length > 0 ? unquoted : null
  } catch {
    return null
  }
}

function resolveAnthropicKey(): string | null {
  const fromProcess =
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.CLAUDE_API_KEY?.trim() ||
    null
  if (fromProcess) return fromProcess
  return readAnthropicKeyFromEnvLocal()
}

function stripMetadata(raw: string): { visible: string; metadata: Record<string, unknown> } {
  const metadataMatch = raw.match(/<metadata>\s*(\{[\s\S]+?\})\s*<\/metadata>/)
  let metadata: Record<string, unknown> = {}
  if (metadataMatch) {
    try { metadata = JSON.parse(metadataMatch[1]) } catch { /* ignore parse failure */ }
  }
  const visible = raw.replace(/<metadata>[\s\S]*?<\/metadata>/g, "").trim()
  return { visible, metadata }
}

function extractSkillsCovered(turns: InterviewTurn[]): string[] {
  return [
    ...new Set(
      turns
        .filter((t) => t.role === "interviewer")
        .map((t) => (t.metadata as Record<string, unknown>)["skill_tag"] as string | undefined)
        .filter((s): s is string => Boolean(s))
    ),
  ]
}

// ── GET — list turns ──────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const plan = await getPlanForUserId(user.id)
  if (!canAccess(plan, "interview_prep")) {
    const needed = requiredPlanFor("interview_prep")
    return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
  }

  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const turns = await getTurns(id)

  // Derive skill list without LLM for cheap GET
  const pool = getPostgresPool()
  let jobTopSkills: string[] = []
  if (session.jobId) {
    const res = await pool.query<{ top_skills: string[] | null }>(
      `SELECT r.top_skills FROM resumes r WHERE r.user_id = $1 AND r.parse_status = 'parsed' LIMIT 1`,
      [user.id]
    )
    jobTopSkills = res.rows[0]?.top_skills ?? []
  }
  // For practice sessions, override skill list to the 3 derived skills
  const sessionMetaResult = await pool.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM interview_sessions WHERE id = $1`,
    [id]
  )
  const sessionMeta = sessionMetaResult.rows[0]?.metadata ?? {}
  const practiceDerivedSkills = (sessionMeta.practice_focus as { derived_skills?: string[] } | null)?.derived_skills

  const skillList = practiceDerivedSkills?.length
    ? practiceDerivedSkills
    : deriveSkillList(session.questionSet, jobTopSkills)
  const skillsCovered = extractSkillsCovered(turns)

  // Visible turns only (strip system turns from UI)
  const visibleTurns = turns.filter((t) => t.role !== "system")

  return NextResponse.json({ turns: visibleTurns, session, skillList, skillsCovered })
}

// ── POST — append turn + get next interviewer message ─────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const plan = await getPlanForUserId(user.id)
  if (!canAccess(plan, "interview_prep")) {
    const needed = requiredPlanFor("interview_prep")
    return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
  }

  // 1 & 2. Load + validate session
  const pool = getPostgresPool()
  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.type !== "text") {
    return NextResponse.json({ error: "Not a text interview session" }, { status: 400 })
  }
  if (session.status === "completed" || session.status === "abandoned") {
    return NextResponse.json({ error: "Session is already ended" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({})) as { content?: string }
  const content = (body.content ?? "").trim()
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 })

  // 3. Transition setup → active
  if (session.status === "setup") {
    await pool.query(
      `UPDATE interview_sessions SET status = 'active', started_at = NOW() WHERE id = $1`,
      [id]
    )
    session.status = "active"
    session.startedAt = new Date()
  }

  // 4. Load existing turns
  const existingTurns = await getTurns(id)
  let nextTurnIndex = existingTurns.length

  // 5. Save candidate turn (skip for BEGIN_INTERVIEW)
  const isBeginInterview = content === "BEGIN_INTERVIEW"
  if (!isBeginInterview) {
    await appendTurn({
      sessionId: id,
      turnIndex: nextTurnIndex++,
      role: "candidate",
      content,
    })
  }

  // 6. Build LLM context + messages
  const context = await buildInterviewContext({
    userId: user.id,
    jobId: session.jobId,
    useResume: session.useResumeContext,
    questionSet: session.questionSet,
  })

  // Load practice focus from session metadata if this is a practice session
  const sessionMeta = await pool.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM interview_sessions WHERE id = $1`,
    [id]
  )
  const practiceFocus = (sessionMeta.rows[0]?.metadata?.practice_focus as Parameters<typeof buildTextInterviewerSystemPrompt>[0]["practiceFocus"]) ?? null

  const systemPrompt = buildTextInterviewerSystemPrompt({
    context,
    persona: session.persona,
    questionSet: session.questionSet,
    durationTargetMin: session.durationTargetMin,
    practiceFocus,
  })

  const messages = buildLLMMessages(existingTurns, content)

  // 7. Time check
  const startedAt = session.startedAt ?? new Date()
  const elapsedSec = Math.floor((Date.now() - startedAt.getTime()) / 1000)
  const targetSec = session.durationTargetMin * 60
  const remainingSec = Math.max(0, targetSec - elapsedSec)

  const hasTimeWarning = existingTurns.some(
    (t) => t.role === "system" && t.content === "TIME_REMAINING_2_MIN"
  )

  if (remainingSec <= 0) {
    // Append to the last user message to keep alternating roles valid
    const last = messages[messages.length - 1]
    if (last?.role === "user") {
      last.content += "\n\n[SYSTEM NOTE] TIME_UP"
    } else {
      messages.push({ role: "user", content: "[SYSTEM NOTE] TIME_UP" })
    }
    await appendTurn({ sessionId: id, turnIndex: nextTurnIndex++, role: "system", content: "TIME_UP" })
  } else if (remainingSec <= 120 && !hasTimeWarning) {
    const last = messages[messages.length - 1]
    if (last?.role === "user") {
      last.content += "\n\n[SYSTEM NOTE] TIME_REMAINING_2_MIN"
    } else {
      messages.push({ role: "user", content: "[SYSTEM NOTE] TIME_REMAINING_2_MIN" })
    }
    await appendTurn({ sessionId: id, turnIndex: nextTurnIndex++, role: "system", content: "TIME_REMAINING_2_MIN" })
  }

  // 8. Call LLM
  const anthropicApiKey = resolveAnthropicKey()
  if (!anthropicApiKey) {
    return NextResponse.json(
      {
        error:
          "Text interview requires ANTHROPIC_API_KEY in server runtime. " +
          "If you just edited .env.local, restart your dev server and retry.",
      },
      { status: 503 }
    )
  }

  let rawContent = ""
  try {
    const anthropic = new Anthropic({ apiKey: anthropicApiKey })
    const llmResult = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 800,
      system: systemPrompt,
      messages,
    })

    const maybeTextBlock = llmResult.content.find((block) => block.type === "text")
    const blockText =
      maybeTextBlock && typeof (maybeTextBlock as { text?: unknown }).text === "string"
        ? ((maybeTextBlock as { text: string }).text)
        : ""
    if (!blockText) {
      return NextResponse.json(
        { error: "Interview model returned an empty response. Please retry." },
        { status: 502 }
      )
    }
    rawContent = blockText
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: `Interview model request failed: ${message}` },
      { status: 502 }
    )
  }

  // 9. Parse metadata + strip from visible content
  const { visible: rawVisible, metadata } = stripMetadata(rawContent)

  // Detect <<END_INTERVIEW>> token
  const endToken = "<<END_INTERVIEW>>"
  const endTokenIdx = rawVisible.indexOf(endToken)
  const isEnded = endTokenIdx !== -1
  const visibleContent = isEnded
    ? replaceEmDash(rawVisible.slice(0, endTokenIdx).trim())
    : replaceEmDash(rawVisible)

  // 10. Save interviewer turn
  const savedTurn = await appendTurn({
    sessionId: id,
    turnIndex: nextTurnIndex,
    role: "interviewer",
    content: visibleContent,
    metadata,
  })

  // 11. Mark completed if interview ended
  if (isEnded) {
    await pool.query(
      `UPDATE interview_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1`,
      [id]
    )
  }

  // 12. Compute skills covered (including new turn)
  const updatedTurns = await getTurns(id)
  const skillsCovered = extractSkillsCovered(updatedTurns)

  return NextResponse.json(sanitizeGeneratedText({
    turn: {
      id: savedTurn.id,
      turn_index: savedTurn.turnIndex,
      role: "interviewer" as const,
      content: savedTurn.content,
      skill_tag: (metadata["skill_tag"] as string) ?? null,
    },
    sessionStatus: isEnded ? "completed" : "active",
    timeRemainingSec: remainingSec,
    skillsCovered,
  }))
}

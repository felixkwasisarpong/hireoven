/**
 * POST /api/extension/match-questions
 *
 * Semantic "second tier" for the apply agent. The extension's fast regex/label
 * matcher fills the obvious fields; whatever required fields it can't confidently
 * answer are batched here and resolved in a SINGLE Claude call against the user's
 * profile + résumé. Replaces the in-browser MiniLM embedding approach (can't run
 * a PyTorch model in a content script) with the model we already pay for, which
 * also handles negation ("do you NOT require…"), picks the right <option> from a
 * provided list, and writes short free-text answers.
 *
 * Body:
 *   jobTitle?  string
 *   company?   string
 *   questions  Array<{ id, label, type: "text"|"textarea"|"yesno"|"select", options?: string[] }>
 *
 * Returns: { answers: Array<{ id, value: string | null, confidence: "high"|"medium"|"low" }> }
 *
 * Safety:
 *   - EEO/demographic questions are NEVER answered here (returned as null).
 *   - `select` answers are constrained to the provided options; anything else → null.
 *   - Read-only. Never submits or uploads anything.
 *
 * Auth: Bearer <ho_session JWT> sent by the Chrome extension.
 */

import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getPostgresPool } from "@/lib/postgres/server"
import { SONNET_MODEL, ANTHROPIC_TIER_PRICING } from "@/lib/ai/anthropic-models"
import { logApiUsage } from "@/lib/admin/usage"
import {
  extensionError,
  extensionCorsHeaders,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import { getPlanForUserId, gateResponse } from "@/lib/gates/server-gate"
import { canAccess } from "@/lib/gates"
import { sanitizeGeneratedText } from "@/lib/text/sanitize-generated-text"

export const runtime = "nodejs"
export const maxDuration = 30

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const QUESTION_TYPES = ["text", "textarea", "yesno", "select"] as const
type QuestionType = (typeof QUESTION_TYPES)[number]

type IncomingQuestion = {
  id: string
  label: string
  type: QuestionType
  options?: string[]
}

type MatchedAnswer = {
  id: string
  value: string | null
  confidence: "high" | "medium" | "low"
}

const MAX_QUESTIONS = 25
const MAX_OPTIONS = 40

// EEO / demographic questions are never answered by the agent — the user must
// fill these themselves. Mirrors the extension's sensitive-field skip list.
const SENSITIVE_RE =
  /\b(gender|sex|ethnicit|race|racial|hispanic|latino|veteran|disabilit|sexual orientation|pronoun|age|date of birth|birth\s?date)\b/i

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  const headers = extensionCorsHeaders(origin)

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const plan = await getPlanForUserId(user.sub)
  if (!canAccess(plan, "autofill")) {
    return gateResponse(403, "Application autofill requires sign-in", "auth")
  }

  const [body, bodyError] = await readExtensionJsonBody<{
    jobTitle?: string
    company?: string
    questions?: unknown
  }>(request)
  if (bodyError) return bodyError

  const questions = sanitizeQuestions(body.questions)
  if (questions.length === 0) {
    return NextResponse.json({ answers: [] }, { status: 200, headers })
  }

  // Sensitive questions short-circuit to null without ever reaching the model.
  const answerable: IncomingQuestion[] = []
  const answers: MatchedAnswer[] = []
  for (const q of questions) {
    if (SENSITIVE_RE.test(q.label)) {
      answers.push({ id: q.id, value: null, confidence: "low" })
    } else {
      answerable.push(q)
    }
  }

  if (answerable.length === 0 || !anthropic) {
    // No AI configured (or nothing left to answer) — return what we have so the
    // caller falls back to manual review for the rest.
    for (const q of answerable) answers.push({ id: q.id, value: null, confidence: "low" })
    return NextResponse.json({ answers }, { status: 200, headers })
  }

  const profileContext = await buildProfileContext(user.sub)
  if (!profileContext) {
    for (const q of answerable) answers.push({ id: q.id, value: null, confidence: "low" })
    return NextResponse.json({ answers }, { status: 200, headers })
  }

  const jobContext = [body.jobTitle, body.company].filter(Boolean).join(" at ") || "this role"

  let modelAnswers: MatchedAnswer[] = []
  try {
    modelAnswers = await runMatch(answerable, profileContext, jobContext)
  } catch (err) {
    console.error("[extension/match-questions] model call failed:", err)
    for (const q of answerable) answers.push({ id: q.id, value: null, confidence: "low" })
    return NextResponse.json({ answers }, { status: 200, headers })
  }

  // Validate + constrain every model answer against the original question.
  const byId = new Map(answerable.map((q) => [q.id, q]))
  const seen = new Set<string>()
  for (const raw of modelAnswers) {
    const q = byId.get(raw.id)
    if (!q || seen.has(raw.id)) continue
    seen.add(raw.id)
    answers.push(validateAnswer(q, raw))
  }
  // Any answerable question the model omitted → explicit null (manual review).
  for (const q of answerable) {
    if (!seen.has(q.id)) answers.push({ id: q.id, value: null, confidence: "low" })
  }

  return NextResponse.json(sanitizeGeneratedText({ answers }), { status: 200, headers })
}

// ── Input sanitation ──────────────────────────────────────────────────────────

function sanitizeQuestions(value: unknown): IncomingQuestion[] {
  if (!Array.isArray(value)) return []
  const out: IncomingQuestion[] = []
  const seenIds = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const id = typeof row.id === "string" ? row.id.slice(0, 120) : ""
    const label = typeof row.label === "string" ? row.label.trim().slice(0, 600) : ""
    const type = QUESTION_TYPES.includes(row.type as QuestionType) ? (row.type as QuestionType) : "text"
    if (!id || !label || seenIds.has(id)) continue
    seenIds.add(id)
    const options =
      Array.isArray(row.options)
        ? row.options
            .filter((o): o is string => typeof o === "string")
            .map((o) => o.trim())
            .filter(Boolean)
            .slice(0, MAX_OPTIONS)
        : undefined
    out.push({ id, label, type, options })
    if (out.length >= MAX_QUESTIONS) break
  }
  return out
}

// ── Answer validation ─────────────────────────────────────────────────────────

function validateAnswer(q: IncomingQuestion, raw: MatchedAnswer): MatchedAnswer {
  const confidence =
    raw.confidence === "high" || raw.confidence === "medium" ? raw.confidence : "low"
  const value = typeof raw.value === "string" ? raw.value.trim() : null
  if (!value) return { id: q.id, value: null, confidence: "low" }

  if (q.type === "yesno") {
    if (/^(yes|y|true)$/i.test(value)) return { id: q.id, value: "yes", confidence }
    if (/^(no|n|false)$/i.test(value)) return { id: q.id, value: "no", confidence }
    return { id: q.id, value: null, confidence: "low" }
  }

  if (q.type === "select") {
    const options = q.options ?? []
    // Exact, then case-insensitive, then contains — always return the EXACT
    // option string the form expects, never the model's paraphrase.
    const exact = options.find((o) => o === value)
    if (exact) return { id: q.id, value: exact, confidence }
    const ci = options.find((o) => o.toLowerCase() === value.toLowerCase())
    if (ci) return { id: q.id, value: ci, confidence }
    const contains = options.find(
      (o) => o.toLowerCase().includes(value.toLowerCase()) || value.toLowerCase().includes(o.toLowerCase()),
    )
    if (contains) return { id: q.id, value: contains, confidence: "low" }
    return { id: q.id, value: null, confidence: "low" }
  }

  // text / textarea — cap length defensively
  const maxLen = q.type === "textarea" ? 1500 : 300
  return { id: q.id, value: value.slice(0, maxLen), confidence }
}

// ── Profile + résumé context ────────────────────────────────────────────────

type ProfileRow = {
  first_name: string | null
  last_name: string | null
  work_authorization: string | null
  authorized_to_work: boolean | null
  requires_sponsorship: boolean | null
  sponsorship_statement: string | null
  years_of_experience: number | null
  salary_expectation_min: number | null
  salary_expectation_max: number | null
  earliest_start_date: string | null
  willing_to_relocate: boolean | null
  preferred_work_type: string | null
  highest_degree: string | null
  field_of_study: string | null
  university: string | null
  city: string | null
  state: string | null
  country: string | null
  r_summary: string | null
  r_primary_role: string | null
  r_top_skills: string[] | null
  r_years: number | null
}

async function buildProfileContext(userId: string): Promise<string | null> {
  const pool = getPostgresPool()
  const result = await pool
    .query<ProfileRow>(
      `SELECT ap.first_name, ap.last_name, ap.work_authorization, ap.authorized_to_work,
              ap.requires_sponsorship, ap.sponsorship_statement, ap.years_of_experience,
              ap.salary_expectation_min, ap.salary_expectation_max, ap.earliest_start_date,
              ap.willing_to_relocate, ap.preferred_work_type, ap.highest_degree,
              ap.field_of_study, ap.university, ap.city, ap.state, ap.country,
              r.summary AS r_summary, r.primary_role AS r_primary_role,
              r.top_skills AS r_top_skills, r.years_of_experience AS r_years
       FROM autofill_profiles ap
       LEFT JOIN LATERAL (
         SELECT summary, primary_role, top_skills, years_of_experience
         FROM resumes WHERE user_id = $1
         ORDER BY is_primary DESC, updated_at DESC LIMIT 1
       ) r ON true
       WHERE ap.user_id = $1
       ORDER BY ap.updated_at DESC LIMIT 1`,
      [userId],
    )
    .catch((err) => {
      console.error("[extension/match-questions] profile fetch failed:", err)
      return null
    })

  const p = result?.rows[0]
  if (!p) return null

  const yearsExp = p.years_of_experience ?? p.r_years
  const location = [p.city, p.state, p.country].filter(Boolean).join(", ")
  const salary =
    p.salary_expectation_min || p.salary_expectation_max
      ? `${p.salary_expectation_min ?? ""}${p.salary_expectation_max ? `–${p.salary_expectation_max}` : ""}`.replace(/^–/, "")
      : null

  const lines: Array<string | null> = [
    p.first_name || p.last_name ? `Name: ${[p.first_name, p.last_name].filter(Boolean).join(" ")}` : null,
    p.r_primary_role ? `Current role: ${p.r_primary_role}` : null,
    yearsExp != null ? `Years of experience: ${yearsExp}` : null,
    location ? `Location: ${location}` : null,
    p.work_authorization ? `Work authorization: ${p.work_authorization}` : null,
    p.authorized_to_work != null ? `Authorized to work (US): ${p.authorized_to_work ? "Yes" : "No"}` : null,
    p.requires_sponsorship != null ? `Requires visa sponsorship: ${p.requires_sponsorship ? "Yes" : "No"}` : null,
    p.sponsorship_statement ? `Sponsorship note: ${p.sponsorship_statement}` : null,
    p.willing_to_relocate != null ? `Willing to relocate: ${p.willing_to_relocate ? "Yes" : "No"}` : null,
    p.preferred_work_type ? `Preferred work type: ${p.preferred_work_type}` : null,
    salary ? `Salary expectation: ${salary}` : null,
    p.earliest_start_date ? `Earliest start date: ${p.earliest_start_date}` : null,
    p.highest_degree ? `Highest degree: ${p.highest_degree}${p.field_of_study ? ` in ${p.field_of_study}` : ""}` : null,
    p.university ? `University: ${p.university}` : null,
    p.r_top_skills?.length ? `Skills: ${p.r_top_skills.slice(0, 20).join(", ")}` : null,
    p.r_summary ? `Summary: ${p.r_summary.slice(0, 600)}` : null,
  ]
  const ctx = lines.filter(Boolean).join("\n")
  return ctx.trim() ? ctx : null
}

// ── Model call ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You map job-application form questions to answers using ONLY the applicant's profile below. You are the fallback for fields a deterministic matcher could not answer.

Rules:
- Answer strictly from the profile. If the profile does not support an answer, set "value" to null — never guess or invent facts (e.g. salary, dates, authorization).
- type "yesno": value must be exactly "yes" or "no". Read the question carefully for negation ("do you NOT require sponsorship") and answer the literal question.
- type "select": value MUST be copied verbatim from the provided "options" array. If none fits, value is null.
- type "text": a direct, concise value (e.g. "5", "3 years", a city). No sentences unless asked.
- type "textarea": 1–3 professional sentences, first person, grounded in the profile.
- Set "confidence": "high" only when the profile clearly answers it; "medium" if reasonably inferred; otherwise return null with "low".
- Output ONLY a JSON object: {"answers":[{"id":"<id>","value":<string|null>,"confidence":"high|medium|low"}]} with one entry per question id. No prose.`

async function runMatch(
  questions: IncomingQuestion[],
  profileContext: string,
  jobContext: string,
): Promise<MatchedAnswer[]> {
  if (!anthropic) return []

  const questionPayload = questions.map((q) => ({
    id: q.id,
    question: q.label,
    type: q.type,
    ...(q.options?.length ? { options: q.options } : {}),
  }))

  const message = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        // Static instructions — cache across the many applications a user runs.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Applicant profile:
${profileContext}

Applying for: ${jobContext}

Questions (answer each by id):
${JSON.stringify(questionPayload, null, 2)}`,
      },
    ],
  })

  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  await logApiUsage({
    service: "claude",
    operation: "extension_match_questions",
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(
      (
        (inputTokens / 1_000_000) * ANTHROPIC_TIER_PRICING.sonnet.inputPerMillion +
        (outputTokens / 1_000_000) * ANTHROPIC_TIER_PRICING.sonnet.outputPerMillion
      ).toFixed(6),
    ),
  }).catch(() => {})

  const rawText = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return []

  const parsed = JSON.parse(jsonMatch[0]) as { answers?: unknown }
  if (!Array.isArray(parsed.answers)) return []

  return parsed.answers
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
    .map((a): MatchedAnswer => ({
      id: typeof a.id === "string" ? a.id : "",
      value: typeof a.value === "string" ? a.value : null,
      confidence: a.confidence === "high" ? "high" : a.confidence === "medium" ? "medium" : "low",
    }))
    .filter((a) => a.id)
}

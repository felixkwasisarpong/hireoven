import Anthropic from "@anthropic-ai/sdk"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { getPostgresPool } from "@/lib/postgres/server"

export type DraftRequest = {
  contentType: "linkedin_post" | "linkedin_article" | "about_section" | "headline" | "recommendation_request"
  title: string
  hook?: string
  generatedFrom?: string
  tone: "professional" | "personal" | "technical" | "warm"
  topicTags?: string[]
  ideaId?: string
}

export type ContentDraft = {
  id: string
  title: string
  content: string
  charCount: number
  charLimit: number
  tone: string
  contentType: string
  version: number
}

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const CHAR_LIMITS: Record<string, number> = {
  linkedin_post: 1300,
  linkedin_article: 2000,
  about_section: 2600,
  headline: 220,
  recommendation_request: 500,
}

const TONE_GUIDANCE: Record<string, string> = {
  professional: "formal, credibility-first, precise language, active voice",
  personal: "conversational, first-person stories, vulnerable but not oversharing",
  technical: "specific, jargon-appropriate, technical depth, code examples welcome",
  warm: "empathetic, encouraging, relatable, approachable",
}

async function getUserContext(userId: string) {
  const pool = getPostgresPool()
  const result = await pool.query<{
    full_name: string | null
    top_skills: string[] | null
    seniority_level: string | null
    years_of_experience: number | null
    summary: string | null
  }>(
    `SELECT full_name, top_skills, seniority_level, years_of_experience, summary
     FROM resumes WHERE user_id = $1 AND parse_status = 'complete'
     ORDER BY is_primary DESC LIMIT 1`,
    [userId]
  )
  return result.rows[0] ?? null
}

export async function writeDraft(
  userId: string,
  request: DraftRequest
): Promise<ContentDraft> {
  const pool = getPostgresPool()
  const charLimit = CHAR_LIMITS[request.contentType] ?? 1300
  const ctx = await getUserContext(userId)

  const fallbackContent = request.hook
    ? `${request.hook}\n\n[Continue writing your ${request.contentType.replace(/_/g, " ")} here...]`
    : `[Write your ${request.contentType.replace(/_/g, " ")} about: ${request.title}]`

  if (!anthropic) {
    const draft = await saveDraft(pool, userId, request, fallbackContent, charLimit)
    return draft
  }

  const isHeadline = request.contentType === "headline"
  const isAbout = request.contentType === "about_section"

  let systemPrompt: string
  if (isHeadline) {
    systemPrompt = `Write a compelling LinkedIn headline under 220 characters.
Rules: No "open to work" language. No generic titles. Lead with value + specialty.
Format: [Value proposition] | [Specialization] or [Problem you solve] → [How]
Return only the headline text, nothing else.`
  } else if (isAbout) {
    systemPrompt = `Write a LinkedIn About section (2400 characters max).
Structure: Hook (1 sentence) → What you do and for whom (2-3 sentences) → Key experiences/achievements (2-3 bullet points using ▶) → What you're looking for → CTA with contact info placeholder.
Tone: ${TONE_GUIDANCE[request.tone]}.
Return only the About section text.`
  } else {
    systemPrompt = `Write a LinkedIn ${request.contentType.replace(/_/g, " ")} under ${charLimit} characters.
Tone: ${TONE_GUIDANCE[request.tone]}.
${request.contentType === "linkedin_post" ? "Format: Hook (1-2 lines) → 3-5 short paragraphs → 1 question or takeaway. No hashtag walls. Max 3 hashtags at end." : ""}
${request.contentType === "recommendation_request" ? "Format: Personal greeting → Context (how you worked together) → Specific ask → What aspect to highlight → Thank you." : ""}
Return only the post content, no meta-commentary.`
  }

  const userPrompt = `User profile:
- Name: ${ctx?.full_name ?? "the user"}
- Skills: ${ctx?.top_skills?.join(", ") ?? "engineering"}
- Seniority: ${ctx?.seniority_level ?? "mid"} · ${ctx?.years_of_experience ?? 5} years
- Summary: ${ctx?.summary?.slice(0, 200) ?? ""}

Content to write:
- Title/topic: ${request.title}
${request.hook ? `- Opening hook: ${request.hook}` : ""}
${request.generatedFrom ? `- Draw from: ${request.generatedFrom}` : ""}
${request.topicTags?.length ? `- Relevant topics: ${request.topicTags.join(", ")}` : ""}`

  try {
    const message = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1500,
      messages: [
        { role: "user", content: `${systemPrompt}\n\n${userPrompt}` },
      ],
    })

    const content = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .slice(0, charLimit + 100)

    return saveDraft(pool, userId, request, content, charLimit)
  } catch {
    return saveDraft(pool, userId, request, fallbackContent, charLimit)
  }
}

async function saveDraft(
  pool: ReturnType<typeof getPostgresPool>,
  userId: string,
  request: DraftRequest,
  content: string,
  charLimit: number
): Promise<ContentDraft> {
  const result = await pool.query<{ id: string; version: number }>(
    `INSERT INTO public.brand_content_drafts
       (user_id, idea_id, content_type, title, content, char_count, char_limit, tone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, version`,
    [userId, request.ideaId ?? null, request.contentType, request.title,
     content, content.length, charLimit, request.tone]
  )

  const row = result.rows[0]
  return {
    id: row.id,
    title: request.title,
    content,
    charCount: content.length,
    charLimit,
    tone: request.tone,
    contentType: request.contentType,
    version: row.version,
  }
}

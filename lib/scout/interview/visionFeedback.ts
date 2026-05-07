import Anthropic from "@anthropic-ai/sdk"
import { getPostgresPool } from "@/lib/postgres/server"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"

export interface VisionFeedback {
  eye_contact_pct: number | null
  posture_notes: string
  framing_notes: string
  background_notes: string
  warnings: string[]
}

function sampleIndices(count: number, target = 6): number[] {
  if (count <= target) return Array.from({ length: count }, (_, i) => i)
  return Array.from({ length: target }, (_, i) =>
    i === 0 ? 0
      : i === target - 1 ? count - 1
        : Math.floor(i * (count - 1) / (target - 1))
  )
}

export async function computeVisionFeedback(sessionId: string): Promise<VisionFeedback | null> {
  if (process.env.INTERVIEW_VISION_ENABLED !== "true") return null

  const pool = getPostgresPool()

  // Load webcam snapshot URLs from interview_turns
  const snapResult = await pool.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM interview_turns
     WHERE session_id = $1
       AND metadata->>'type' = 'webcam_snapshot'
     ORDER BY turn_index ASC`,
    [sessionId]
  )

  const urls = snapResult.rows
    .map((r) => r.metadata.url as string)
    .filter(Boolean)

  if (urls.length < 2) return null

  // Sample up to 6 evenly-spaced snapshots
  const indices = sampleIndices(urls.length)
  const sampledUrls = indices.map((i) => urls[i])

  // Fetch images as base64
  const imageContents: Array<{
    type: "image"
    source: { type: "base64"; media_type: "image/jpeg"; data: string }
  }> = []

  for (const url of sampledUrls) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const buf = await res.arrayBuffer()
      imageContents.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: Buffer.from(buf).toString("base64"),
        },
      })
    } catch { /* skip failed fetches */ }
  }

  if (imageContents.length < 2) return null

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const prompt = `You are reviewing ${imageContents.length} stills sampled from a video interview to give the candidate professional presentation feedback.

Comment ONLY on:
1. Eye contact — appears to be looking at the camera vs looking away
2. Posture — upright/slumped/shifting
3. Framing — head visible, centered, too close, too far
4. Background — well-lit, dim, distracting elements

Do NOT comment on appearance, attractiveness, race, gender, age, ethnicity, weight, clothing style, or anything outside professional video presentation.

If a frame is too dark, blurred, or unreadable, note it in warnings but still assess what you can.

Respond with ONE JSON object only, no markdown fences:

{
  "eye_contact_pct": <integer 0-100 or null>,
  "posture_notes": "<one sentence>",
  "framing_notes": "<one sentence>",
  "background_notes": "<one sentence>",
  "warnings": ["<any frame-quality warning>"]
}`

  try {
    const res = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          ...imageContents,
          { type: "text", text: prompt },
        ],
      }],
    })

    const text = (res.content[0] as { type: string; text: string }).text.trim()
    const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
    const parsed = JSON.parse(cleaned) as VisionFeedback
    return parsed
  } catch {
    return null
  }
}

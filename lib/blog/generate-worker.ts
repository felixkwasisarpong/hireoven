import Anthropic from "@anthropic-ai/sdk"
import { ANTHROPIC_MODEL_ROUTING } from "@/lib/ai/anthropic-models"
import { generateAndStoreBlogImage } from "@/lib/blog/image-generator"
import { getCategoryForToday, insertDraftPost, updateBlogPostImage } from "@/lib/blog/queries"
import type { BlogCategory } from "@/types/blog"

let anthropic: Anthropic | null = null

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured")
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return anthropic
}

const SYSTEM_PROMPT = `You are a content writer for Hireoven, a real-time job monitoring platform for tech professionals and international job seekers (H1B, OPT, STEM OPT). Our readers are engineers, PMs, and data scientists actively job-hunting — many navigating US visa sponsorship.

Write informative, practical, well-structured blog posts in HTML. Use <h2> for section headings, <p> for paragraphs, <ul>/<li> for lists. No <html>, <head>, or <body> tags — just content elements. Tone: direct, knowledgeable, not salesy.

CRITICAL: Your ENTIRE response must be a single raw JSON object — no prose, no markdown fences, no explanation before or after. Start your response with { and end with }.

JSON keys required:
- title: compelling headline (max 80 chars)
- slug: kebab-case, unique — must end with the current year (e.g. "h1b-cap-delay-2026")
- excerpt: 1–2 sentence teaser shown in post cards
- seo_description: meta description under 155 characters
- body: full HTML content, ~600 words, with h2 sections
- reading_time: integer minutes (estimate from word count)
- image_prompt: one sentence describing a text-free editorial hero image for this post
- hero_image_alt: concise alt text for the hero image`

interface GeneratedPost {
  title: string
  slug: string
  excerpt: string
  seo_description: string
  body: string
  reading_time: number
  image_prompt?: string
  hero_image_alt?: string
}

async function generateForCategory(category: BlogCategory): Promise<GeneratedPost> {
  const client = getClient()
  const today = new Date().toISOString().split("T")[0]

  const userPrompt = `Today is ${today}. Write a blog post for the "${category.name}" section.

Category focus: ${category.description}

Search the web for the most relevant trending story, news, or development in this area right now. Base the post on what you find — cite sources naturally in the text where relevant. Make it useful to a tech professional or international job seeker.

Return only the JSON object described in the system prompt.`

  // Use web-search beta so Haiku can pull live trends before writing
  const response = await client.beta.messages.create({
    model: ANTHROPIC_MODEL_ROUTING.BLOG_GENERATION,
    max_tokens: 4096,
    betas: ["web-search-2025-03-05"],
    tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 4 }],
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  })

  // Extract the final text block (last text content after any tool calls)
  const textBlock = [...response.content].reverse().find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Haiku returned no text content")
  }

  // Extract the JSON object even if Haiku prefixed it with prose or code fences
  const text = textBlock.text
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object found in Haiku response: ${text.slice(0, 200)}`)
  }
  const raw = text.slice(start, end + 1)

  let parsed: GeneratedPost
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Failed to parse Haiku response as JSON: ${raw.slice(0, 200)}`)
  }

  const required: (keyof GeneratedPost)[] = ["title", "slug", "excerpt", "seo_description", "body", "reading_time"]
  for (const key of required) {
    if (!parsed[key]) throw new Error(`Haiku response missing field: ${key}`)
  }

  return parsed
}

export interface BlogGenerateResult {
  categorySlug: string
  postId: string
  title: string
  imageGenerated: boolean
  durationMs: number
}

export async function generateTodaysBlogPost(): Promise<BlogGenerateResult | null> {
  const start = Date.now()

  const category = await getCategoryForToday()
  if (!category) {
    // Weekend — no post scheduled
    return null
  }

  const generated = await generateForCategory(category)

  const postId = await insertDraftPost({
    category_id: category.id,
    slug: generated.slug,
    title: generated.title,
    excerpt: generated.excerpt,
    body: generated.body,
    seo_description: generated.seo_description ?? null,
    image_prompt: generated.image_prompt ?? null,
    hero_image_alt: generated.hero_image_alt ?? null,
    reading_time: generated.reading_time ?? null,
  })

  let imageGenerated = false
  try {
    const image = await generateAndStoreBlogImage({
      postId,
      category,
      title: generated.title,
      excerpt: generated.excerpt,
      imagePrompt: generated.image_prompt,
      alt: generated.hero_image_alt,
    })

    if (image) {
      await updateBlogPostImage({
        id: postId,
        hero_image_url: image.url,
        hero_image_key: image.key,
        hero_image_alt: image.alt,
        image_prompt: image.prompt,
      })
      imageGenerated = true
    }
  } catch (error) {
    console.warn("[blog/generate] hero image generation skipped", {
      postId,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  return {
    categorySlug: category.slug,
    postId,
    title: generated.title,
    imageGenerated,
    durationMs: Date.now() - start,
  }
}

import Anthropic from "@anthropic-ai/sdk"
import { ANTHROPIC_MODEL_ROUTING } from "@/lib/ai/anthropic-models"
import { attachHeroImage } from "@/lib/blog/hero-image"
import {
  getAllCategories,
  getBlogDayOfWeek,
  getPostOnBlogDay,
  getRecentPostDigests,
  insertDraftPost,
  recordBlogGenerationRun,
} from "@/lib/blog/queries"
import { scoutTrendingTopic, type TrendCandidate } from "@/lib/blog/trend-scout"
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

async function generateForCategory(
  category: BlogCategory,
  trend: TrendCandidate,
): Promise<GeneratedPost> {
  const client = getClient()
  const today = new Date().toISOString().split("T")[0]

  // The story is chosen before generation now, so the writer is told WHAT to
  // cover rather than being asked to find something inside a fixed category.
  // Previously a quiet news day still demanded a post in that day's category,
  // which is what produced repeats.
  const userPrompt = `Today is ${today}. Write a blog post about this specific development:

STORY: ${trend.headline}
WHY IT MATTERS NOW: ${trend.whyNow}
${trend.sources.length ? `SOURCES FOUND WHILE SCOUTING:\n${trend.sources.map((s) => `- ${s}`).join("\n")}` : ""}

File it under the "${category.name}" section (${category.description}).

Search the web to verify and deepen the story before writing — confirm the details above and pull in specifics, numbers and dates. Cite sources naturally in the text. Write about THIS development specifically; do not fall back to a general explainer about the category.

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
  imageError: string | null
  durationMs: number
  skippedExisting?: boolean
}

/**
 * Attach the hero image, turning failure into a recorded error rather than
 * losing an otherwise good post. Logged at error level on purpose: this exact
 * step failed on every run for weeks while the run still recorded `success`,
 * and nothing surfaced it.
 */
async function attachHeroImageSafely(
  postId: string,
): Promise<{ imageGenerated: boolean; imageError: string | null }> {
  try {
    const outcome = await attachHeroImage(postId)
    if (outcome.status === "not_configured") {
      return { imageGenerated: false, imageError: "Blog image generation is not configured" }
    }
    return { imageGenerated: true, imageError: null }
  } catch (error) {
    const imageError = error instanceof Error ? error.message : String(error)
    console.error("[blog/generate] hero image failed", { postId, message: imageError })
    return { imageGenerated: false, imageError }
  }
}

export async function generateTodaysBlogPost(): Promise<BlogGenerateResult | null> {
  const start = Date.now()
  let category: BlogCategory | null = null

  try {
    // Weekends stay quiet, as before.
    const day = getBlogDayOfWeek()
    if (day === 0 || day === 6) {
      await recordBlogGenerationRun({
        status: "skipped_weekend",
        duration_ms: Date.now() - start,
      })
      return null
    }

    // One post per day across ALL categories. The old guard was per-category
    // because the weekday fixed the category; now that a trend picks it, a
    // category-scoped guard would allow a second post on the same day.
    const existingPost = await getPostOnBlogDay()
    if (existingPost) {
      // Today's post is written, but its image may not have landed — storage can
      // be briefly unreachable while text generation succeeds. Retry it here so a
      // one-off storage failure self-heals on the next run instead of leaving the
      // post imageless forever.
      const image = existingPost.hero_image_url
        ? { imageGenerated: true, imageError: null }
        : await attachHeroImageSafely(existingPost.id)

      const result: BlogGenerateResult = {
        categorySlug: existingPost.category?.slug ?? "unknown",
        postId: existingPost.id,
        title: existingPost.title,
        imageGenerated: image.imageGenerated,
        imageError: image.imageError,
        durationMs: Date.now() - start,
        skippedExisting: true,
      }

      await recordBlogGenerationRun({
        status: "skipped_existing",
        category_id: existingPost.category_id,
        category_slug: existingPost.category?.slug ?? null,
        blog_post_id: existingPost.id,
        title: existingPost.title,
        image_generated: image.imageGenerated,
        image_error: image.imageError,
        duration_ms: result.durationMs,
      })

      return result
    }

    // Scout across every category, then let the winning story pick the section.
    const categories = await getAllCategories()
    const recentPosts = await getRecentPostDigests(30)
    const scouted = await scoutTrendingTopic({ categories, recentPosts })

    if (scouted.status === "nothing_trending") {
      // Publishing nothing beats republishing. This is the whole point of the
      // change: a quiet day no longer forces a post in a pre-assigned category.
      await recordBlogGenerationRun({
        status: "skipped_no_trend",
        duration_ms: Date.now() - start,
        error_message: scouted.reason,
      })
      return null
    }

    const trend = scouted.candidate
    category = categories.find((c) => c.slug === trend.categorySlug) ?? null
    if (!category) {
      await recordBlogGenerationRun({
        status: "skipped_no_trend",
        duration_ms: Date.now() - start,
        error_message: `Scout chose unknown category "${trend.categorySlug}".`,
      })
      return null
    }

    const generated = await generateForCategory(category, trend)

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

    const { imageGenerated, imageError } = await attachHeroImageSafely(postId)

    const result: BlogGenerateResult = {
      categorySlug: category.slug,
      postId,
      title: generated.title,
      imageGenerated,
      imageError,
      durationMs: Date.now() - start,
    }

    await recordBlogGenerationRun({
      status: "success",
      category_id: category.id,
      category_slug: category.slug,
      blog_post_id: postId,
      title: generated.title,
      image_generated: imageGenerated,
      image_error: imageError,
      duration_ms: result.durationMs,
    })

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordBlogGenerationRun({
      status: "failed",
      category_id: category?.id ?? null,
      category_slug: category?.slug ?? null,
      duration_ms: Date.now() - start,
      error_message: message,
    })
    throw error
  }
}

import {
  ensureBlogImageStorageReady,
  uploadBlogImageBuffer,
  isBlogImageStorageConfigured,
} from "@/lib/blog/image-storage"
import type { BlogCategory } from "@/types/blog"

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations"
const DEFAULT_IMAGE_MODEL = "gpt-image-2"
const DEFAULT_IMAGE_SIZE = "1536x1024"
const DEFAULT_IMAGE_QUALITY = "low"
const DEFAULT_IMAGE_FORMAT = "webp"

type OpenAIImageResponse = {
  data?: Array<{ b64_json?: string }>
  error?: { message?: string }
}

type BlogImageInput = {
  postId: string
  category: BlogCategory
  title: string
  excerpt: string
  imagePrompt?: string | null
  alt?: string | null
}

export type GeneratedBlogImageBytes = {
  buffer: Buffer
  contentType: string
  extension: string
  prompt: string
  alt: string
}

export type GeneratedBlogImage = {
  url: string
  key: string
  prompt: string
  alt: string
}

export function isBlogImageGenerationConfigured(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() &&
      isBlogImageStorageConfigured() &&
      process.env.BLOG_IMAGE_GENERATION_ENABLED !== "false"
  )
}

function buildPrompt(input: BlogImageInput): string {
  const promptSeed = input.imagePrompt?.trim()
  const subject = promptSeed || `${input.title}. ${input.excerpt}`

  return [
    "Create a polished editorial hero image for a Hireoven blog article.",
    `Article category: ${input.category.name}.`,
    `Article subject: ${subject}`,
    "Visual direction: premium SaaS editorial image with job market intelligence, hiring signals, immigration or interview strategy cues when relevant.",
    "Composition: wide landscape, useful as a blog card and article hero, strong focal point, enough calm negative space for surrounding HTML text.",
    "Style: clean 3D/product editorial render with subtle dashboard panels, charts, company signal tiles, documents, or workspace objects as appropriate.",
    "Palette: Hireoven orange accents (#FF5C18), deep navy, white, soft blue, and small emerald success accents; balanced, not one-note.",
    "Constraints: no readable text, no logos, no brand names, no watermarks, no people, no faces, no animals, no fake UI typography.",
  ].join("\n")
}

export function isOpenAIImageGenerationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.BLOG_IMAGE_GENERATION_ENABLED !== "false")
}

export async function generateBlogImageBytes(input: BlogImageInput): Promise<GeneratedBlogImageBytes> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model = process.env.BLOG_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL
  const size = process.env.BLOG_IMAGE_SIZE?.trim() || DEFAULT_IMAGE_SIZE
  const quality = process.env.BLOG_IMAGE_QUALITY?.trim() || DEFAULT_IMAGE_QUALITY
  const outputFormat = process.env.BLOG_IMAGE_OUTPUT_FORMAT?.trim() || DEFAULT_IMAGE_FORMAT
  const prompt = buildPrompt(input)

  const response = await fetch(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size,
      quality,
      output_format: outputFormat,
      output_compression: 85,
      moderation: "auto",
    }),
  })

  const json = (await response.json()) as OpenAIImageResponse
  if (!response.ok) {
    throw new Error(json.error?.message || `OpenAI image generation failed with status ${response.status}`)
  }

  const imageBase64 = json.data?.[0]?.b64_json
  if (!imageBase64) {
    throw new Error("OpenAI image response did not include b64_json")
  }

  const buffer = Buffer.from(imageBase64, "base64")
  const extension = outputFormat === "png" ? "png" : outputFormat === "jpeg" ? "jpg" : "webp"
  const contentType = outputFormat === "png" ? "image/png" : outputFormat === "jpeg" ? "image/jpeg" : "image/webp"

  return {
    buffer,
    contentType,
    extension,
    prompt,
    alt: input.alt?.trim() || `${input.title} illustration`,
  }
}

export async function generateAndStoreBlogImage(input: BlogImageInput): Promise<GeneratedBlogImage | null> {
  if (!isBlogImageGenerationConfigured()) return null

  await ensureBlogImageStorageReady()

  const imageBytes = await generateBlogImageBytes(input)
  const stored = await uploadBlogImageBuffer({
    key: `blog/${input.postId}/hero.${imageBytes.extension}`,
    buffer: imageBytes.buffer,
    contentType: imageBytes.contentType,
  })

  return {
    url: stored.url,
    key: stored.key,
    prompt: imageBytes.prompt,
    alt: imageBytes.alt,
  }
}

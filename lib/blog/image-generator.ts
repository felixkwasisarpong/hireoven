import {
  ensureBlogImageStorageReady,
  uploadBlogImageBuffer,
  isBlogImageStorageConfigured,
} from "@/lib/blog/image-storage"
import sharp from "sharp"
import type { BlogCategory } from "@/types/blog"

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations"
const DEFAULT_IMAGE_MODEL = "gpt-image-1.5"
const DEFAULT_IMAGE_SIZE = "1536x1024"
const DEFAULT_IMAGE_QUALITY = "medium"
const DEFAULT_IMAGE_FORMAT = "webp"
const MIN_IMAGE_BYTES = 2048
const MIN_IMAGE_WIDTH = 900
const MIN_IMAGE_HEIGHT = 600
const IMAGE_SAMPLE_WIDTH = 96
const IMAGE_SAMPLE_HEIGHT = 64
const MIN_OPAQUE_RATIO = 0.5
const MIN_NON_WHITE_RATIO = 0.08
const MIN_LUMA_STDDEV = 8
const TITLE_MAX_LINES = 4
const EXCERPT_MAX_LINES = 2

type OpenAIImageResponse = {
  data?: Array<{ b64_json?: string }>
  error?: { message?: string }
}

export type BlogImageInput = {
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

export type BlogImageInspection = {
  width: number
  height: number
  bytes: number
  opaqueRatio: number
  nonWhiteRatio: number
  lumaStdDev: number
}

function normalizeOverlayText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function escapeSvgText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function truncateLine(line: string, maxChars: number): string {
  const normalized = normalizeOverlayText(line)
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

export function wrapHeroOverlayText(text: string, maxChars: number, maxLines: number): string[] {
  const words = normalizeOverlayText(text).split(" ").filter(Boolean)
  if (!words.length || maxChars <= 0 || maxLines <= 0) return []

  const lines: string[] = []
  let current = ""
  let consumedAllWords = true

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars || !current) {
      current = candidate
      continue
    }

    lines.push(current)
    current = word

    if (lines.length === maxLines) {
      consumedAllWords = false
      break
    }
  }

  if (lines.length < maxLines && current) lines.push(current)
  const wrapped = lines.slice(0, maxLines).map((line) => truncateLine(line, maxChars))

  if (!consumedAllWords && wrapped.length) {
    wrapped[wrapped.length - 1] = withOverflowEllipsis(wrapped[wrapped.length - 1], maxChars)
  }

  return wrapped
}

export function isBlogImageGenerationConfigured(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() &&
      isBlogImageStorageConfigured() &&
      process.env.BLOG_IMAGE_GENERATION_ENABLED !== "false"
  )
}

function visualDirectionForCategory(category: BlogCategory): string {
  switch (category.slug) {
    case "h1b-visa-intel":
      return "Abstract global-mobility policy scene with route arcs, checkpoint markers, a sculptural hourglass form, and distant civic architecture silhouettes; no passports, forms, seals, flags, or official documents."
    case "job-market-pulse":
      return "Labor-market intelligence scene with unlabeled color blocks, role-cluster nodes, salary-band ribbons, and city/workspace depth cues; no dashboards, charts with axes, or screen UI."
    case "career-strategy":
      return "Practical job-search strategy scene with a polished desk, blank prioritization tiles, skill tokens, route paths, and layered workspace objects; no resumes, documents, notebooks with writing, or screen UI."
    case "tech-company-watch":
      return "Company-monitoring scene with grouped office silhouettes, startup workspace signals, hiring/freeze indicators, and an unlabeled market-map layer; no logos, signage, dashboards, or brand screens."
    case "interview-offers":
      return "Interview and offer-readiness scene with a clean keyboard, abstract score rings, compensation tokens, scheduling arcs, and negotiation markers; no calendars, notes, forms, or scorecards with writing."
    default:
      return "Job-market intelligence scene with layered abstract signals, tactile workspace objects, and clear editorial focus; no text-bearing objects."
  }
}

function buildPrompt(input: BlogImageInput): string {
  const promptSeed = input.imagePrompt?.trim()
  const reusableSeed =
    promptSeed && !/Create a polished editorial hero image|Article category:|Article subject:/i.test(promptSeed)
      ? promptSeed
      : ""
  const subject = `${input.title}. ${input.excerpt}${reusableSeed ? ` Visual cue: ${reusableSeed}` : ""}`

  return [
    "Create a polished editorial hero image for a Hireoven blog article.",
    `Article category: ${input.category.name}.`,
    `Article subject context only, not literal visual text: ${subject}`,
    `Category-specific visual direction: ${visualDirectionForCategory(input.category)}`,
    "Use visual metaphors instead of literal paperwork or interfaces: route arcs, colored blocks, blank cards, material tokens, depth layers, and architectural silhouettes.",
    "Composition: wide landscape for a blog card and article hero, detailed focal objects center-right, darker quieter left third for a deterministic title overlay, layered foreground/midground/background, no empty white center, no blank minimal canvas.",
    "Style: premium editorial render with crisp objects, believable depth, soft studio lighting, and tactile materials; sophisticated but not generic SaaS clip art.",
    "Palette: deep navy and warm off-white base with Hireoven orange accents (#FF5C18), soft blue surfaces, and small emerald signal accents; balanced, not one-note.",
    "Do not include text-bearing objects: no calendars, passports, ID cards, forms, certificates, spreadsheets, laptop or phone screens with UI, books, newspapers, badges, stamps, seals, flags, buttons, warning signs, or charts with axes/labels.",
    "Constraints: no readable text, no fake text, no letters, no numbers, no dates, no logos, no brand names, no watermarks, no people, no faces, no animals, no literal stop or pause symbols.",
  ].join("\n")
}

function withOverflowEllipsis(line: string, maxChars: number): string {
  const normalized = normalizeOverlayText(line)
  const base = normalized.length > maxChars ? normalized.slice(0, Math.max(0, maxChars - 3)) : normalized
  return `${base.trimEnd().replace(/\.*$/, "")}...`
}

export function buildBlogHeroOverlaySvg(input: BlogImageInput, width: number, height: number): string {
  const marginX = Math.round(width * 0.065)
  const top = Math.round(height * 0.105)
  const maxTextWidth = Math.round(width * 0.52)
  const titleFontSize = Math.max(42, Math.round(width * 0.035))
  const titleLineHeight = Math.round(titleFontSize * 1.13)
  const excerptFontSize = Math.max(22, Math.round(width * 0.017))
  const excerptLineHeight = Math.round(excerptFontSize * 1.35)
  const categoryFontSize = Math.max(18, Math.round(width * 0.015))
  const brandFontSize = Math.max(18, Math.round(width * 0.014))
  const titleMaxChars = Math.max(18, Math.floor(maxTextWidth / (titleFontSize * 0.53)))
  const excerptMaxChars = Math.max(34, Math.floor(maxTextWidth / (excerptFontSize * 0.51)))
  const category = normalizeOverlayText(input.category.name).toUpperCase()
  const titleLines = wrapHeroOverlayText(input.title, titleMaxChars, TITLE_MAX_LINES)
  const excerptLines = wrapHeroOverlayText(input.excerpt, excerptMaxChars, EXCERPT_MAX_LINES)
  const pillPaddingX = Math.round(categoryFontSize * 0.85)
  const pillHeight = Math.round(categoryFontSize * 2.2)
  const pillWidth = Math.min(maxTextWidth, Math.round(category.length * categoryFontSize * 0.62) + pillPaddingX * 2)
  const titleY = top + pillHeight + Math.round(titleFontSize * 0.85)
  const excerptY = titleY + titleLines.length * titleLineHeight + Math.round(excerptFontSize * 1.35)
  const brandY = height - Math.round(height * 0.08)

  const titleTspans = titleLines
    .map((line, index) => {
      const y = index === 0 ? titleY : titleLineHeight
      const attrs = index === 0 ? `x="${marginX}" y="${y}"` : `x="${marginX}" dy="${y}"`
      return `<tspan ${attrs}>${escapeSvgText(line)}</tspan>`
    })
    .join("")

  const excerptTspans = excerptLines
    .map((line, index) => {
      const y = index === 0 ? excerptY : excerptLineHeight
      const attrs = index === 0 ? `x="${marginX}" y="${y}"` : `x="${marginX}" dy="${y}"`
      return `<tspan ${attrs}>${escapeSvgText(line)}</tspan>`
    })
    .join("")

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="left-scrim" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#071426" stop-opacity="0.96"/>
      <stop offset="50%" stop-color="#071426" stop-opacity="0.76"/>
      <stop offset="78%" stop-color="#071426" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#071426" stop-opacity="0"/>
    </linearGradient>
    <filter id="copy-shadow" x="-10%" y="-20%" width="120%" height="150%">
      <feDropShadow dx="0" dy="4" stdDeviation="7" flood-color="#020617" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#left-scrim)"/>
  <rect x="${marginX}" y="${top}" width="${pillWidth}" height="${pillHeight}" rx="${Math.round(pillHeight / 2)}" fill="#FF5C18"/>
  <text x="${marginX + pillPaddingX}" y="${top + Math.round(pillHeight * 0.64)}" fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif" font-size="${categoryFontSize}" font-weight="800" letter-spacing="0">${escapeSvgText(category)}</text>
  <text fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif" font-size="${titleFontSize}" font-weight="850" letter-spacing="0" filter="url(#copy-shadow)">${titleTspans}</text>
  <text fill="#DCEBFF" font-family="Arial, Helvetica, sans-serif" font-size="${excerptFontSize}" font-weight="500" letter-spacing="0" opacity="0.94">${excerptTspans}</text>
  <text x="${marginX}" y="${brandY}" fill="#FFBE9A" font-family="Arial, Helvetica, sans-serif" font-size="${brandFontSize}" font-weight="800" letter-spacing="0">HIREOVEN BLOG</text>
</svg>`
}

export async function applyBlogHeroTextOverlay(
  buffer: Buffer,
  input: BlogImageInput,
  outputFormat = DEFAULT_IMAGE_FORMAT,
): Promise<Buffer> {
  const image = sharp(buffer, { failOn: "warning" })
  const metadata = await image.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0

  if (!width || !height) {
    throw new Error("Generated blog image is missing dimensions")
  }

  const composed = sharp(buffer)
    .composite([
      {
        input: Buffer.from(buildBlogHeroOverlaySvg(input, width, height)),
        left: 0,
        top: 0,
      },
    ])

  if (outputFormat === "png") {
    return composed.png({ quality: 90 }).toBuffer()
  }
  if (outputFormat === "jpeg") {
    return composed.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
  }
  return composed.webp({ quality: 85 }).toBuffer()
}

export function isOpenAIImageGenerationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.BLOG_IMAGE_GENERATION_ENABLED !== "false")
}

export async function inspectGeneratedBlogImageBuffer(buffer: Buffer): Promise<BlogImageInspection> {
  if (buffer.length < MIN_IMAGE_BYTES) {
    throw new Error(`Generated blog image is too small (${buffer.length} bytes)`)
  }

  let image = sharp(buffer, { failOn: "warning" })
  const metadata = await image.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0

  if (width < MIN_IMAGE_WIDTH || height < MIN_IMAGE_HEIGHT) {
    throw new Error(`Generated blog image dimensions are too small (${width}x${height})`)
  }

  const { data, info } = await image
    .resize(IMAGE_SAMPLE_WIDTH, IMAGE_SAMPLE_HEIGHT, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixels = info.width * info.height
  let opaque = 0
  let nonWhite = 0
  let lumaSum = 0
  let lumaSqSum = 0

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0
    if (alpha <= 16) continue

    opaque += 1
    const red = data[i] ?? 0
    const green = data[i + 1] ?? 0
    const blue = data[i + 2] ?? 0
    if (red < 245 || green < 245 || blue < 245) nonWhite += 1

    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    lumaSum += luma
    lumaSqSum += luma * luma
  }

  const opaqueRatio = pixels > 0 ? opaque / pixels : 0
  const nonWhiteRatio = pixels > 0 ? nonWhite / pixels : 0
  const mean = opaque > 0 ? lumaSum / opaque : 0
  const variance = opaque > 0 ? Math.max(0, lumaSqSum / opaque - mean * mean) : 0
  const lumaStdDev = Math.sqrt(variance)

  return {
    width,
    height,
    bytes: buffer.length,
    opaqueRatio,
    nonWhiteRatio,
    lumaStdDev,
  }
}

export async function assertUsableGeneratedBlogImage(buffer: Buffer): Promise<BlogImageInspection> {
  const inspection = await inspectGeneratedBlogImageBuffer(buffer)

  if (inspection.opaqueRatio < MIN_OPAQUE_RATIO) {
    throw new Error(
      `Generated blog image is mostly transparent (${Math.round(inspection.opaqueRatio * 100)}% opaque)`,
    )
  }
  if (inspection.nonWhiteRatio < MIN_NON_WHITE_RATIO) {
    throw new Error(
      `Generated blog image is mostly blank (${Math.round(inspection.nonWhiteRatio * 100)}% non-white pixels)`,
    )
  }
  if (inspection.lumaStdDev < MIN_LUMA_STDDEV) {
    throw new Error(
      `Generated blog image has too little visual detail (luma stddev ${inspection.lumaStdDev.toFixed(1)})`,
    )
  }

  return inspection
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

  const extension = outputFormat === "png" ? "png" : outputFormat === "jpeg" ? "jpg" : "webp"
  const contentType = outputFormat === "png" ? "image/png" : outputFormat === "jpeg" ? "image/jpeg" : "image/webp"
  const backgroundBuffer = Buffer.from(imageBase64, "base64")
  await assertUsableGeneratedBlogImage(backgroundBuffer)
  const buffer = await applyBlogHeroTextOverlay(backgroundBuffer, input, outputFormat)
  await assertUsableGeneratedBlogImage(buffer)

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

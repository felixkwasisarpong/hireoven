import { loadEnvConfig } from "@next/env"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import {
  generateAndStoreBlogImage,
  generateBlogImageBytes,
  isBlogImageGenerationConfigured,
  isOpenAIImageGenerationConfigured,
} from "@/lib/blog/image-generator"
import { getPostgresPool } from "@/lib/postgres/server"
import { updateBlogPostImage } from "@/lib/blog/queries"
import type { BlogCategory } from "@/types/blog"

loadEnvConfig(process.cwd())

type BlogImageBackfillRow = {
  id: string
  title: string
  excerpt: string
  image_prompt: string | null
  hero_image_alt: string | null
  category_id: number
  category_slug: string
  category_name: string
  category_description: string
  category_day_of_week: number
}

function flag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find((value) => value.startsWith(prefix))
  return arg ? arg.slice(prefix.length).trim() : null
}

const execute = process.argv.includes("--execute")
const limit = Number(flag("limit") ?? "25")
const status = flag("status") ?? "published"
const storage = flag("storage") ?? "minio"

if (!Number.isFinite(limit) || limit <= 0) {
  throw new Error("--limit must be a positive number")
}

if (!["published", "draft", "all"].includes(status)) {
  throw new Error("--status must be published, draft, or all")
}

if (!["minio", "public"].includes(storage)) {
  throw new Error("--storage must be minio or public")
}

async function loadRows(): Promise<BlogImageBackfillRow[]> {
  const pool = getPostgresPool()
  const statusClause = status === "all" ? "" : "AND p.status = $2"
  const params: Array<number | string> = [limit]
  if (status !== "all") params.push(status)

  const { rows } = await pool.query<BlogImageBackfillRow>(
    `SELECT p.id,
            p.title,
            p.excerpt,
            p.image_prompt,
            p.hero_image_alt,
            c.id AS category_id,
            c.slug AS category_slug,
            c.name AS category_name,
            c.description AS category_description,
            c.day_of_week AS category_day_of_week
     FROM blog_posts p
     JOIN blog_categories c ON c.id = p.category_id
     WHERE (p.hero_image_url IS NULL OR p.hero_image_url = '')
       ${statusClause}
     ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC
     LIMIT $1`,
    params
  )
  return rows
}

function categoryFromRow(row: BlogImageBackfillRow): BlogCategory {
  return {
    id: row.category_id,
    slug: row.category_slug,
    name: row.category_name,
    description: row.category_description,
    day_of_week: row.category_day_of_week,
  }
}

async function main() {
  const rows = await loadRows()
  console.log(`Found ${rows.length} blog post(s) without images.`)

  if (!execute) {
    for (const row of rows) {
      console.log(`DRY RUN ${row.id} ${row.category_slug} ${row.title}`)
    }
    console.log("Re-run with --execute to generate and store images.")
    return
  }

  if (storage === "minio" && !isBlogImageGenerationConfigured()) {
    throw new Error("Blog image generation is not configured. Check OPENAI_API_KEY and MINIO_* env vars.")
  }
  if (storage === "public" && !isOpenAIImageGenerationConfigured()) {
    throw new Error("OpenAI image generation is not configured. Check OPENAI_API_KEY.")
  }

  for (const row of rows) {
    console.log(`Generating image for ${row.id}: ${row.title}`)
    try {
      const input = {
        postId: row.id,
        category: categoryFromRow(row),
        title: row.title,
        excerpt: row.excerpt,
        imagePrompt: row.image_prompt,
        alt: row.hero_image_alt,
      }

      const image = storage === "public"
        ? await generateAndStorePublicImage(input)
        : await generateAndStoreBlogImage(input)

      if (!image) {
        console.log(`Skipped ${row.id}`)
        continue
      }

      await updateBlogPostImage({
        id: row.id,
        hero_image_url: image.url,
        hero_image_key: image.key,
        hero_image_alt: image.alt,
        image_prompt: image.prompt,
      })
      console.log(`Stored ${image.key}`)
    } catch (error) {
      console.error(`Failed ${row.id}: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
      break
    }
  }
}

async function generateAndStorePublicImage(input: Parameters<typeof generateBlogImageBytes>[0]) {
  const image = await generateBlogImageBytes(input)
  const relativePath = `blog/generated/${input.postId}/hero.${image.extension}`
  const filePath = path.join(process.cwd(), "public", relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, image.buffer)
  return {
    url: `/${relativePath}`,
    key: `public/${relativePath}`,
    prompt: image.prompt,
    alt: image.alt,
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPostgresPool().end()
  })

import { getPostgresPool } from "@/lib/postgres/server"
import type { BlogCategory, BlogPost } from "@/types/blog"

export const BLOG_TIME_ZONE = "America/Chicago"

const BLOG_WEEKDAY_TO_DAY_OF_WEEK: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function getBlogDayOfWeek(date = new Date()): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: BLOG_TIME_ZONE,
    weekday: "short",
  }).format(date)

  const day = BLOG_WEEKDAY_TO_DAY_OF_WEEK[weekday]
  if (day === undefined) {
    throw new Error(`Could not determine blog day of week for ${date.toISOString()}`)
  }
  return day
}

export async function getAllCategories(): Promise<BlogCategory[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<BlogCategory>(
    "SELECT * FROM blog_categories ORDER BY day_of_week ASC"
  )
  return rows
}

export async function getCategoryBySlug(slug: string): Promise<BlogCategory | null> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<BlogCategory>(
    "SELECT * FROM blog_categories WHERE slug = $1",
    [slug]
  )
  return rows[0] ?? null
}

export async function getCategoryForToday(): Promise<BlogCategory | null> {
  const pool = getPostgresPool()
  // Blog schedule is keyed to Central time, not the server/container timezone.
  const jsDay = getBlogDayOfWeek()
  if (jsDay === 0 || jsDay === 6) return null
  const { rows } = await pool.query<BlogCategory>(
    "SELECT * FROM blog_categories WHERE day_of_week = $1",
    [jsDay]
  )
  return rows[0] ?? null
}

export async function getPostForCategoryOnBlogDay(categoryId: number, date = new Date()): Promise<BlogPost | null> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<BlogPost>(
    `SELECT p.*, row_to_json(c.*) AS category
     FROM blog_posts p
     JOIN blog_categories c ON c.id = p.category_id
     WHERE p.category_id = $1
       AND (p.created_at AT TIME ZONE $2)::date = ($3::timestamptz AT TIME ZONE $2)::date
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [categoryId, BLOG_TIME_ZONE, date.toISOString()]
  )
  return rows[0] ?? null
}

/**
 * Any post created today, regardless of category.
 *
 * The old guard was per-category-per-day, which made sense when the weekday
 * decided the topic. Topic is now chosen by what is actually trending, so the
 * daily guard has to be category-agnostic or a trend that lands in a different
 * category would produce a second post on the same day.
 */
export async function getPostOnBlogDay(date = new Date()): Promise<BlogPost | null> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<BlogPost>(
    `SELECT p.*, row_to_json(c.*) AS category
     FROM blog_posts p
     JOIN blog_categories c ON c.id = p.category_id
     WHERE (p.created_at AT TIME ZONE $1)::date = ($2::timestamptz AT TIME ZONE $1)::date
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [BLOG_TIME_ZONE, date.toISOString()]
  )
  return rows[0] ?? null
}

/**
 * Titles and excerpts of recent posts, used to keep the scout off ground the
 * blog has already covered. Repetition was the original complaint: a fixed
 * weekday topic forced an H-1B post every Monday whether or not anything had
 * happened.
 */
export async function getRecentPostDigests(limit = 30): Promise<
  Array<{ title: string; excerpt: string | null; categorySlug: string; createdAt: string }>
> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{
    title: string
    excerpt: string | null
    category_slug: string
    created_at: string
  }>(
    `SELECT p.title, p.excerpt, c.slug AS category_slug, p.created_at
     FROM blog_posts p
     JOIN blog_categories c ON c.id = p.category_id
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [limit]
  )
  return rows.map((r) => ({
    title: r.title,
    excerpt: r.excerpt,
    categorySlug: r.category_slug,
    createdAt: r.created_at,
  }))
}

export async function getPublishedPosts(limit = 20): Promise<BlogPost[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<BlogPost>(
    `SELECT p.*, row_to_json(c.*) AS category
     FROM blog_posts p
     JOIN blog_categories c ON c.id = p.category_id
     WHERE p.status = 'published'
     ORDER BY p.published_at DESC
     LIMIT $1`,
    [limit]
  )
  return rows
}

export async function getPublishedPostsByCategory(categorySlug: string, limit = 20): Promise<BlogPost[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<BlogPost>(
    `SELECT p.*, row_to_json(c.*) AS category
     FROM blog_posts p
     JOIN blog_categories c ON c.id = p.category_id
     WHERE p.status = 'published' AND c.slug = $1
     ORDER BY p.published_at DESC
     LIMIT $2`,
    [categorySlug, limit]
  )
  return rows
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<BlogPost>(
    `SELECT p.*, row_to_json(c.*) AS category
     FROM blog_posts p
     JOIN blog_categories c ON c.id = p.category_id
     WHERE p.slug = $1`,
    [slug]
  )
  return rows[0] ?? null
}

export async function insertDraftPost(post: {
  category_id: number
  slug: string
  title: string
  excerpt: string
  body: string
  seo_description: string | null
  hero_image_url?: string | null
  hero_image_key?: string | null
  hero_image_alt?: string | null
  image_prompt?: string | null
  reading_time: number | null
}): Promise<string> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO blog_posts (
       category_id,
       slug,
       title,
       excerpt,
       body,
       seo_description,
       hero_image_url,
       hero_image_key,
       hero_image_alt,
       image_prompt,
       reading_time,
       status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')
     RETURNING id`,
    [
      post.category_id,
      post.slug,
      post.title,
      post.excerpt,
      post.body,
      post.seo_description,
      post.hero_image_url ?? null,
      post.hero_image_key ?? null,
      post.hero_image_alt ?? null,
      post.image_prompt ?? null,
      post.reading_time,
    ]
  )
  return rows[0].id
}

export async function updateBlogPostImage(post: {
  id: string
  hero_image_url: string | null
  hero_image_key: string | null
  hero_image_alt: string | null
  image_prompt: string | null
}): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE blog_posts
     SET hero_image_url = $1,
         hero_image_key = $2,
         hero_image_alt = $3,
         image_prompt = $4
     WHERE id = $5`,
    [post.hero_image_url, post.hero_image_key, post.hero_image_alt, post.image_prompt, post.id]
  )
}

export type BlogGenerationRunStatus =
  | "success"
  | "skipped_weekend"
  | "skipped_existing"
  /** Scout found nothing genuinely new — publishing nothing beats republishing. */
  | "skipped_no_trend"
  | "failed"

export async function recordBlogGenerationRun(run: {
  status: BlogGenerationRunStatus
  category_id?: number | null
  category_slug?: string | null
  blog_post_id?: string | null
  title?: string | null
  image_generated?: boolean | null
  image_error?: string | null
  duration_ms?: number | null
  error_message?: string | null
}): Promise<void> {
  const pool = getPostgresPool()
  try {
    await pool.query(
      `INSERT INTO blog_generation_runs (
         status,
         category_id,
         category_slug,
         blog_post_id,
         title,
         image_generated,
         image_error,
         duration_ms,
         error_message
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        run.status,
        run.category_id ?? null,
        run.category_slug ?? null,
        run.blog_post_id ?? null,
        run.title ?? null,
        run.image_generated ?? null,
        run.image_error ?? null,
        run.duration_ms ?? null,
        run.error_message ?? null,
      ]
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn("[blog/generate] run logging skipped", { message })
  }
}

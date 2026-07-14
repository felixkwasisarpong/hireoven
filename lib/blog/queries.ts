import { getPostgresPool } from "@/lib/postgres/server"
import type { BlogCategory, BlogPost } from "@/types/blog"

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
  // JS getDay(): 0=Sun, 1=Mon…5=Fri, 6=Sat — our DB uses 1–5 for Mon–Fri
  const jsDay = new Date().getDay()
  if (jsDay === 0 || jsDay === 6) return null
  const { rows } = await pool.query<BlogCategory>(
    "SELECT * FROM blog_categories WHERE day_of_week = $1",
    [jsDay]
  )
  return rows[0] ?? null
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

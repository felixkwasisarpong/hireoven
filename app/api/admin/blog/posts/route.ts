import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export async function GET() {
  await assertAdminAccess()
  const pool = getPostgresPool()
  const { rows } = await pool.query(
    `SELECT p.id, p.slug, p.title, p.excerpt, p.status, p.reading_time,
            p.hero_image_url, p.hero_image_key, p.hero_image_alt, p.image_prompt,
            p.published_at, p.created_at,
            c.name AS category_name, c.slug AS category_slug
     FROM blog_posts p
     JOIN blog_categories c ON c.id = p.category_id
     ORDER BY p.created_at DESC`
  )
  return NextResponse.json({ rows })
}

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["draft", "published"]),
})

export async function PATCH(request: NextRequest) {
  await assertAdminAccess()
  const body = patchSchema.parse(await request.json())
  const pool = getPostgresPool()

  if (body.status === "published") {
    const { rows } = await pool.query<{ has_image: boolean }>(
      `SELECT COALESCE(NULLIF(hero_image_url, ''), '') <> '' AS has_image
       FROM blog_posts
       WHERE id = $1
       LIMIT 1`,
      [body.id],
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }
    if (!rows[0].has_image) {
      return NextResponse.json(
        { error: "Cannot publish a blog post without a hero image." },
        { status: 409 },
      )
    }
  }

  await pool.query(
    `UPDATE blog_posts
     SET status = $1,
         published_at = CASE WHEN $1 = 'published' AND published_at IS NULL THEN now() ELSE published_at END
     WHERE id = $2`,
    [body.status, body.id]
  )

  return NextResponse.json({ ok: true })
}

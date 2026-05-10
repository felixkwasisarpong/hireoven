import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export type PromoRow = {
  id: string
  title: string
  subtitle: string
  description: string
  badge_label: string
  is_new: boolean
  theme: string
  icon: string
  cta_label: string
  cta_url: string
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
  updated_at: string
}

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const pool = getPostgresPool()
  const result = await pool.query<PromoRow>(
    `SELECT * FROM promos ORDER BY updated_at DESC`
  )
  return NextResponse.json({ promos: result.rows })
}

export async function POST(request: Request) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Partial<PromoRow>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Could not parse request body — make sure Content-Type is application/json" }, { status: 400 })
  }

  const { title, subtitle, description, badge_label, is_new, theme, icon, cta_label, cta_url, is_active, starts_at, ends_at } = body

  const missing = (["title", "subtitle", "description", "cta_label", "cta_url"] as const)
    .filter(k => !body[k]?.toString().trim())
  if (missing.length > 0) {
    return NextResponse.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400 })
  }

  const pool = getPostgresPool()
  const result = await pool.query<PromoRow>(
    `INSERT INTO promos (title, subtitle, description, badge_label, is_new, theme, icon, cta_label, cta_url, is_active, starts_at, ends_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      title!.trim(), subtitle!.trim(), description!.trim(),
      badge_label?.trim() || "Premium",
      is_new ?? false,
      theme || "orange",
      icon || "sparkles",
      cta_label!.trim(), cta_url!.trim(),
      is_active ?? false,
      starts_at || null, ends_at || null,
    ]
  )
  return NextResponse.json({ promo: result.rows[0] }, { status: 201 })
}

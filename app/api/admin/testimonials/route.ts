import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import { listAllTestimonials, type TestimonialRow } from "@/lib/marketing/social-proof-store"

export const runtime = "nodejs"

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const testimonials = await listAllTestimonials()
  return NextResponse.json({ testimonials })
}

export async function POST(request: Request) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Partial<TestimonialRow>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Could not parse request body" }, { status: 400 })
  }

  const missing = (["quote", "name", "role"] as const).filter((k) => !body[k]?.toString().trim())
  if (missing.length > 0) {
    return NextResponse.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400 })
  }

  const pool = getPostgresPool()
  const result = await pool.query<TestimonialRow>(
    `INSERT INTO testimonials (quote, name, role, org, avatar_url, is_published, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      body.quote!.trim(),
      body.name!.trim(),
      body.role!.trim(),
      body.org?.toString().trim() || null,
      body.avatar_url?.toString().trim() || null,
      body.is_published ?? false,
      Number.isFinite(body.sort_order) ? body.sort_order : 0,
    ],
  )
  return NextResponse.json({ testimonial: result.rows[0] }, { status: 201 })
}

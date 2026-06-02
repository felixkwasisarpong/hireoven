import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type TenantUserRow = {
  user_id: string
  created_at: string | null
  created_by_user_id: string | null
  email: string | null
  full_name: string | null
}

function missingTableResponse() {
  return NextResponse.json(
    {
      error: "signal_api_tenant_users table is missing",
      hint: "Run scripts/migrations/add-signal-api-tenant-users.sql",
    },
    { status: 503 }
  )
}

function handleKnownError(error: unknown): NextResponse | null {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : null
  if (code === "42P01" || code === "42703") return missingTableResponse()
  return null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { tenantId } = await params
  if (!tenantId?.trim()) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 })
  }

  const pool = getPostgresPool()
  try {
    const result = await pool.query<TenantUserRow>(
      `SELECT
         stu.user_id::text,
         stu.created_at::text,
         stu.created_by_user_id::text,
         p.email,
         p.full_name
       FROM signal_api_tenant_users stu
       LEFT JOIN profiles p ON p.id = stu.user_id
       WHERE stu.tenant_id = $1
       ORDER BY stu.created_at DESC`,
      [tenantId.trim()]
    )

    return NextResponse.json({
      tenantId: tenantId.trim(),
      users: result.rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        fullName: row.full_name,
        createdAt: row.created_at,
        createdByUserId: row.created_by_user_id,
      })),
    })
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { tenantId } = await params
  if (!tenantId?.trim()) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 })
  }

  const body = (await request.json().catch(() => ({}))) as { userId?: unknown }
  const userId = typeof body.userId === "string" ? body.userId.trim() : ""
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "userId must be a valid UUID" }, { status: 400 })
  }

  const pool = getPostgresPool()
  try {
    await pool.query(
      `INSERT INTO signal_api_tenant_users (
         tenant_id,
         user_id,
         created_by_user_id
       ) VALUES ($1, $2::uuid, $3::uuid)
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [tenantId.trim(), userId, access.profile.id]
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { tenantId } = await params
  if (!tenantId?.trim()) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 })
  }

  const userId = request.nextUrl.searchParams.get("userId")?.trim() || ""
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "userId query param must be a valid UUID" }, { status: 400 })
  }

  const pool = getPostgresPool()
  try {
    await pool.query(
      `DELETE FROM signal_api_tenant_users
       WHERE tenant_id = $1
         AND user_id = $2::uuid`,
      [tenantId.trim(), userId]
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

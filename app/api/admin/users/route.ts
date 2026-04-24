import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Profile } from "@/types"

type UserRow = {
  id: string
  email: string | null
  name: string | null
  joinedAt: string | null
  lastActiveAt: string | null
  isAdmin: boolean
  visaStatus: string | null
  isInternational: boolean
  watchlistCount: number
  alertCount: number
  pushEnabled: boolean
}

type UserIdRow = {
  user_id: string
}

async function listUsers() {
  const pool = getPostgresPool()
  const [profilesResult, watchlistResult, alertsResult, pushResult] = await Promise.all([
    pool.query<Profile>(
      `SELECT *
       FROM profiles
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1000`
    ),
    pool.query<UserIdRow>("SELECT user_id FROM watchlist"),
    pool.query<UserIdRow>("SELECT user_id FROM job_alerts"),
    pool.query<UserIdRow>("SELECT user_id FROM push_subscriptions"),
  ])

  const watchlistCount = new Map<string, number>()
  for (const row of watchlistResult.rows) {
    watchlistCount.set(row.user_id, (watchlistCount.get(row.user_id) ?? 0) + 1)
  }

  const alertCount = new Map<string, number>()
  for (const row of alertsResult.rows) {
    alertCount.set(row.user_id, (alertCount.get(row.user_id) ?? 0) + 1)
  }

  const pushUsers = new Set(pushResult.rows.map((row) => row.user_id))

  return profilesResult.rows.map((profile) => ({
    id: profile.id,
    email: profile.email ?? null,
    name: profile.full_name ?? null,
    joinedAt: profile.created_at ?? null,
    lastActiveAt: profile.updated_at ?? null,
    isAdmin: profile.is_admin ?? false,
    visaStatus: profile.visa_status ?? null,
    isInternational: profile.is_international ?? false,
    watchlistCount: watchlistCount.get(profile.id) ?? 0,
    alertCount: alertCount.get(profile.id) ?? 0,
    pushEnabled: pushUsers.has(profile.id),
  })) satisfies UserRow[]
}

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const users = await listUsers()
    return NextResponse.json({ users })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const body = (await request.json()) as
    | { action: "toggle-admin"; userId: string; isAdmin: boolean }
    | { action: "suspend"; userId: string }

  const pool = getPostgresPool()

  try {
    if (body.action === "toggle-admin") {
      await pool.query(
        `UPDATE profiles
         SET is_admin = $1,
             updated_at = now()
         WHERE id = $2`,
        [body.isAdmin, body.userId]
      )
      return NextResponse.json({ success: true })
    }

    if (body.action === "suspend") {
      await pool.query(
        `UPDATE profiles
         SET suspended_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [body.userId]
      )
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}

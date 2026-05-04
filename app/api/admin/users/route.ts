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
  plan: string          // "free" | "pro" | "pro_international"
  planStatus: string    // "active" | "trialing" | "canceled" | "free"
}

type UserIdRow = { user_id: string }
type SubRow = { user_id: string; plan: string; status: string }

async function listUsers() {
  const pool = getPostgresPool()
  const [profilesResult, watchlistResult, alertsResult, pushResult, subsResult] = await Promise.all([
    pool.query<Profile>(`SELECT * FROM profiles ORDER BY created_at DESC NULLS LAST LIMIT 1000`),
    pool.query<UserIdRow>("SELECT user_id FROM watchlist"),
    pool.query<UserIdRow>("SELECT user_id FROM job_alerts"),
    pool.query<UserIdRow>("SELECT user_id FROM push_subscriptions"),
    pool.query<SubRow>(
      `SELECT DISTINCT ON (user_id) user_id, plan, status
       FROM subscriptions
       WHERE status IN ('active', 'trialing')
       ORDER BY user_id, created_at DESC`
    ),
  ])

  const watchlistCount = new Map<string, number>()
  for (const r of watchlistResult.rows) watchlistCount.set(r.user_id, (watchlistCount.get(r.user_id) ?? 0) + 1)

  const alertCount = new Map<string, number>()
  for (const r of alertsResult.rows) alertCount.set(r.user_id, (alertCount.get(r.user_id) ?? 0) + 1)

  const pushUsers = new Set(pushResult.rows.map((r) => r.user_id))
  const planMap = new Map<string, { plan: string; status: string }>()
  for (const r of subsResult.rows) planMap.set(r.user_id, { plan: r.plan, status: r.status })

  return profilesResult.rows.map((p) => {
    const sub = planMap.get(p.id)
    return {
      id: p.id,
      email: p.email ?? null,
      name: p.full_name ?? null,
      joinedAt: p.created_at ?? null,
      lastActiveAt: p.updated_at ?? null,
      isAdmin: p.is_admin ?? false,
      visaStatus: p.visa_status ?? null,
      isInternational: p.is_international ?? false,
      watchlistCount: watchlistCount.get(p.id) ?? 0,
      alertCount: alertCount.get(p.id) ?? 0,
      pushEnabled: pushUsers.has(p.id),
      plan: sub?.plan ?? "free",
      planStatus: sub?.status ?? "free",
    } satisfies UserRow
  })
}

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    return NextResponse.json({ users: await listUsers() })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = (await request.json()) as
    | { action: "toggle-admin"; userId: string; isAdmin: boolean }
    | { action: "suspend"; userId: string }
    | { action: "set-plan"; userId: string; plan: "free" | "pro" | "pro_international" }

  const pool = getPostgresPool()

  try {
    if (body.action === "toggle-admin") {
      await pool.query(
        `UPDATE profiles SET is_admin = $1, updated_at = now() WHERE id = $2`,
        [body.isAdmin, body.userId]
      )
      return NextResponse.json({ ok: true })
    }

    if (body.action === "suspend") {
      await pool.query(
        `UPDATE profiles SET suspended_at = now(), updated_at = now() WHERE id = $1`,
        [body.userId]
      )
      return NextResponse.json({ ok: true })
    }

    if (body.action === "set-plan") {
      if (body.plan === "free") {
        // Cancel all active subscriptions for this user
        await pool.query(
          `UPDATE subscriptions
           SET status = 'canceled', updated_at = now()
           WHERE user_id = $1 AND status IN ('active', 'trialing')`,
          [body.userId]
        )
      } else {
        // Upsert a manual subscription row (no Stripe — admin override)
        await pool.query(
          `INSERT INTO subscriptions (user_id, plan, status, billing_interval, created_at, updated_at)
           VALUES ($1, $2, 'active', 'monthly', now(), now())
           ON CONFLICT (user_id) DO UPDATE
             SET plan = EXCLUDED.plan,
                 status = 'active',
                 updated_at = now()`,
          [body.userId, body.plan]
        ).catch(async () => {
          // No unique constraint on user_id — cancel existing and insert fresh
          await pool.query(
            `UPDATE subscriptions SET status = 'canceled', updated_at = now()
             WHERE user_id = $1 AND status IN ('active', 'trialing')`,
            [body.userId]
          )
          await pool.query(
            `INSERT INTO subscriptions (user_id, plan, status, billing_interval, created_at, updated_at)
             VALUES ($1, $2, 'active', 'monthly', now(), now())`,
            [body.userId, body.plan]
          )
        })
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

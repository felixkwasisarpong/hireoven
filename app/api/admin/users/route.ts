import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { createAdminClient } from "@/lib/supabase/admin"
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
  const supabase = createAdminClient()
  const [usersResponse, profilesResponse, watchlistResponse, alertsResponse, pushResponse] =
    await Promise.all([
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      supabase.from("profiles").select("*"),
      supabase.from("watchlist").select("user_id"),
      supabase.from("job_alerts").select("user_id"),
      supabase.from("push_subscriptions").select("user_id"),
    ])

  if (usersResponse.error) throw usersResponse.error
  if (profilesResponse.error) throw profilesResponse.error
  if (watchlistResponse.error) throw watchlistResponse.error
  if (alertsResponse.error) throw alertsResponse.error
  if (pushResponse.error) throw pushResponse.error

  const profiles = new Map(
    ((profilesResponse.data ?? []) as Profile[]).map((profile) => [profile.id, profile])
  )

  const watchlistCount = new Map<string, number>()
  for (const row of ((watchlistResponse.data ?? []) as UserIdRow[])) {
    watchlistCount.set(row.user_id, (watchlistCount.get(row.user_id) ?? 0) + 1)
  }

  const alertCount = new Map<string, number>()
  for (const row of ((alertsResponse.data ?? []) as UserIdRow[])) {
    alertCount.set(row.user_id, (alertCount.get(row.user_id) ?? 0) + 1)
  }

  const pushUsers = new Set(
    ((pushResponse.data ?? []) as UserIdRow[]).map((row) => row.user_id)
  )

  return (usersResponse.data?.users ?? []).map((user) => {
    const profile = profiles.get(user.id)
    return {
      id: user.id,
      email: user.email ?? profile?.email ?? null,
      name:
        (typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : null) ??
        profile?.full_name ??
        null,
      joinedAt: user.created_at ?? profile?.created_at ?? null,
      lastActiveAt: user.last_sign_in_at ?? null,
      isAdmin: profile?.is_admin ?? false,
      visaStatus: profile?.visa_status ?? null,
      isInternational: profile?.is_international ?? false,
      watchlistCount: watchlistCount.get(user.id) ?? 0,
      alertCount: alertCount.get(user.id) ?? 0,
      pushEnabled: pushUsers.has(user.id),
    } satisfies UserRow
  })
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

  const supabase = createAdminClient()

  try {
    if (body.action === "toggle-admin") {
      const { error } = await ((supabase.from("profiles") as any)
        .update({ is_admin: body.isAdmin } as any)
        .eq("id", body.userId))

      if (error) throw error
      return NextResponse.json({ success: true })
    }

    const { error } = await supabase.auth.admin.updateUserById(body.userId, {
      ban_duration: "876000h",
    })

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}

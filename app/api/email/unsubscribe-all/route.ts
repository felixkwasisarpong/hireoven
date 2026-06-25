import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import { suppress, updateUserEmailPreferences } from "@/lib/email/preferences"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Authenticated "unsubscribe from everything" — global suppression + all prefs off.
export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { rows } = await getPostgresPool().query<{ email: string }>(
    `SELECT email FROM profiles WHERE id = $1 LIMIT 1`,
    [user.sub]
  )
  const email = rows[0]?.email
  if (email) await suppress(email, "unsubscribe_all")
  await updateUserEmailPreferences(user.sub, {
    weekly_digest: false,
    layoff_alerts: false,
    scorecard_milestones: false,
    opt_expiration: false,
    lottery_brief: false,
  })
  return NextResponse.json({ ok: true })
}

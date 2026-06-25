import { NextRequest, NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth/session-user"
import {
  getUserEmailPreferences,
  updateUserEmailPreferences,
  type UserEmailPreferences,
} from "@/lib/email/preferences"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BOOL_KEYS = ["weekly_digest", "layoff_alerts", "scorecard_milestones", "opt_expiration", "lottery_brief"] as const
const DATE_KEYS = ["opt_end_date", "stem_opt_end_date"] as const

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const prefs = await getUserEmailPreferences(user.sub)
  return NextResponse.json({ preferences: prefs }, { headers: { "Cache-Control": "no-store" } })
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const patch: Partial<UserEmailPreferences> = {}

  for (const k of BOOL_KEYS) if (typeof body[k] === "boolean") patch[k] = body[k] as boolean
  if (typeof body.weekly_send_day === "number" && body.weekly_send_day >= 0 && body.weekly_send_day <= 6) {
    patch.weekly_send_day = body.weekly_send_day
  }
  if (typeof body.weekly_send_hour === "number" && body.weekly_send_hour >= 0 && body.weekly_send_hour <= 23) {
    patch.weekly_send_hour = body.weekly_send_hour
  }
  if (typeof body.timezone === "string" && body.timezone.length <= 64) patch.timezone = body.timezone
  for (const k of DATE_KEYS) {
    if (body[k] === null) patch[k] = null
    else if (typeof body[k] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body[k] as string)) patch[k] = body[k] as string
  }

  await updateUserEmailPreferences(user.sub, patch)
  const prefs = await getUserEmailPreferences(user.sub)
  return NextResponse.json({ preferences: prefs })
}

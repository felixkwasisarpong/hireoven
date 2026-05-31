import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  getAutoApplyPrefs,
  saveAutoApplyPrefs,
  getAutoApplyLog,
} from "@/lib/apex/auto-apply/store"
import { AUTO_APPLY_DEFAULTS } from "@/lib/apex/auto-apply/types"

function err(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}

/** GET /api/apex/auto-apply — return current prefs + today's log */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err(401, "Unauthorized")

  const [prefs, log] = await Promise.all([
    getAutoApplyPrefs(user.id),
    getAutoApplyLog(user.id, 50),
  ])
  return NextResponse.json({ prefs, log })
}

/** POST /api/apex/auto-apply — update prefs (enable/disable or update criteria) */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err(401, "Unauthorized")

  const body = await req.json().catch(() => null)
  if (!body) return err(400, "Invalid JSON")

  const current = await getAutoApplyPrefs(user.id)

  const updated = {
    enabled: body.enabled ?? current.enabled,
    criteria: { ...current.criteria, ...(body.criteria ?? {}) },
    enabledAt:
      body.enabled === true && !current.enabled
        ? new Date().toISOString()
        : body.enabled === false
          ? null
          : current.enabledAt,
  }

  // Safety: cap daily limit at 20 to prevent runaway applies
  if (updated.criteria.dailyCap > 20) updated.criteria.dailyCap = 20
  // Safety: minimum match score 70 to prevent low-quality auto-applies
  if (updated.criteria.minMatchScore < 70) updated.criteria.minMatchScore = 70

  await saveAutoApplyPrefs(user.id, updated)
  return NextResponse.json({ prefs: updated })
}

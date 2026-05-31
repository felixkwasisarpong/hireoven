import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  getPendingCheckinForUser,
  markCheckinSkipped,
  completeCheckin,
  buildCheckinOpeningMessage,
} from "@/lib/checkins/delivery-engine"

export const dynamic = "force-dynamic"

// GET — return the next pending check-in for this user (if any)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ checkin: null })

  try {
    const checkin = await getPendingCheckinForUser(user.id)
    if (!checkin) return NextResponse.json({ checkin: null })

    return NextResponse.json({
      checkin: {
        id: checkin.id,
        type: checkin.checkin_type,
        companyName: checkin.company_name,
        roleTitle: checkin.role_title,
        openingMessage: buildCheckinOpeningMessage(checkin),
        scheduledAt: checkin.scheduled_at,
      },
    })
  } catch {
    return NextResponse.json({ checkin: null })
  }
}

// POST — complete or skip a check-in
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

  const { checkinId, action, responses } = body as {
    checkinId?: string
    action?: "complete" | "skip"
    responses?: Record<string, unknown>
  }

  if (!checkinId) return NextResponse.json({ error: "checkinId required" }, { status: 400 })

  try {
    if (action === "skip") {
      await markCheckinSkipped(checkinId, user.id)
      return NextResponse.json({ ok: true, action: "skipped" })
    }

    if (action === "complete" && responses) {
      await completeCheckin(checkinId, user.id, responses)
      return NextResponse.json({ ok: true, action: "completed" })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (err) {
    console.error("[apex/checkin] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

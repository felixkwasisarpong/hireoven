/**
 * GET /api/apex/usage — dev dashboard data
 *
 * Returns in-memory tracker stats + cache stats.
 * Only accessible in development or by admin users.
 */

import { NextResponse } from "next/server"
import { budgetTracker } from "@/lib/apex/budget/tracker"
import { apexCache } from "@/lib/apex/budget/cache"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    // In production only allow admin users (check email domain or role)
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim())
    if (!user || (!adminEmails.includes(user.email ?? ""))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  return NextResponse.json({
    stats:     budgetTracker.stats(),
    cache:     apexCache.stats(),
    slowest:   budgetTracker.slowest(10),
    expensive: budgetTracker.mostExpensive(10),
    failed:    budgetTracker.failed(20),
    recent:    budgetTracker.recent(50),
  })
}

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: apps } = await (supabase as any)
    .from("job_applications")
    .select("status, applied_at, created_at, updated_at, timeline")
    .eq("user_id", user.id)
    .eq("is_archived", false)

  const applications: any[] = apps ?? []

  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 86400000)
  const monthAgo = new Date(now.getTime() - 30 * 86400000)

  const by_status: Record<string, number> = {
    saved: 0, applied: 0, phone_screen: 0, interview: 0,
    final_round: 0, offer: 0, rejected: 0, withdrawn: 0,
  }
  for (const app of applications) {
    if (by_status[app.status] !== undefined) by_status[app.status]++
    else by_status[app.status] = 1
  }

  const total = applications.length
  const applied = by_status.applied + by_status.phone_screen + by_status.interview +
    by_status.final_round + by_status.offer + by_status.rejected + by_status.withdrawn

  const responded = by_status.phone_screen + by_status.interview +
    by_status.final_round + by_status.offer + by_status.rejected + by_status.withdrawn

  const response_rate = applied > 0 ? Math.round((responded / applied) * 100) : 0

  // Conversion rates
  const applied_to_phone = by_status.applied > 0
    ? Math.round((by_status.phone_screen / (by_status.applied + by_status.phone_screen)) * 100) : 0
  const phone_to_interview = (by_status.phone_screen + by_status.interview) > 0
    ? Math.round((by_status.interview / (by_status.phone_screen + by_status.interview)) * 100) : 0
  const interview_to_offer = (by_status.interview + by_status.final_round + by_status.offer) > 0
    ? Math.round((by_status.offer / (by_status.interview + by_status.final_round + by_status.offer)) * 100) : 0
  const overall = applied > 0 ? Math.round((by_status.offer / applied) * 100) : 0

  // Avg days to response — find first non-applied status change in timeline
  const responseTimes: number[] = []
  for (const app of applications) {
    if (!app.applied_at) continue
    const timeline: any[] = app.timeline ?? []
    const firstResponse = timeline.find(
      (e: any) => e.auto && e.status && !["saved", "applied"].includes(e.status)
    )
    if (firstResponse) {
      const days = (new Date(firstResponse.date).getTime() - new Date(app.applied_at).getTime()) / 86400000
      if (days >= 0 && days < 365) responseTimes.push(days)
    }
  }
  const avg_days_to_response = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0

  const applications_this_week = applications.filter(
    (a) => new Date(a.created_at) >= weekAgo
  ).length
  const applications_this_month = applications.filter(
    (a) => new Date(a.created_at) >= monthAgo
  ).length

  return NextResponse.json({
    total,
    by_status,
    conversion_rates: { applied_to_phone, phone_to_interview, interview_to_offer, overall },
    avg_days_to_response,
    avg_days_in_interview: 0,
    applications_this_week,
    applications_this_month,
    response_rate,
  })
}

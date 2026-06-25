import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { renderOptExpiration, type OptStage } from "@/lib/email/templates/opt-expiration"
import { generateUnsubscribeToken } from "@/lib/email/unsubscribe"
import { unsubscribeUrl, unsubscribePostUrl, appUrl } from "@/lib/email/templates/layout"
import { sendManaged } from "@/lib/email/provider"

export const runtime = "nodejs"
export const maxDuration = 120
export const dynamic = "force-dynamic"

// Schedule: daily. Fires OPT / STEM-OPT expiration reminders at exactly 90 / 30 / 7
// days out. ONLY for users who explicitly provided a date (the data entry is the
// consent) and kept opt_expiration on.
const STAGES: OptStage[] = [90, 30, 7]

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const start = Date.now()
  const pool = getPostgresPool()

  const { rows } = await pool.query<{
    user_id: string
    email: string
    opt_end_date: string | null
    stem_opt_end_date: string | null
    opt_days: number | null
    stem_days: number | null
  }>(
    `SELECT pr.user_id::text, prof.email, pr.opt_end_date, pr.stem_opt_end_date,
            (pr.opt_end_date - CURRENT_DATE) AS opt_days,
            (pr.stem_opt_end_date - CURRENT_DATE) AS stem_days
     FROM user_email_preferences pr
     JOIN profiles prof ON prof.id = pr.user_id
     WHERE pr.opt_expiration = true AND prof.email IS NOT NULL
       AND (pr.opt_end_date IS NOT NULL OR pr.stem_opt_end_date IS NOT NULL)`
  )

  let sent = 0
  const results: Record<string, number> = {}

  async function fire(userId: string, email: string, stage: OptStage, isStem: boolean, dateKey: string) {
    const token = await generateUnsubscribeToken(userId, "opt_expiration")
    const rendered = renderOptExpiration({
      stage,
      isStem,
      capExemptUrl: appUrl("/h1b-sponsors/leaderboard?cap_exempt_only=true"),
      everifyUrl: appUrl("/h1b-sponsors/leaderboard?e_verify_only=true"),
      scorecardUrl: appUrl("/dashboard/scorecard"),
      unsubscribeUrl: unsubscribeUrl(token),
    })
    const result = await sendManaged({
      userId,
      emailType: `opt_expiration`,
      dedupeKey: `opt:${userId}:${isStem ? "stem" : "opt"}:${stage}:${dateKey}`,
      toEmail: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: unsubscribePostUrl(token),
    })
    results[result] = (results[result] ?? 0) + 1
    if (result === "sent") sent++
  }

  for (const r of rows) {
    if (r.opt_end_date && r.opt_days != null && STAGES.includes(r.opt_days as OptStage)) {
      await fire(r.user_id, r.email, r.opt_days as OptStage, false, r.opt_end_date)
    }
    if (r.stem_opt_end_date && r.stem_days != null && STAGES.includes(r.stem_days as OptStage)) {
      await fire(r.user_id, r.email, r.stem_days as OptStage, true, r.stem_opt_end_date)
    }
  }

  return NextResponse.json({ ok: true, candidates: rows.length, sent, results, duration_ms: Date.now() - start })
}

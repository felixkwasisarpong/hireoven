import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { renderScorecardMilestone } from "@/lib/email/templates/scorecard-milestone"
import { generateUnsubscribeToken } from "@/lib/email/unsubscribe"
import { unsubscribeUrl, unsubscribePostUrl, appUrl } from "@/lib/email/templates/layout"
import { sendManaged } from "@/lib/email/provider"

export const runtime = "nodejs"
export const maxDuration = 120
export const dynamic = "force-dynamic"

// Schedule: daily. For each public personal scorecard, fire a milestone email at the
// highest view-count threshold not yet sent. Above 10,000 we stop — the user knows.
const THRESHOLDS = [10, 100, 1000, 10000]

function thresholdFor(views: number): number | null {
  let hit: number | null = null
  for (const t of THRESHOLDS) if (views >= t) hit = t
  return hit
}

// Matches the embed-impression subject hashing (sha256 of share_token, truncated)
// so we can read top referer domains. Inlined to keep this independent of the embed
// module; the embed_events read is best-effort and degrades to "across the web".
function hashSubject(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32)
}

async function topDomains(pool: ReturnType<typeof getPostgresPool>, shareToken: string): Promise<string[]> {
  try {
    const { rows } = await pool.query<{ referer_domain: string }>(
      `SELECT referer_domain FROM embed_events
       WHERE widget_type = 'personal' AND subject_id = $1 AND referer_domain IS NOT NULL
       GROUP BY referer_domain ORDER BY COUNT(*) DESC LIMIT 3`,
      [hashSubject(shareToken)]
    )
    return rows.map((d) => d.referer_domain)
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const start = Date.now()
  const pool = getPostgresPool()

  const { rows } = await pool.query<{ user_id: string; share_token: string; view_count: number; email: string }>(
    `SELECT ps.user_id::text, ps.share_token, ps.view_count, prof.email
     FROM personal_scorecards ps
     JOIN profiles prof ON prof.id = ps.user_id
     LEFT JOIN user_email_preferences pr ON pr.user_id = ps.user_id
     WHERE ps.is_public = true AND ps.share_token IS NOT NULL
       AND prof.email IS NOT NULL AND ps.view_count >= 10
       AND COALESCE(pr.scorecard_milestones, true) = true`
  )

  let sent = 0
  const results: Record<string, number> = {}

  for (const r of rows) {
    const threshold = thresholdFor(r.view_count)
    if (!threshold) continue

    const token = await generateUnsubscribeToken(r.user_id, "scorecard_milestone")
    const rendered = renderScorecardMilestone({
      views: threshold,
      topDomains: await topDomains(pool, r.share_token),
      cardUrl: appUrl(`/scorecard/${r.share_token}`),
      embedUrl: appUrl("/dashboard/scorecard"),
      revokeUrl: appUrl("/dashboard/scorecard"),
      unsubscribeUrl: unsubscribeUrl(token),
    })
    const result = await sendManaged({
      userId: r.user_id,
      emailType: "scorecard_milestone",
      dedupeKey: `milestone:${r.user_id}:${threshold}`,
      toEmail: r.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: unsubscribePostUrl(token),
    })
    results[result] = (results[result] ?? 0) + 1
    if (result === "sent") sent++
  }

  return NextResponse.json({ ok: true, candidates: rows.length, sent, results, duration_ms: Date.now() - start })
}

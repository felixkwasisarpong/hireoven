import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { requireSignalApiAuth } from "@/lib/signal-api/auth"
import { logAndReturnSignalApiResponse } from "@/lib/signal-api/request-log"

export const runtime = "nodejs"

const POLL_INTERVAL_MS = 30_000
const KEEPALIVE_MS = 15_000
const MIN_ALERT_SCORE = 80

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(request: Request) {
  const startedAtMs = Date.now()
  const auth = await requireSignalApiAuth(request, {
    requiredScopes: ["signals.read"],
    requireUser: true,
  })
  if (auth instanceof NextResponse) return auth

  const userId = auth.subjectUserId!
  let lastCheckedAt = new Date(Date.now() - POLL_INTERVAL_MS).toISOString()
  let closed = false

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk))
      }

      send(": signal-v1-alerts connected\n\n")

      const keepaliveTimer = setInterval(() => {
        send(": keepalive\n\n")
      }, KEEPALIVE_MS)

      const pollTimer = setInterval(async () => {
        if (closed) return
        try {
          const checkedAt = lastCheckedAt
          lastCheckedAt = new Date().toISOString()

          // company name lives in `companies`; the match score is per-user in
          // `job_match_scores` (jobs has neither column).
          const pool = getPostgresPool()
          const { rows: jobs } = await pool.query<{
            id: string
            title: string
            company_name: string | null
            match_score: number | null
            location: string | null
            is_remote: boolean | null
            created_at: string
          }>(
            `SELECT j.id, j.title, c.name AS company_name,
                    jms.overall_score AS match_score, j.location, j.is_remote, j.created_at
             FROM jobs j
             JOIN job_match_scores jms ON jms.job_id = j.id AND jms.user_id = $1
             LEFT JOIN companies c ON c.id = j.company_id
             WHERE j.created_at >= $2
               AND jms.overall_score >= $3
               AND COALESCE(j.raw_data->>'signalTenantId', '') = $4
             ORDER BY jms.overall_score DESC
             LIMIT 5`,
            [userId, checkedAt, MIN_ALERT_SCORE, auth.tenantId]
          )

          if (!jobs.length) return

          for (const job of jobs) {
            const eventType = (job.match_score ?? 0) >= 95 ? "top_drop" : "new_match"
            send(sseEvent(eventType, {
              jobId: job.id,
              title: job.title,
              company: job.company_name,
              matchScore: job.match_score,
              location: job.location,
              isRemote: job.is_remote,
              alertedAt: new Date().toISOString(),
              subjectUserId: userId,
            }))
          }
        } catch {
          // Keep stream alive; drop transient poll failures.
        }
      }, POLL_INTERVAL_MS)

      request.signal.addEventListener("abort", () => {
        closed = true
        clearInterval(keepaliveTimer)
        clearInterval(pollTimer)
        controller.close()
      })
    },
  })

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Request-Id": auth.requestId,
      "X-RateLimit-Limit": String(auth.rateLimit.limit),
      "X-RateLimit-Remaining": String(auth.rateLimit.remaining),
      "X-RateLimit-Reset": String(auth.rateLimit.reset),
      "X-Quota-Plan": auth.quota.planName,
      "X-Quota-Enforced": auth.quota.enforce ? "1" : "0",
      "X-Quota-Daily-Limit":
        auth.quota.dailyLimit == null ? "-1" : String(auth.quota.dailyLimit),
      "X-Quota-Daily-Remaining":
        auth.quota.dailyRemaining == null ? "-1" : String(auth.quota.dailyRemaining),
      "X-Quota-Daily-Reset": String(auth.quota.dailyReset),
      "X-Quota-Monthly-Limit":
        auth.quota.monthlyLimit == null ? "-1" : String(auth.quota.monthlyLimit),
      "X-Quota-Monthly-Remaining":
        auth.quota.monthlyRemaining == null ? "-1" : String(auth.quota.monthlyRemaining),
      "X-Quota-Monthly-Reset": String(auth.quota.monthlyReset),
    },
  })
  return logAndReturnSignalApiResponse(request, auth, startedAtMs, response)
}

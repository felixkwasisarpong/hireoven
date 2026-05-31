import { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

/**
 * GET /api/apex/alerts — Server-Sent Events stream for real-time job alerts.
 *
 * The client connects once and keeps the connection open. The server polls
 * every 30 s for new high-match jobs and pushes them as SSE events.
 *
 * Event types:
 *   "new_match"    — a freshly-indexed job clears the user's match threshold
 *   "top_drop"     — a job with score ≥ 95 just appeared
 *   "keepalive"    — heartbeat comment every 15 s to prevent proxy timeouts
 */

const POLL_INTERVAL_MS = 30_000
const KEEPALIVE_MS     = 15_000
const MIN_ALERT_SCORE  = 80

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  const userId = user.id
  let lastCheckedAt = new Date(Date.now() - POLL_INTERVAL_MS).toISOString()
  let closed = false

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(chunk: string) {
        if (!closed) controller.enqueue(encoder.encode(chunk))
      }

      // Initial keepalive so the client knows the connection is live
      send(": apex-alerts connected\n\n")

      // Keepalive timer
      const keepaliveTimer = setInterval(() => {
        send(": keepalive\n\n")
      }, KEEPALIVE_MS)

      // Poll timer
      const pollTimer = setInterval(async () => {
        if (closed) return
        try {
          const checkedAt = lastCheckedAt
          lastCheckedAt = new Date().toISOString()

          // Query recent high-match jobs via the postgres pool (server supabase
          // client is auth-only here). Defensive: any schema mismatch just
          // yields no events rather than breaking the stream.
          const pool = getPostgresPool()
          const { rows: jobs } = await pool.query<{
            id: string; title: string; company_name: string | null;
            match_score: number | null; location: string | null;
            is_remote: boolean | null; created_at: string;
          }>(
            `SELECT id, title, company_name, match_score, location, is_remote, created_at
             FROM jobs
             WHERE created_at >= $1 AND match_score >= $2
             ORDER BY match_score DESC
             LIMIT 5`,
            [checkedAt, MIN_ALERT_SCORE],
          )

          if (!jobs.length) return

          for (const job of jobs) {
            const eventType = (job.match_score ?? 0) >= 95 ? "top_drop" : "new_match"
            send(sseEvent(eventType, {
              jobId:      job.id,
              title:      job.title,
              company:    job.company_name,
              matchScore: job.match_score,
              location:   job.location,
              isRemote:   job.is_remote,
              alertedAt:  new Date().toISOString(),
            }))
          }
        } catch {
          // Silently skip poll errors — client stays connected
        }
      }, POLL_INTERVAL_MS)

      req.signal.addEventListener("abort", () => {
        closed = true
        clearInterval(keepaliveTimer)
        clearInterval(pollTimer)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

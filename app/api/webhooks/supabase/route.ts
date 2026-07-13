import { NextRequest, NextResponse } from "next/server"
import { requireWebhookAuth } from "@/lib/env"
import { processNotifications } from "@/lib/alerts/instant-notify"
import { scoreNewJobForAllUsers } from "@/lib/matching/batch-scorer"
import type { Job } from "@/types"

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE"
  table: string
  schema: string
  record: Job | null
  old_record: Job | null
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-supabase-webhook-secret") ?? request.headers.get("authorization")
  if (!requireWebhookAuth(signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let payload: WebhookPayload
  try {
    payload = (await request.json()) as WebhookPayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (payload.type !== "INSERT" || payload.table !== "jobs" || !payload.record) {
    return NextResponse.json({ skipped: true })
  }

  const job = payload.record

  // Return 200 immediately — Supabase retries on non-2xx, so we must not block.
  // Hourly accumulated instant-alert email is handled by /api/cron/instant-notify
  // unless accumulation is explicitly disabled.
  if ((process.env.ALERT_ACCUMULATE_MINUTES ?? "60") === "0") {
    void processNotifications([job])
  }
  void scoreNewJobForAllUsers(job)

  return NextResponse.json({
    received: true,
    jobId: job.id,
    notifications: (process.env.ALERT_ACCUMULATE_MINUTES ?? "60") === "0" ? "processed" : "deferred",
  })
}

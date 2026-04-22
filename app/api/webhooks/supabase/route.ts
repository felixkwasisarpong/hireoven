import { NextRequest, NextResponse } from "next/server"
import { matchJobToAlerts, matchJobToWatchlists } from "@/lib/alerts/matcher"
import {
  combineChannels,
  sendEmailAlert,
  sendPushNotification,
  sendWatchlistAlert,
} from "@/lib/alerts/sender"
import { requireWebhookAuth } from "@/lib/env"
import { scoreNewJobForAllUsers } from "@/lib/matching/batch-scorer"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Job, NotificationType } from "@/types"

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

  // Return 200 immediately - Supabase retries on non-2xx so we must not block
  void processNotifications(job)
  void scoreNewJobForAllUsers(job)

  return NextResponse.json({ received: true, jobId: job.id })
}

async function processNotifications(job: Job) {
  try {
    const supabase = createAdminClient()

    const [matchedAlerts, watchlistUserIds] = await Promise.all([
      matchJobToAlerts(job),
      matchJobToWatchlists(job),
    ])

    // Alert notifications - one alert may belong to many users, each alert has user_id
    for (const alert of matchedAlerts) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, email_alerts, push_alerts")
        .eq("id", alert.user_id)
        .single()

      if (!profile) continue

      const channel = combineChannels({
        emailSent: profile.email_alerts,
        pushSent: profile.push_alerts,
      })
      if (!channel) continue

      try {
        if (channel === "email" || channel === "both") {
          await sendEmailAlert(alert.user_id, [job], alert.name ?? "Job alert")
        }
        if (channel === "push" || channel === "both") {
          await sendPushNotification(alert.user_id, job, "alert")
        }
        await supabase.from("alert_notifications").insert({
          user_id: alert.user_id,
          job_id: job.id,
          alert_id: alert.id,
          notification_type: "alert" as NotificationType,
          channel,
        })
      } catch {
        // Don't let one user's failure block the rest
      }
    }

    // Watchlist notifications
    if (watchlistUserIds.length > 0) {
      const { data: company } = await supabase
        .from("companies")
        .select("name")
        .eq("id", job.company_id)
        .single()

      const companyName = (company as { name?: string } | null)?.name ?? "Tracked company"

      for (const userId of watchlistUserIds) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, email, email_alerts, push_alerts")
          .eq("id", userId)
          .single()

        if (!profile) continue

        const channel = combineChannels({
          emailSent: profile.email_alerts,
          pushSent: profile.push_alerts,
        })
        if (!channel) continue

        try {
          if (channel === "email" || channel === "both") {
            await sendWatchlistAlert(userId, [job], companyName)
          }
          if (channel === "push" || channel === "both") {
            await sendPushNotification(userId, job, "watchlist")
          }
          await supabase.from("alert_notifications").insert({
            user_id: userId,
            job_id: job.id,
            alert_id: null,
            notification_type: "watchlist" as NotificationType,
            channel,
          })
        } catch {
          // Don't let one user's failure block the rest
        }
      }
    }
  } catch {
    // Silent failure - webhook already returned 200
  }
}

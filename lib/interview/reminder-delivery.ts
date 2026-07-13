import webpush from "web-push"
import { getPostgresPool } from "@/lib/postgres/server"
import { configureWebPush } from "@/lib/alerts/sender"
import { getUserSubscriptions, isDeadSubscriptionError, removeSubscription } from "@/lib/alerts/push-subscriptions"
import { resolveAppOrigin } from "@/lib/app-url"
import {
  listDueReminders,
  type DueReminder,
} from "@/lib/interview/scheduling"

// Drains due interview_reminders rows and delivers them as push notifications.
// A reminder is marked sent after one delivery attempt — the in-app watcher
// (UpcomingInterviews polling + local notifications) covers users without push
// subscriptions, so we never retry-spam here. If web-push itself is
// unconfigured we deliver nothing and leave the rows unsent, so reminders
// resume (rather than vanish) once the VAPID env is fixed.

function reminderCopy(reminder: DueReminder): { title: string; body: string } {
  const minutesLeft = Math.max(
    0,
    Math.round((reminder.scheduledAt.getTime() - Date.now()) / 60_000)
  )
  switch (reminder.kind) {
    case "day_before":
      return {
        title: "Interview tomorrow 🎙️",
        body: `Your ${reminder.durationTargetMin}-min live mock interview is coming up. Review your notes tonight.`,
      }
    case "hour_before":
      return {
        title: "Interview in about an hour",
        body: `Your live mock interview starts in ~${minutesLeft || 60} minutes. Find a quiet spot and test your mic.`,
      }
    case "starting_soon":
      return {
        title: "Interview starting soon ⏰",
        body: `Your live mock interview starts in ${minutesLeft || 10} minutes. Tap to join the room.`,
      }
  }
}

type PushSubscriptionRecord = Awaited<ReturnType<typeof getUserSubscriptions>>[number]

async function pushReminder(
  reminder: DueReminder,
  subscriptions: PushSubscriptionRecord[],
  baseUrl: string
): Promise<boolean> {
  if (subscriptions.length === 0) return false

  const { title, body } = reminderCopy(reminder)
  const payload = JSON.stringify({
    title,
    body,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    data: { url: `${baseUrl}/dashboard/interview/live/${reminder.sessionId}` },
    actions: [
      { action: "view", title: "Open" },
      { action: "dismiss", title: "Dismiss" },
    ],
  })

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, payload)
        return true
      } catch (error) {
        if (isDeadSubscriptionError(error)) {
          await removeSubscription(subscription.endpoint)
          return false
        }
        console.error(
          `[interview-reminders] push failed for user ${reminder.userId}:`,
          error instanceof Error ? error.message : error
        )
        return false
      }
    })
  )
  return results.some((r) => r.status === "fulfilled" && r.value)
}

export async function deliverDueInterviewReminders(): Promise<{
  processed: number
  pushed: number
}> {
  const due = await listDueReminders()
  if (due.length === 0) return { processed: 0, pushed: 0 }

  try {
    configureWebPush()
  } catch (err) {
    // Leave the rows unsent — consuming them here would permanently drop
    // reminders over a fixable misconfiguration.
    console.error(
      "[interview-reminders] web-push unconfigured, leaving reminders pending:",
      err instanceof Error ? err.message : err
    )
    return { processed: 0, pushed: 0 }
  }

  const baseUrl = resolveAppOrigin()

  // One subscription lookup per user, not per reminder.
  const userIds = [...new Set(due.map((r) => r.userId))]
  const subscriptionsByUser = new Map<string, PushSubscriptionRecord[]>(
    await Promise.all(
      userIds.map(async (userId) =>
        [userId, await getUserSubscriptions(userId)] as const
      )
    )
  )

  const results = await Promise.allSettled(
    due.map((reminder) =>
      pushReminder(reminder, subscriptionsByUser.get(reminder.userId) ?? [], baseUrl)
    )
  )
  const pushed = results.filter((r) => r.status === "fulfilled" && r.value).length

  const pool = getPostgresPool()
  await pool.query(
    `UPDATE interview_reminders SET sent_at = NOW() WHERE id = ANY($1::uuid[])`,
    [due.map((r) => r.id)]
  )

  return { processed: due.length, pushed }
}

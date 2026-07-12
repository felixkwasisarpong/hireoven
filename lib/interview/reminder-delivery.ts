import webpush from "web-push"
import { getUserSubscriptions, removeSubscription } from "@/lib/alerts/push-subscriptions"
import { env } from "@/lib/env"
import {
  listDueReminders,
  markReminderSent,
  type DueReminder,
} from "@/lib/interview/scheduling"

// Drains due interview_reminders rows and delivers them as push notifications.
// A reminder is marked sent after one delivery attempt — the in-app watcher
// (UpcomingInterviews polling + local notifications) covers users without push
// subscriptions, so we never retry-spam here.

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const email = env.VAPID_EMAIL
  if (!publicKey || !privateKey || !email) throw new Error("Missing VAPID environment variables")
  webpush.setVapidDetails(email, publicKey, privateKey)
}

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

async function pushReminder(reminder: DueReminder): Promise<boolean> {
  const subscriptions = await getUserSubscriptions(reminder.userId)
  if (subscriptions.length === 0) return false

  const { title, body } = reminderCopy(reminder)
  const payload = JSON.stringify({
    title,
    body,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    data: { url: `${getBaseUrl()}/dashboard/interview/live/${reminder.sessionId}` },
    actions: [
      { action: "view", title: "Open" },
      { action: "dismiss", title: "Dismiss" },
    ],
  })

  let delivered = false
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, payload)
      delivered = true
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        await removeSubscription(subscription.endpoint)
        continue
      }
      console.error(
        `[interview-reminders] push failed for user ${reminder.userId}:`,
        error instanceof Error ? error.message : error
      )
    }
  }
  return delivered
}

export async function deliverDueInterviewReminders(): Promise<{
  processed: number
  pushed: number
}> {
  const due = await listDueReminders()
  if (due.length === 0) return { processed: 0, pushed: 0 }

  let webPushReady = true
  try {
    configureWebPush()
  } catch {
    webPushReady = false
  }

  let pushed = 0
  for (const reminder of due) {
    if (webPushReady) {
      try {
        if (await pushReminder(reminder)) pushed += 1
      } catch (error) {
        console.error(
          `[interview-reminders] delivery error for reminder ${reminder.id}:`,
          error instanceof Error ? error.message : error
        )
      }
    }
    await markReminderSent(reminder.id)
  }

  return { processed: due.length, pushed }
}

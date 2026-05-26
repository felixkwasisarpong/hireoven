import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import type { AlertNotificationWithDetails } from "@/types"
import NotificationsPageClient from "./NotificationsPageClient"

export const dynamic = "force-dynamic"

type NotificationInitialData = {
  initialServerNotifications: AlertNotificationWithDetails[]
  initialUnreadCount: number
  initialLoaded: boolean
}

async function fetchInitialNotifications(userId: string): Promise<{
  notifications: AlertNotificationWithDetails[]
  unreadCount: number
}> {
  const pool = getPostgresPool()
  const limit = 20
  const [notifResult, countResult] = await Promise.all([
    pool.query<AlertNotificationWithDetails>(
      `SELECT n.*,
              to_jsonb(j.*) || jsonb_build_object(
                'company', to_jsonb(c.*),
                'match_score', COALESCE(ms.match_score, 'null'::jsonb)
              ) AS job,
              to_jsonb(a.*) AS alert
       FROM alert_notifications n
       LEFT JOIN jobs j ON j.id = n.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       LEFT JOIN LATERAL (
         SELECT to_jsonb(s.*) AS match_score
         FROM job_match_scores s
         WHERE s.user_id = n.user_id
           AND s.job_id = n.job_id
         ORDER BY s.computed_at DESC
         LIMIT 1
       ) ms ON true
       LEFT JOIN job_alerts a ON a.id = n.alert_id
       WHERE n.user_id = $1::uuid
       ORDER BY n.sent_at DESC
       LIMIT $2 OFFSET 0`,
      [userId, limit],
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM alert_notifications
       WHERE user_id = $1::uuid
         AND opened_at IS NULL`,
      [userId],
    ),
  ])

  return {
    notifications: notifResult.rows,
    unreadCount: Number(countResult.rows[0]?.c ?? 0),
  }
}

async function getInitialData(): Promise<NotificationInitialData> {
  const fallback: NotificationInitialData = {
    initialServerNotifications: [],
    initialUnreadCount: 0,
    initialLoaded: false,
  }

  try {
    const user = await getSessionUser()
    if (!user?.sub) {
      return {
        initialServerNotifications: [],
        initialUnreadCount: 0,
        initialLoaded: true,
      }
    }

    const initial = await fetchInitialNotifications(user.sub)
    return {
      initialServerNotifications: initial.notifications,
      initialUnreadCount: initial.unreadCount,
      initialLoaded: true,
    }
  } catch {
    return fallback
  }
}

export default async function NotificationsPage() {
  const initialData = await getInitialData()
  return (
    <NotificationsPageClient
      initialServerNotifications={initialData.initialServerNotifications}
      initialUnreadCount={initialData.initialUnreadCount}
      initialLoaded={initialData.initialLoaded}
    />
  )
}

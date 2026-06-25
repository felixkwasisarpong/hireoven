import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

// Spec 08 — per-user email preferences + the global suppression list.

export type EmailType =
  | "weekly_digest"
  | "layoff_alert"
  | "scorecard_milestone"
  | "opt_expiration"
  | "lottery_brief"

export type SuppressionReason = "bounce" | "complaint" | "manual" | "unsubscribe_all"

export interface UserEmailPreferences {
  user_id: string
  weekly_digest: boolean
  layoff_alerts: boolean
  scorecard_milestones: boolean
  opt_expiration: boolean
  lottery_brief: boolean
  weekly_send_day: number
  weekly_send_hour: number
  timezone: string
  opt_end_date: string | null
  stem_opt_end_date: string | null
}

const DEFAULTS: Omit<UserEmailPreferences, "user_id"> = {
  weekly_digest: true,
  layoff_alerts: true,
  scorecard_milestones: true,
  opt_expiration: true,
  lottery_brief: true,
  weekly_send_day: 1,
  weekly_send_hour: 8,
  timezone: "America/New_York",
  opt_end_date: null,
  stem_opt_end_date: null,
}

// Maps an EmailType to the preference column that gates it.
const TYPE_TO_PREF: Record<string, keyof UserEmailPreferences> = {
  weekly_digest: "weekly_digest",
  layoff_alert: "layoff_alerts",
  scorecard_milestone: "scorecard_milestones",
  opt_expiration: "opt_expiration",
  opt_expiration_90: "opt_expiration",
  opt_expiration_30: "opt_expiration",
  opt_expiration_7: "opt_expiration",
  lottery_brief: "lottery_brief",
}

function iso(d: Date | string | null): string | null {
  if (!d) return null
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

export async function getUserEmailPreferences(userId: string): Promise<UserEmailPreferences> {
  if (!hasPostgresEnv()) return { user_id: userId, ...DEFAULTS }
  const { rows } = await getPostgresPool().query(
    `SELECT * FROM user_email_preferences WHERE user_id = $1`,
    [userId]
  )
  const r = rows[0]
  if (!r) return { user_id: userId, ...DEFAULTS }
  return {
    user_id: userId,
    weekly_digest: r.weekly_digest,
    layoff_alerts: r.layoff_alerts,
    scorecard_milestones: r.scorecard_milestones,
    opt_expiration: r.opt_expiration,
    lottery_brief: r.lottery_brief,
    weekly_send_day: r.weekly_send_day,
    weekly_send_hour: r.weekly_send_hour,
    timezone: r.timezone,
    opt_end_date: iso(r.opt_end_date),
    stem_opt_end_date: iso(r.stem_opt_end_date),
  }
}

const PATCHABLE = new Set([
  "weekly_digest", "layoff_alerts", "scorecard_milestones", "opt_expiration", "lottery_brief",
  "weekly_send_day", "weekly_send_hour", "timezone", "opt_end_date", "stem_opt_end_date",
])

// Upsert a partial preferences patch. Unknown keys are ignored. Creates the row
// (with defaults) on first write.
export async function updateUserEmailPreferences(
  userId: string,
  patch: Partial<UserEmailPreferences>
): Promise<void> {
  const entries = Object.entries(patch).filter(([k]) => PATCHABLE.has(k))
  if (entries.length === 0) return
  const pool = getPostgresPool()
  // Ensure a base row exists, then apply the patch.
  await pool.query(
    `INSERT INTO user_email_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  )
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`)
  await pool.query(
    `UPDATE user_email_preferences SET ${sets.join(", ")}, updated_at = NOW() WHERE user_id = $1`,
    [userId, ...entries.map(([, v]) => v)]
  )
}

// Whether a given user currently wants a given email type. Used at send time.
export async function wantsEmailType(userId: string, type: string): Promise<boolean> {
  const prefs = await getUserEmailPreferences(userId)
  const key = TYPE_TO_PREF[type]
  if (!key) return true
  return Boolean(prefs[key])
}

// --- Suppression list (global) ---------------------------------------------

export async function isEmailSuppressed(email: string): Promise<boolean> {
  if (!hasPostgresEnv() || !email) return false
  const { rows } = await getPostgresPool().query(
    `SELECT 1 FROM email_suppressions WHERE lower(email) = lower($1) LIMIT 1`,
    [email]
  )
  return rows.length > 0
}

export async function suppress(email: string, reason: SuppressionReason): Promise<void> {
  if (!email) return
  await getPostgresPool().query(
    `INSERT INTO email_suppressions (email, reason) VALUES (lower($1), $2)
     ON CONFLICT (email) DO NOTHING`,
    [email, reason]
  )
}

export async function unsuppress(email: string): Promise<void> {
  if (!email) return
  await getPostgresPool().query(`DELETE FROM email_suppressions WHERE lower(email) = lower($1)`, [email])
}

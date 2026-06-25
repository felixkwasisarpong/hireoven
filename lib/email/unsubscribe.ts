import { randomBytes } from "crypto"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { updateUserEmailPreferences, suppress, type EmailType } from "./preferences"

// Spec 08 — one-click unsubscribe tokens (RFC 8058). A token maps to a user and an
// optional email_type (NULL = unsubscribe from everything → global suppression).

// Maps the email_type stored on a token to the preference column to flip off.
const TYPE_TO_PREF_COLUMN: Record<string, keyof import("./preferences").UserEmailPreferences> = {
  weekly_digest: "weekly_digest",
  layoff_alert: "layoff_alerts",
  scorecard_milestone: "scorecard_milestones",
  opt_expiration: "opt_expiration",
  lottery_brief: "lottery_brief",
}

export async function generateUnsubscribeToken(
  userId: string,
  emailType?: EmailType | null
): Promise<string> {
  const token = randomBytes(24).toString("base64url")
  await getPostgresPool().query(
    `INSERT INTO email_unsubscribe_tokens (token, user_id, email_type) VALUES ($1, $2, $3)`,
    [token, userId, emailType ?? null]
  )
  return token
}

export async function resolveUnsubscribeToken(
  token: string
): Promise<{ user_id: string; email_type: string | null } | null> {
  if (!hasPostgresEnv() || !token) return null
  const { rows } = await getPostgresPool().query<{ user_id: string; email_type: string | null }>(
    `SELECT user_id::text, email_type FROM email_unsubscribe_tokens WHERE token = $1 LIMIT 1`,
    [token]
  )
  return rows[0] ?? null
}

// Apply an unsubscribe. A typed token flips that one preference off; an untyped
// token suppresses the address globally (no email type will send). Idempotent.
export async function applyUnsubscribe(
  token: string
): Promise<{ applied: boolean; email_type: string | null }> {
  const resolved = await resolveUnsubscribeToken(token)
  if (!resolved) return { applied: false, email_type: null }

  if (!resolved.email_type) {
    // Unsubscribe from everything → suppress the user's email.
    const { rows } = await getPostgresPool().query<{ email: string }>(
      `SELECT email FROM profiles WHERE id = $1 LIMIT 1`,
      [resolved.user_id]
    )
    const email = rows[0]?.email
    if (email) await suppress(email, "unsubscribe_all")
    return { applied: true, email_type: null }
  }

  const col = TYPE_TO_PREF_COLUMN[resolved.email_type]
  if (col) await updateUserEmailPreferences(resolved.user_id, { [col]: false })
  return { applied: true, email_type: resolved.email_type }
}

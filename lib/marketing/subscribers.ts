import crypto from "crypto"
import { getPostgresPool } from "@/lib/postgres/server"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function generateToken() {
  return crypto.randomBytes(24).toString("hex")
}

export async function upsertMarketingSubscriber({
  email,
  fullName,
  source,
  metadata,
}: {
  email: string
  fullName?: string | null
  source?: string
  metadata?: Record<string, unknown>
}) {
  const pool = getPostgresPool()
  const normalizedEmail = normalizeEmail(email)

  const existingResult = await pool.query<{
    id: string
    email: string
    unsubscribe_token: string | null
  }>(
    `SELECT id, email, unsubscribe_token
     FROM marketing_subscribers
     WHERE email = $1
     LIMIT 1`,
    [normalizedEmail]
  )
  const existing = existingResult.rows[0]

  const token = existing?.unsubscribe_token ?? generateToken()
  const payload = {
    email: normalizedEmail,
    full_name: fullName ?? null,
    source: source ?? "app",
    subscribed_to_marketing: true,
    unsubscribed_at: null,
    unsubscribe_token: token,
    metadata: metadata ?? {},
  }

  await pool.query(
    `INSERT INTO marketing_subscribers (
      email,
      full_name,
      source,
      subscribed_to_marketing,
      unsubscribed_at,
      unsubscribe_token,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    ON CONFLICT (email)
    DO UPDATE SET
      full_name = EXCLUDED.full_name,
      source = EXCLUDED.source,
      subscribed_to_marketing = EXCLUDED.subscribed_to_marketing,
      unsubscribed_at = EXCLUDED.unsubscribed_at,
      unsubscribe_token = EXCLUDED.unsubscribe_token,
      metadata = EXCLUDED.metadata,
      updated_at = now()`,
    [
      payload.email,
      payload.full_name,
      payload.source,
      payload.subscribed_to_marketing,
      payload.unsubscribed_at,
      payload.unsubscribe_token,
      JSON.stringify(payload.metadata ?? {}),
    ]
  )

  return { email: normalizedEmail, unsubscribeToken: token }
}

export async function unsubscribeMarketingByToken(token: string) {
  const pool = getPostgresPool()

  const subscriberResult = await pool.query<{ id: string; email: string }>(
    `SELECT id, email
     FROM marketing_subscribers
     WHERE unsubscribe_token = $1
     LIMIT 1`,
    [token]
  )
  const subscriber = subscriberResult.rows[0]

  if (!subscriber?.id) return null

  await pool.query(
    `UPDATE marketing_subscribers
     SET subscribed_to_marketing = false,
         unsubscribed_at = $1,
         updated_at = now()
     WHERE id = $2`,
    [new Date().toISOString(), subscriber.id]
  )

  return { id: subscriber.id, email: subscriber.email as string }
}

export function buildMarketingUnsubscribeUrl(token: string) {
  const site = getPublicSiteUrl()
  const url = new URL("/api/marketing/unsubscribe", site)
  url.searchParams.set("token", token)
  return url.toString()
}

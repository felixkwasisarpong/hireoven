import { NextResponse } from "next/server"
import { Resend } from "resend"
import { z } from "zod"
import { assertAdminAccess } from "@/lib/admin/auth"
import { generateUnsubscribeToken } from "@/lib/email/unsubscribe"
import { getSupportFromEmail } from "@/lib/email/identity"
import {
  buildMarketingUnsubscribeUrl,
  upsertMarketingSubscriber,
} from "@/lib/marketing/subscribers"
import { getPostgresPool } from "@/lib/postgres/server"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

/**
 * Resend allows 10 requests/second. The send loop used to fire as fast as the
 * event loop would let it, so a 91-recipient campaign burned 19 sends on 429s
 * with no retry — those recipients were recorded as permanently failed and
 * never got the email. Pace below the ceiling and retry the ones that still
 * bounce off it.
 */
const SEND_INTERVAL_MS = 220 // ~4.5/sec, comfortably under the 10/sec limit
const MAX_RATE_LIMIT_RETRIES = 4

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isRateLimited(error: { message?: string; name?: string } | null): boolean {
  if (!error) return false
  const text = `${error.name ?? ""} ${error.message ?? ""}`.toLowerCase()
  return text.includes("too many requests") || text.includes("rate limit")
}

/** Send one email, backing off and retrying while Resend reports rate limiting. */
async function sendWithRetry(
  client: Resend,
  payload: Parameters<Resend["emails"]["send"]>[0],
): Promise<Awaited<ReturnType<Resend["emails"]["send"]>>> {
  let response = await client.emails.send(payload)
  for (let attempt = 1; attempt <= MAX_RATE_LIMIT_RETRIES && isRateLimited(response.error); attempt++) {
    await sleep(SEND_INTERVAL_MS * 2 ** attempt) // 440ms, 880ms, 1.76s, 3.5s
    response = await client.emails.send(payload)
  }
  return response
}

/**
 * Build an unsubscribe URL that cannot abort the send.
 *
 * The account-scoped token has a FK to the user row; two recipients in the
 * 2026-08-16 campaign had a userId with no matching row, so the INSERT threw and
 * the whole send for them was lost. Fall back to the email-scoped marketing
 * token, which is what recipients without a userId already use.
 */
async function buildSafeUnsubscribeUrl(email: string, userId: string | null): Promise<string> {
  if (userId) {
    try {
      return buildAccountUnsubscribeUrl(await generateUnsubscribeToken(userId, null))
    } catch {
      // orphaned/deleted user — fall through to the marketing-subscriber token
    }
  }
  const subscriber = await upsertMarketingSubscriber({ email, source: "campaign" })
  return buildMarketingUnsubscribeUrl(subscriber.unsubscribeToken)
}

const createCampaignSchema = z.object({
  name: z.string().min(1).max(160),
  subject: z.string().min(1).max(220),
  bodyText: z.string().min(1).max(50000),
  bodyHtml: z.string().max(200000).optional(),
  segment: z
    .enum(["all_users", "selected_users", "marketing_subscribers", "waitlist_confirmed"])
    .default("all_users"),
  // Only used (and required) when segment === "selected_users" — picked from the admin Users page.
  userIds: z.array(z.string().uuid()).max(5000).optional(),
  sendNow: z.boolean().default(true),
})

function toHtml(bodyText: string) {
  return bodyText
    .split("\n")
    .map((line) => `<p style="margin:0 0 12px;">${escapeHtml(line) || "&nbsp;"}</p>`)
    .join("")
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

type Segment = "all_users" | "selected_users" | "marketing_subscribers" | "waitlist_confirmed"

interface Recipient {
  email: string
  // Present only for the all_users segment — lets us mint a real per-account
  // unsubscribe token instead of enrolling the account in marketing_subscribers.
  userId?: string
}

function buildAccountUnsubscribeUrl(token: string) {
  const url = new URL("/api/email/unsubscribe", getPublicSiteUrl())
  url.searchParams.set("token", token)
  return url.toString()
}

async function getSegmentRecipients(
  segment: Segment,
  userIds?: string[]
): Promise<Recipient[]> {
  const pool = getPostgresPool()

  if (segment === "all_users" || segment === "selected_users") {
    // profiles-backed sends. all_users = every account, minus suspended accounts;
    // selected_users = only the hand-picked ids from the admin Users page (an
    // explicit choice, so suspension doesn't exclude them). Both always honor the
    // global suppression list (hard bounces / complaints / manual unsubscribe-all).
    const result =
      segment === "selected_users"
        ? await pool.query<{ id: string; email: string }>(
            `SELECT p.id::text, p.email
             FROM profiles p
             LEFT JOIN email_suppressions es ON lower(es.email) = lower(p.email)
             WHERE p.email IS NOT NULL
               AND es.email IS NULL
               AND p.id = ANY($1::uuid[])`,
            [userIds ?? []]
          )
        : await pool.query<{ id: string; email: string }>(
            `SELECT p.id::text, p.email
             FROM profiles p
             LEFT JOIN email_suppressions es ON lower(es.email) = lower(p.email)
             WHERE p.email IS NOT NULL
               AND p.suspended_at IS NULL
               AND es.email IS NULL`
          )
    const seen = new Set<string>()
    const recipients: Recipient[] = []
    for (const row of result.rows) {
      const key = row.email.toLowerCase()
      if (!row.email || seen.has(key)) continue
      seen.add(key)
      recipients.push({ email: row.email, userId: row.id })
    }
    return recipients
  }

  const query =
    segment === "waitlist_confirmed"
      ? `SELECT w.email
         FROM waitlist w
         LEFT JOIN email_suppressions es ON lower(es.email) = lower(w.email)
         WHERE w.confirmed = true
           AND w.email IS NOT NULL
           AND es.email IS NULL`
      : `SELECT ms.email
         FROM marketing_subscribers ms
         LEFT JOIN email_suppressions es ON lower(es.email) = lower(ms.email)
         WHERE ms.subscribed_to_marketing = true
           AND es.email IS NULL`

  const result = await pool.query<{ email: string | null }>(query)
  const emails = Array.from(
    new Set(result.rows.map((x) => x.email).filter(Boolean))
  ) as string[]
  return emails.map((email) => ({ email }))
}

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const pool = getPostgresPool()
  const result = await pool.query(
    `SELECT *
     FROM marketing_campaigns
     ORDER BY created_at DESC
     LIMIT 50`
  )
  return NextResponse.json({ rows: result.rows })
}

export async function POST(request: Request) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = createCampaignSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  if (!resend) {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured" }, { status: 500 })
  }

  const { name, subject, bodyText, bodyHtml, segment, userIds, sendNow } = parsed.data

  if (segment === "selected_users" && (!userIds || userIds.length === 0)) {
    return NextResponse.json(
      { error: "userIds is required when segment is selected_users" },
      { status: 400 }
    )
  }

  const pool = getPostgresPool()
  const recipients = await getSegmentRecipients(segment, userIds)

  const campaignResult = await pool.query<{ id: string } & Record<string, unknown>>(
    `INSERT INTO marketing_campaigns (
      created_by,
      name,
      subject,
      body_text,
      body_html,
      segment,
      status,
      total_recipients
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      access.profile.id,
      name,
      subject,
      bodyText,
      bodyHtml ?? null,
      segment,
      sendNow ? "sending" : "draft",
      recipients.length,
    ]
  )
  const campaign = campaignResult.rows[0]

  if (!campaign) {
    return NextResponse.json(
      { error: "Could not create campaign" },
      { status: 500 }
    )
  }

  if (!sendNow) return NextResponse.json({ campaign, sent: 0, failed: 0 })

  let sent = 0
  let failed = 0

  for (const [index, { email, userId }] of recipients.entries()) {
    // Pace the loop under Resend's 10/sec ceiling. Skipped before the first
    // send so a single-recipient campaign stays instant.
    if (index > 0) await sleep(SEND_INTERVAL_MS)

    try {
      const unsubscribeUrl = await buildSafeUnsubscribeUrl(email, userId ?? null)

      const html = `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#0f172a;">
          ${(bodyHtml ?? toHtml(bodyText))}
          <p style="margin-top:24px;font-size:12px;color:#64748b;">
            You are receiving Hireoven updates.
            <a href="${unsubscribeUrl}" style="color:#0369A1;">Unsubscribe</a>
          </p>
        </div>
      `

      const sendResponse = await sendWithRetry(resend, {
        from: getSupportFromEmail(),
        to: [email],
        subject,
        text: `${bodyText}\n\nUnsubscribe: ${unsubscribeUrl}`,
        html,
      })

      await pool.query(
        `INSERT INTO marketing_campaign_sends (
          campaign_id,
          email,
          status,
          provider_message_id,
          error_message
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          campaign.id,
          email,
          sendResponse.error ? "failed" : "sent",
          (sendResponse as { data?: { id?: string } })?.data?.id ?? null,
          sendResponse.error?.message ?? null,
        ]
      )

      if (sendResponse.error) {
        failed += 1
      } else {
        sent += 1
      }
    } catch (error) {
      failed += 1
      await pool.query(
        `INSERT INTO marketing_campaign_sends (
          campaign_id,
          email,
          status,
          error_message
        ) VALUES ($1, $2, 'failed', $3)`,
        [campaign.id, email, (error as Error).message]
      )
    }
  }

  await pool.query(
    `UPDATE marketing_campaigns
     SET status = $1,
         sent_at = $2,
         total_sent = $3,
         total_failed = $4,
         updated_at = now()
     WHERE id = $5`,
    [failed > 0 ? "failed" : "sent", new Date().toISOString(), sent, failed, campaign.id]
  )

  return NextResponse.json({
    campaignId: campaign.id,
    totalRecipients: recipients.length,
    sent,
    failed,
  })
}

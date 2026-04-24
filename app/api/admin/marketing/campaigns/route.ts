import { NextResponse } from "next/server"
import { Resend } from "resend"
import { z } from "zod"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getSupportFromEmail } from "@/lib/email/identity"
import {
  buildMarketingUnsubscribeUrl,
  upsertMarketingSubscriber,
} from "@/lib/marketing/subscribers"
import { getPostgresPool } from "@/lib/postgres/server"

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

const createCampaignSchema = z.object({
  name: z.string().min(1).max(160),
  subject: z.string().min(1).max(220),
  bodyText: z.string().min(1).max(50000),
  bodyHtml: z.string().max(200000).optional(),
  segment: z.enum(["all", "waitlist_confirmed"]).default("all"),
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

async function getSegmentRecipients(segment: "all" | "waitlist_confirmed") {
  const pool = getPostgresPool()

  if (segment === "waitlist_confirmed") {
    const result = await pool.query<{ email: string | null }>(
      `SELECT email
       FROM waitlist
       WHERE confirmed = true
         AND email IS NOT NULL`
    )
    const data = result.rows
    const emails = Array.from(
      new Set(data.map((x) => x.email).filter(Boolean))
    ) as string[]
    return emails
  }

  const result = await pool.query<{ email: string | null }>(
    `SELECT email
     FROM marketing_subscribers
     WHERE subscribed_to_marketing = true`
  )
  const data = result.rows

  return Array.from(
    new Set(data.map((x) => x.email).filter(Boolean))
  ) as string[]
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

  const { name, subject, bodyText, bodyHtml, segment, sendNow } = parsed.data
  const pool = getPostgresPool()
  const recipients = await getSegmentRecipients(segment)

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

  for (const email of recipients) {
    try {
      const subscriber = await upsertMarketingSubscriber({
        email,
        source: "campaign",
      })

      const unsubscribeUrl = buildMarketingUnsubscribeUrl(subscriber.unsubscribeToken)
      const html = `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#0f172a;">
          ${(bodyHtml ?? toHtml(bodyText))}
          <p style="margin-top:24px;font-size:12px;color:#64748b;">
            You are receiving Hireoven updates.
            <a href="${unsubscribeUrl}" style="color:#0369A1;">Unsubscribe</a>
          </p>
        </div>
      `

      const sendResponse = await resend.emails.send({
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

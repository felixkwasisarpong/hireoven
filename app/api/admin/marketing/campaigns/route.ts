import { NextResponse } from "next/server"
import { Resend } from "resend"
import { z } from "zod"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getSupportFromEmail } from "@/lib/email/identity"
import {
  buildMarketingUnsubscribeUrl,
  upsertMarketingSubscriber,
} from "@/lib/marketing/subscribers"
import { createAdminClient } from "@/lib/supabase/admin"

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
  const supabase = createAdminClient()

  if (segment === "waitlist_confirmed") {
    const { data } = await ((supabase.from("waitlist") as any)
      .select("email")
      .eq("confirmed", true)
      .not("email", "is", null))
    const emails = Array.from(
      new Set(((data ?? []) as Array<{ email: string | null }>).map((x) => x.email).filter(Boolean))
    ) as string[]
    return emails
  }

  const { data } = await ((supabase.from("marketing_subscribers") as any)
    .select("email")
    .eq("subscribed_to_marketing", true))

  return Array.from(
    new Set(((data ?? []) as Array<{ email: string | null }>).map((x) => x.email).filter(Boolean))
  ) as string[]
}

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = createAdminClient()
  const { data, error } = await ((supabase.from("marketing_campaigns") as any)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50))

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rows: data ?? [] })
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
  const supabase = createAdminClient()
  const recipients = await getSegmentRecipients(segment)

  const { data: campaign, error: campaignError } = await ((supabase
    .from("marketing_campaigns") as any)
    .insert({
      created_by: access.profile.id,
      name,
      subject,
      body_text: bodyText,
      body_html: bodyHtml ?? null,
      segment,
      status: sendNow ? "sending" : "draft",
      total_recipients: recipients.length,
    })
    .select("*")
    .single())

  if (campaignError || !campaign) {
    return NextResponse.json(
      { error: campaignError?.message ?? "Could not create campaign" },
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

      await ((supabase.from("marketing_campaign_sends") as any).insert({
        campaign_id: campaign.id,
        email,
        status: sendResponse.error ? "failed" : "sent",
        provider_message_id: (sendResponse as any)?.data?.id ?? null,
        error_message: sendResponse.error?.message ?? null,
      }))

      if (sendResponse.error) {
        failed += 1
      } else {
        sent += 1
      }
    } catch (error) {
      failed += 1
      await ((supabase.from("marketing_campaign_sends") as any).insert({
        campaign_id: campaign.id,
        email,
        status: "failed",
        error_message: (error as Error).message,
      }))
    }
  }

  await ((supabase.from("marketing_campaigns") as any)
    .update({
      status: failed > 0 ? "failed" : "sent",
      sent_at: new Date().toISOString(),
      total_sent: sent,
      total_failed: failed,
    })
    .eq("id", campaign.id))

  return NextResponse.json({
    campaignId: campaign.id,
    totalRecipients: recipients.length,
    sent,
    failed,
  })
}

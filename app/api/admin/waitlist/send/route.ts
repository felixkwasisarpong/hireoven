import { NextResponse } from "next/server"
import { Resend } from "resend"
import { z } from "zod"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getSupportFromEmail } from "@/lib/email/identity"
import { getPostgresPool } from "@/lib/postgres/server"
import { isMissingWaitlistTableError } from "@/lib/waitlist/errors"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

const bodySchema = z.object({
  subject: z.string().min(1).max(200),
  bodyText: z.string().min(1).max(50_000),
  previewOnly: z.boolean().optional(),
})

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const from = getSupportFromEmail()

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

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  if (!resend) {
    return NextResponse.json(
      { error: "RESEND_API_KEY is not configured" },
      { status: 500 }
    )
  }

  const pool = getPostgresPool()
  let rows: Array<{ email: string; metadata: Record<string, unknown> | null; confirmed: boolean }> = []
  try {
    const result = await pool.query<{ email: string; metadata: Record<string, unknown> | null; confirmed: boolean }>(
      `SELECT email, metadata, confirmed
       FROM waitlist
       WHERE confirmed = true`
    )
    rows = result.rows
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database query failed"
    if (isMissingWaitlistTableError(message)) {
      return NextResponse.json(
        {
          error:
            "Waitlist table is not available in this database yet. Run latest schema migration for public.waitlist.",
        },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }

  const recipients =
    rows.filter((r) => {
      const m = r.metadata as Record<string, unknown> | null
      return !m?.marketing_unsubscribed
    })

  if (parsed.data.previewOnly) {
    return NextResponse.json({
      preview: true,
      recipientCount: recipients.length,
      sampleEmails: recipients.slice(0, 5).map((r) => r.email),
    })
  }

  const site = getPublicSiteUrl()
  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
${parsed.data.bodyText
  .split("\n")
  .map(
    (line) =>
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155">${escapeHtml(line) || "&nbsp;"}</p>`
  )
  .join("")}
<p style="margin-top:24px;font-size:12px;color:#94a3b8">You signed up for updates from Hireoven · <a href="${site}/launch" style="color:#64748b">hireoven.com/launch</a></p>
</div>`

  const BATCH = 100
  let sent = 0
  const errors: string[] = []

  for (let i = 0; i < recipients.length; i += BATCH) {
    const chunk = recipients.slice(i, i + BATCH)
    const results = await Promise.all(
      chunk.map((r) =>
        resend.emails.send({
          from,
          to: r.email,
          subject: parsed.data.subject,
          html,
          text: parsed.data.bodyText,
        })
      )
    )
    for (const r of results) {
      if (r.error) errors.push(r.error.message)
      else sent += 1
    }
  }

  return NextResponse.json({
    sent,
    attempted: recipients.length,
    errors: errors.slice(0, 10),
  })
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { Resend } from "resend"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"
import { getWaitlistFromEmail } from "@/lib/email/identity"

export const runtime = "nodejs"

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const from = getWaitlistFromEmail()

export async function POST(request: Request) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const body = await request.json().catch(() => ({})) as { id?: string }
  const id = body.id?.trim()
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }

  const pool = getPostgresPool()

  // Fetch the waitlist entry
  const row = await pool.query<{ id: string; email: string; approved: boolean; invite_used_at: string | null }>(
    `SELECT id, email, approved, invite_used_at FROM waitlist WHERE id = $1 LIMIT 1`,
    [id]
  ).then((r) => r.rows[0])

  if (!row) {
    return NextResponse.json({ error: "Waitlist entry not found" }, { status: 404 })
  }

  if (row.invite_used_at) {
    return NextResponse.json({ error: "This invite has already been used — the user has an account." }, { status: 409 })
  }

  // Generate a fresh invite token
  const token = randomUUID()
  const site = getPublicSiteUrl()
  const inviteUrl = `${site}/signup?invite=${encodeURIComponent(token)}`

  await pool.query(
    `UPDATE waitlist
     SET approved = true, invite_token = $1, invited_at = now()
     WHERE id = $2`,
    [token, id]
  )

  // Send invite email
  if (resend) {
    await resend.emails.send({
      from,
      to: row.email,
      subject: "You're in — create your Hireoven account",
      html: `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 16px">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden">
  <tr><td style="background:linear-gradient(135deg,#FF5C18,#FF9A3C);padding:32px 32px 24px;text-align:center">
    <p style="margin:0;font-size:26px;font-weight:900;color:#ffffff;letter-spacing:-0.5px">Hireoven</p>
    <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.8)">Jobs served fresh.</p>
  </td></tr>
  <tr><td style="padding:32px">
    <p style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a">You're in. 🎉</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569">
      Your spot on the Hireoven waitlist has been approved. Click the button below to create your account — this link is unique to you.
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${inviteUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#FF5C18,#FF7A35);color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:12px;box-shadow:0 4px 16px rgba(255,92,24,0.35)">
        Create my account →
      </a>
    </div>
    <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center">
      This link is single-use and expires after account creation.<br>
      If you didn't sign up for Hireoven, you can ignore this email.
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`,
    }).catch((e) => console.error("[waitlist/approve] email send failed", e))
  }

  return NextResponse.json({ ok: true, email: row.email, inviteUrl })
}

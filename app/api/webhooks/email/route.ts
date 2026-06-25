import { NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"
import { getPostgresPool } from "@/lib/postgres/server"
import { suppress } from "@/lib/email/preferences"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Resend webhook (Svix-signed). Updates email_sends status and writes bounces /
// complaints to the global suppression list. Resend signs with Svix: the signature
// is base64(HMAC-SHA256(`${id}.${timestamp}.${body}`, secretBytes)) where secretBytes
// is the base64 part after the `whsec_` prefix.

function verifySvix(secret: string, id: string, ts: string, body: string, header: string): boolean {
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
    const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")
    // header is space-separated "v1,<sig> v1,<sig2>"
    return header.split(" ").some((part) => {
      const sig = part.split(",")[1] ?? ""
      if (sig.length !== expected.length) return false
      return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    })
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const secret = process.env.RESEND_WEBHOOK_SECRET

  if (secret) {
    const id = request.headers.get("svix-id") ?? ""
    const ts = request.headers.get("svix-timestamp") ?? ""
    const sig = request.headers.get("svix-signature") ?? ""
    if (!id || !ts || !sig || !verifySvix(secret, id, ts, raw, sig)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 })
    }
  } else if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 })
  }

  let event: { type?: string; data?: { email_id?: string; to?: string | string[] } }
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 })
  }

  const pool = getPostgresPool()
  const emailId = event.data?.email_id ?? null
  const to = Array.isArray(event.data?.to) ? event.data?.to[0] : event.data?.to

  switch (event.type) {
    case "email.bounced":
      if (emailId) await pool.query(`UPDATE email_sends SET status = 'bounced' WHERE provider_id = $1`, [emailId])
      if (to) await suppress(to, "bounce")
      break
    case "email.complained":
      if (emailId) await pool.query(`UPDATE email_sends SET status = 'bounced' WHERE provider_id = $1`, [emailId])
      if (to) await suppress(to, "complaint")
      break
    case "email.clicked":
      if (emailId) await pool.query(`UPDATE email_sends SET clicked_at = COALESCE(clicked_at, NOW()) WHERE provider_id = $1`, [emailId])
      break
    case "email.delivered":
      if (emailId) await pool.query(`UPDATE email_sends SET status = 'sent', sent_at = COALESCE(sent_at, NOW()) WHERE provider_id = $1 AND status NOT IN ('bounced','unsubscribed')`, [emailId])
      break
    default:
      break
  }

  return NextResponse.json({ ok: true })
}

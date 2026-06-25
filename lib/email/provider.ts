import { Resend } from "resend"
import { getPostgresPool } from "@/lib/postgres/server"
import { getAlertsFromEmail } from "@/lib/email/identity"
import { isEmailSuppressed, wantsEmailType } from "./preferences"

// Spec 08 — ESP abstraction + managed send. The ESP is wrapped behind one
// interface so a swap is a single file. sendManaged() enforces the invariants:
// idempotency (unique dedupe_key), suppression checked at SEND time (not queue
// time), preference re-check, RFC 8058 one-click unsubscribe headers, and bounded
// retry on transient failure.

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
  tags?: Record<string, string>
}

export interface EmailProvider {
  send(input: EmailMessage): Promise<{ provider_id: string }>
}

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

export const resendProvider: EmailProvider = {
  async send(input) {
    if (!resend) throw new Error("RESEND_API_KEY not configured")
    const { data, error } = await resend.emails.send({
      from: getAlertsFromEmail(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: input.headers,
      tags: input.tags ? Object.entries(input.tags).map(([name, value]) => ({ name, value })) : undefined,
    })
    if (error) throw new Error(error.message)
    return { provider_id: data?.id ?? "" }
  },
}

const MAX_ATTEMPTS = 3
const TERMINAL = new Set(["sent", "unsubscribed", "skipped"])

export type SendResult =
  | "sent"
  | "duplicate"
  | "suppressed"
  | "skipped"
  | "failed"
  | "failed_permanent"

export interface ManagedSend {
  userId: string | null
  emailType: string
  dedupeKey: string
  toEmail: string
  subject: string
  html: string
  text: string
  // One-click unsubscribe target (RFC 8058). Renders as List-Unsubscribe.
  unsubscribeUrl?: string
  provider?: EmailProvider
}

export async function sendManaged(input: ManagedSend): Promise<SendResult> {
  const pool = getPostgresPool()
  const provider = input.provider ?? resendProvider

  // Claim/dedupe against the send log. A terminal row means "already handled".
  const existing = await pool.query<{ id: string; status: string; attempts: number }>(
    `SELECT id, status, attempts FROM email_sends WHERE dedupe_key = $1 LIMIT 1`,
    [input.dedupeKey]
  )
  let id: string
  if (existing.rows[0]) {
    const row = existing.rows[0]
    if (TERMINAL.has(row.status)) return "duplicate"
    if (row.status === "failed" && row.attempts >= MAX_ATTEMPTS) return "failed_permanent"
    id = row.id // retry an earlier transient failure / stuck queued row
  } else {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO email_sends (user_id, email_type, dedupe_key, to_email, subject, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [input.userId, input.emailType, input.dedupeKey, input.toEmail, input.subject]
    )
    if (!ins.rows[0]) return "duplicate" // raced with a concurrent send
    id = ins.rows[0].id
  }

  // Suppression is checked HERE, at send time — a user who unsubscribed after the
  // row was queued must not receive it.
  if (await isEmailSuppressed(input.toEmail)) {
    await pool.query(`UPDATE email_sends SET status = 'unsubscribed' WHERE id = $1`, [id])
    return "suppressed"
  }
  if (input.userId && !(await wantsEmailType(input.userId, input.emailType))) {
    await pool.query(`UPDATE email_sends SET status = 'skipped' WHERE id = $1`, [id])
    return "skipped"
  }

  const headers: Record<string, string> = {}
  if (input.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${input.unsubscribeUrl}>`
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
  }

  try {
    const { provider_id } = await provider.send({
      to: input.toEmail,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers,
      tags: { email_type: input.emailType },
    })
    await pool.query(
      `UPDATE email_sends SET status = 'sent', provider_id = $2, sent_at = NOW(), attempts = attempts + 1 WHERE id = $1`,
      [id, provider_id]
    )
    return "sent"
  } catch (e) {
    await pool.query(
      `UPDATE email_sends SET status = 'failed', error_message = $2, attempts = attempts + 1 WHERE id = $1`,
      [id, e instanceof Error ? e.message : String(e)]
    )
    return "failed"
  }
}

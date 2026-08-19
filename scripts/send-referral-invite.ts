/**
 * Referral nudge campaign.
 *
 * Every recipient's numbers are read from their own row, not templated in — the
 * email states how many rewards they have banked and how many are left, and
 * getting that wrong is worse than not sending. Anyone already at the
 * 3-reward cap is skipped: telling them to invite more promises a payout the
 * code will refuse to grant.
 *
 * Preview writes the rendered HTML to disk so the copy can be read before any
 * send. Dry run is the default; --execute is required to actually send.
 *
 * Usage:
 *   npx tsx scripts/send-referral-invite.ts --preview             # write HTML, send nothing
 *   npx tsx scripts/send-referral-invite.ts                       # dry run, list recipients
 *   npx tsx scripts/send-referral-invite.ts --only=me@example.com # target one address
 *   npx tsx scripts/send-referral-invite.ts --limit=50 --execute  # send
 */

import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

import { writeFileSync } from "fs"
import { Resend } from "resend"
import { getPostgresPool } from "@/lib/postgres/server"
import { getOrCreateReferralCode } from "@/lib/referral/codes"
import { renderReferralInvite } from "@/lib/email/templates/referral-invite"
import { generateUnsubscribeToken } from "@/lib/email/unsubscribe"
import { getAlertsFromEmail } from "@/lib/email/identity"
import { resolveAppOrigin } from "@/lib/app-url"

const MAX_REFERRAL_REWARDS = 3

function flag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find((v) => v.startsWith(prefix))
  return arg ? arg.slice(prefix.length).trim() : null
}

const execute = process.argv.includes("--execute")
const preview = process.argv.includes("--preview")
const only = flag("only")
const limit = Number(flag("limit") ?? "100")

type Recipient = {
  id: string
  email: string
  full_name: string | null
  earned_rewards: number
  pending_count: number
}

async function loadRecipients(): Promise<Recipient[]> {
  const pool = getPostgresPool()
  const params: unknown[] = [limit]
  const onlyClause = only ? "AND lower(p.email) = lower($2)" : ""
  if (only) params.push(only)

  // email_alerts is the consent flag; suspended accounts never get campaign mail.
  const { rows } = await pool.query<Recipient>(
    `SELECT p.id, p.email, p.full_name,
            (SELECT count(*)::int FROM referrals r
              WHERE r.referrer_id = p.id AND r.referrer_reward_granted_at IS NOT NULL) AS earned_rewards,
            (SELECT count(*)::int FROM referrals r
              WHERE r.referrer_id = p.id AND r.referrer_reward_granted_at IS NULL) AS pending_count
       FROM profiles p
      WHERE p.email IS NOT NULL
        AND p.suspended_at IS NULL
        AND COALESCE(p.email_alerts, true) = true
        ${onlyClause}
      ORDER BY p.last_active_at DESC NULLS LAST
      LIMIT $1`,
    params,
  )

  // Cap check in SQL would need the same subquery twice; filter here instead.
  return rows.filter((r) => r.earned_rewards < MAX_REFERRAL_REWARDS)
}

async function main() {
  const pool = getPostgresPool()
  const origin = resolveAppOrigin()
  const recipients = await loadRecipients()

  console.log(
    `[referral-invite] mode=${execute ? "EXECUTE" : preview ? "PREVIEW" : "dry-run"} recipients=${recipients.length}`,
  )

  if (preview) {
    const sample = recipients[0]
    const rendered = renderReferralInvite({
      firstName: sample?.full_name?.split(/\s+/)[0] ?? "Alex",
      referralUrl: `${origin}/ref/EXAMPLE1`,
      earnedRewards: sample?.earned_rewards ?? 0,
      pendingCount: sample?.pending_count ?? 0,
      referralsUrl: `${origin}/dashboard/referrals`,
      unsubscribeUrl: `${origin}/unsubscribe?token=preview`,
    })
    const out = "/tmp/referral-invite-preview.html"
    writeFileSync(out, rendered.html)
    console.log(`  subject: ${rendered.subject}`)
    console.log(`  html   : ${out}`)
    console.log(`\n--- plain text ---\n${rendered.text}`)
    await pool.end()
    return
  }

  const apiKey = process.env.RESEND_API_KEY
  if (execute && !apiKey) throw new Error("RESEND_API_KEY is not set")
  const resend = apiKey ? new Resend(apiKey) : null

  let sent = 0
  for (const r of recipients) {
    const code = await getOrCreateReferralCode(pool, r.id)
    const token = await generateUnsubscribeToken(r.id)
    const rendered = renderReferralInvite({
      firstName: r.full_name?.split(/\s+/)[0] ?? null,
      referralUrl: `${origin}/ref/${code}`,
      earnedRewards: r.earned_rewards,
      pendingCount: r.pending_count,
      referralsUrl: `${origin}/dashboard/referrals`,
      unsubscribeUrl: `${origin}/unsubscribe?token=${token}`,
    })

    console.log(
      `  ${execute ? "send" : "would send"} -> ${r.email}  [earned=${r.earned_rewards} pending=${r.pending_count}]  "${rendered.subject}"`,
    )

    if (!execute || !resend) continue
    const result = await resend.emails.send({
      from: getAlertsFromEmail(),
      to: r.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
    if (result.error) {
      console.warn(`    ! ${r.email}: ${result.error.message}`)
      continue
    }
    sent += 1
  }

  console.log(execute ? `\nsent ${sent}/${recipients.length}` : "\n(Pass --execute to send.)")
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

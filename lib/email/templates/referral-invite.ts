import { renderLayout, textFooter, esc, ctaButton } from "./layout"
import type { RenderedEmail } from "./layoff-alert"

/**
 * Referral nudge.
 *
 * The numbers here are the ones the code actually pays out (lib/referral/rewards.ts):
 * the friend gets 7 days of Pro at signup, the referrer gets 14 once that friend
 * is a week old, capped at 3 rewards. Nothing in this email promises more than
 * the cron will grant.
 *
 * It is written to be sent to someone who has NOT hit the cap — the sender filters
 * those out, because telling a maxed-out referrer to invite more is a broken promise.
 */

const REFEREE_REWARD_DAYS = 7
const REFERRER_REWARD_DAYS = 14
const MAX_REFERRAL_REWARDS = 3

export interface ReferralInviteData {
  /** First name if we have one — the greeting drops cleanly when we don't. */
  firstName?: string | null
  /** Their personal link, e.g. https://hireoven.com/ref/6TSCSDAE */
  referralUrl: string
  /** Rewards already granted (0..3). */
  earnedRewards: number
  /** Invited, signed up, not yet through the 7-day wait. */
  pendingCount: number
  referralsUrl: string
  unsubscribeUrl: string
}

function subjectFor(d: ReferralInviteData): string {
  if (d.pendingCount > 0) {
    return `${d.pendingCount} referral${d.pendingCount === 1 ? "" : "s"} almost cleared`
  }
  if (d.earnedRewards > 0) {
    const left = MAX_REFERRAL_REWARDS - d.earnedRewards
    return `You have ${left} referral${left === 1 ? "" : "s"} left to claim`
  }
  return `Give a friend 7 days of Pro, get 14`
}

/** The one line that changes based on where they are in the programme. */
function statusLine(d: ReferralInviteData): string | null {
  if (d.pendingCount > 0) {
    const days = d.pendingCount * REFERRER_REWARD_DAYS
    return `${d.pendingCount} ${d.pendingCount === 1 ? "friend has" : "friends have"} signed up through your link and ${d.pendingCount === 1 ? "is" : "are"} still inside the first week. Once ${d.pendingCount === 1 ? "that clears" : "those clear"}, ${days} days land on your account automatically.`
  }
  if (d.earnedRewards > 0) {
    const banked = d.earnedRewards * REFERRER_REWARD_DAYS
    const left = MAX_REFERRAL_REWARDS - d.earnedRewards
    return `You have banked ${banked} days of Pro so far. There ${left === 1 ? "is" : "are"} ${left} more reward${left === 1 ? "" : "s"} available to you.`
  }
  return null
}

export function renderReferralInvite(d: ReferralInviteData): RenderedEmail {
  const greeting = d.firstName?.trim() ? `${esc(d.firstName.trim())}, ` : ""
  const maxDays = REFERRER_REWARD_DAYS * MAX_REFERRAL_REWARDS
  const status = statusLine(d)

  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0f172a;">
      ${greeting}if you know someone job hunting right now, your referral link is worth
      something to both of you.
    </p>

    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#475569;">
      They get <strong style="color:#0f172a;">${REFEREE_REWARD_DAYS} days of Pro free</strong> the moment
      they sign up — no credit card. You get <strong style="color:#0f172a;">${REFERRER_REWARD_DAYS} days</strong>
      once they have been around a week, up to ${MAX_REFERRAL_REWARDS} friends. That is
      ${maxDays} days of Pro without paying for any of it.
    </p>

    ${status ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#475569;">${esc(status)}</p>` : ""}

    <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">
      Your link
    </p>
    <p style="margin:0 0 18px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;line-height:1.5;color:#0f172a;word-break:break-all;">
      <a href="${esc(d.referralUrl)}" style="color:#0f766e;text-decoration:none;">${esc(d.referralUrl)}</a>
    </p>

    ${ctaButton("See your referrals", d.referralsUrl)}

    <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;">
      The ${REFERRER_REWARD_DAYS}-day reward is granted after your friend's first week, so it does not
      pay out for accounts that sign up and vanish. Nothing to claim — it lands on your
      account on its own.
    </p>`

  const text = `${d.firstName?.trim() ? `${d.firstName.trim()}, ` : ""}if you know someone job hunting right now, your referral link is worth something to both of you.

They get ${REFEREE_REWARD_DAYS} days of Pro free the moment they sign up — no credit card. You get ${REFERRER_REWARD_DAYS} days once they have been around a week, up to ${MAX_REFERRAL_REWARDS} friends. That is ${maxDays} days of Pro without paying for any of it.
${status ? `\n${status}\n` : ""}
Your link: ${d.referralUrl}

See your referrals: ${d.referralsUrl}

The ${REFERRER_REWARD_DAYS}-day reward is granted after your friend's first week, so it does not pay out for accounts that sign up and vanish. Nothing to claim — it lands on your account on its own.${textFooter(d.unsubscribeUrl)}`

  return {
    subject: subjectFor(d),
    html: renderLayout({
      preheader:
        d.pendingCount > 0
          ? `${d.pendingCount * REFERRER_REWARD_DAYS} days of Pro are waiting to clear.`
          : `${REFEREE_REWARD_DAYS} days of Pro for them, ${REFERRER_REWARD_DAYS} for you.`,
      bodyHtml,
      unsubscribeUrl: d.unsubscribeUrl,
      unsubscribeLabel: "Unsubscribe from referral emails",
    }),
    text,
  }
}

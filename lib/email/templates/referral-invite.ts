import { esc } from "./layout"
import { getEmailBaseUrl, getHireovenEmailLogoUrl } from "@/lib/email/branding"
import type { RenderedEmail } from "./layoff-alert"

/**
 * Referral nudge — rich HTML, house style (dark gradient hero + white body cards,
 * matching the extension announcement).
 *
 * Table-based with inline styles throughout: Gmail strips <style> blocks and
 * Outlook's Word renderer ignores flex/grid, so the reward split is a two-cell
 * table rather than a flex row, and the buttons are padded anchors rather than
 * anything relying on modern CSS.
 *
 * The numbers are the ones the code actually pays out (lib/referral/rewards.ts):
 * 7 days for the friend at signup, 14 for the referrer once that friend is a week
 * old, capped at 3 rewards. Nothing here promises more than the cron will grant.
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
  /** Shown in the footer for CAN-SPAM "why am I getting this". */
  recipientEmail: string
}

const PHYSICAL_ADDRESS = process.env.MAIL_PHYSICAL_ADDRESS ?? "Hireoven, 3130 4th St, Lubbock, TX 79415"

/**
 * First name, title-cased. Profile rows carry whatever the user typed at signup
 * ("felix", "FELIX"), and a greeting that echoes it back verbatim reads as a
 * broken mailmerge.
 */
function displayFirstName(value: string | null | undefined): string | null {
  const first = value?.trim().split(/\s+/)[0]
  if (!first) return null
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
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

/** The one line that changes with where they are in the programme. */
function statusLine(d: ReferralInviteData): string | null {
  if (d.pendingCount > 0) {
    const days = d.pendingCount * REFERRER_REWARD_DAYS
    return `${d.pendingCount} ${d.pendingCount === 1 ? "friend has" : "friends have"} signed up through your link and ${d.pendingCount === 1 ? "is" : "are"} still inside the first week. Once ${d.pendingCount === 1 ? "that clears" : "those clear"}, ${days} days land on your account automatically.`
  }
  if (d.earnedRewards > 0) {
    const banked = d.earnedRewards * REFERRER_REWARD_DAYS
    const left = MAX_REFERRAL_REWARDS - d.earnedRewards
    return `You have banked ${banked} days of Pro so far, and ${left === 1 ? "one more reward is" : `${left} more rewards are`} still available to you.`
  }
  return null
}

/** Two-cell table — the reward split, not a flex row (Outlook ignores flex). */
function rewardSplit(): string {
  const cell = (label: string, value: string, sub: string, accent: string) => `
    <td width="50%" valign="top" style="padding:0 5px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
        <tr><td style="padding:18px 18px 16px;">
          <div style="font-size:10.5px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:${accent};">${label}</div>
          <div style="font-size:30px;font-weight:900;color:#0f172a;line-height:1.1;margin-top:8px;letter-spacing:-0.02em;">${value}</div>
          <div style="font-size:12.5px;color:#64748b;line-height:1.55;margin-top:6px;">${sub}</div>
        </td></tr>
      </table>
    </td>`

  return `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        ${cell("They get", `${REFEREE_REWARD_DAYS} days`, "Pro, free at signup.<br>No credit card.", "#0f766e")}
        ${cell("You get", `${REFERRER_REWARD_DAYS} days`, `Pro, once they stay<br>a week.`, "#FF5C18")}
      </tr>
    </table>`
}

function step(n: number, title: string, body: string): string {
  return `
    <tr><td style="padding:10px 0;border-top:1px solid #f1f5f9;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="30" valign="top" style="padding-top:1px;">
          <div style="width:22px;height:22px;border-radius:11px;background:#0f172a;color:#ffffff;font-size:12px;font-weight:800;text-align:center;line-height:22px;">${n}</div>
        </td>
        <td valign="top">
          <div style="font-size:14px;font-weight:700;color:#0f172a;">${title}</div>
          <div style="font-size:13px;color:#64748b;line-height:1.6;margin-top:2px;">${body}</div>
        </td>
      </tr></table>
    </td></tr>`
}

export function renderReferralInvite(d: ReferralInviteData): RenderedEmail {
  const base = getEmailBaseUrl()
  const year = new Date().getFullYear()
  const greeting = `${esc(displayFirstName(d.firstName) ?? "Hey there")},`
  const maxDays = REFERRER_REWARD_DAYS * MAX_REFERRAL_REWARDS
  const status = statusLine(d)
  const subject = subjectFor(d)
  const preheader =
    d.pendingCount > 0
      ? `${d.pendingCount * REFERRER_REWARD_DAYS} days of Pro are waiting to clear.`
      : `${REFEREE_REWARD_DAYS} days of Pro for them, ${REFERRER_REWARD_DAYS} for you — up to ${maxDays} days total.`

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light"/></head>
<body style="margin:0;padding:0;background:#f3f2ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f3f2ef;">${esc(preheader)}</div>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ef;padding:24px 16px 0;">
    <tr><td align="center">
      <table width="100%" style="max-width:584px;" cellpadding="0" cellspacing="0">

        <!-- Wordmark -->
        <tr><td style="padding:0 0 16px;">
          <img src="${getHireovenEmailLogoUrl("wordmark")}" alt="Hireoven" height="28"
               style="display:block;height:28px;width:auto;border:0;outline:none;text-decoration:none;" />
        </td></tr>

        <!-- Hero -->
        <tr><td style="background:linear-gradient(160deg,#0C0A1E 0%,#16102e 50%,#1a0a2e 100%);border-radius:12px;overflow:hidden;border:1px solid #1f1733;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:30px 28px 6px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;color:#FF9A3C;text-transform:uppercase;">
                Referral rewards
              </div>
              <div style="font-size:28px;font-weight:900;color:#ffffff;line-height:1.15;margin-top:10px;letter-spacing:-0.01em;">
                Give a friend ${REFEREE_REWARD_DAYS} days.<br>
                <span style="color:#FF9A3C;">Get ${REFERRER_REWARD_DAYS} back.</span>
              </div>
              <div style="font-size:15px;color:rgba(255,255,255,0.65);line-height:1.6;margin-top:14px;">
                If you know someone job hunting right now, your link is worth something to both of you — up to <strong style="color:#ffffff;">${maxDays} days of Pro</strong>, without paying for any of it.
              </div>
            </td></tr>
            <tr><td style="padding:18px 28px 28px;">
              <a href="${esc(d.referralsUrl)}"
                 style="display:inline-block;background:linear-gradient(135deg,#FF5C18,#FF7A35);color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:14px;font-size:14px;font-weight:700;box-shadow:0 10px 28px -12px rgba(255,92,24,0.55);">
                Share your link
              </a>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

        <!-- Reward split -->
        <tr><td>${rewardSplit()}</td></tr>

        <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
          <table width="100%" cellpadding="0" cellspacing="0">

            <tr><td style="padding:24px 28px 0;">
              <div style="font-size:15px;color:#0f172a;line-height:1.65;">${greeting}</div>
            </td></tr>
            ${
              status
                ? `<tr><td style="padding:14px 28px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;">
                <tr><td style="padding:14px 16px;">
                  <div style="font-size:10.5px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#c2410c;">Where you stand</div>
                  <div style="font-size:13.5px;color:#7c2d12;line-height:1.6;margin-top:6px;">${esc(status)}</div>
                </td></tr>
              </table>
            </td></tr>`
                : ""
            }

            <!-- The link -->
            <tr><td style="padding:20px 28px 0;">
              <div style="font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;">Your personal link</div>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                <tr><td style="padding:14px 16px;">
                  <a href="${esc(d.referralUrl)}" style="font-size:14px;font-weight:600;color:#0f766e;text-decoration:none;word-break:break-all;">${esc(d.referralUrl)}</a>
                </td></tr>
              </table>
              <div style="font-size:12px;color:#94a3b8;line-height:1.6;margin-top:8px;">
                Paste it anywhere — a text, a group chat, a cohort Slack.
              </div>
            </td></tr>

            <!-- How it works -->
            <tr><td style="padding:22px 28px 0;">
              <div style="font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#0f172a;margin-bottom:6px;">How it works</div>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${step(1, "You share your link", "Anyone job hunting is a good fit — it costs them nothing to try.")}
                ${step(2, `They get ${REFEREE_REWARD_DAYS} days of Pro`, "Applied the moment they sign up. No credit card, no trial trap.")}
                ${step(3, `You get ${REFERRER_REWARD_DAYS} days`, `Granted automatically once they've been around a week. Up to ${MAX_REFERRAL_REWARDS} friends.`)}
              </table>
            </td></tr>

            <tr><td style="padding:22px 28px 26px;">
              <a href="${esc(d.referralsUrl)}"
                 style="display:inline-block;background:linear-gradient(135deg,#FF5C18,#FF7A35);color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:14px;font-size:14px;font-weight:700;">
                See your referrals
              </a>
              <div style="font-size:12px;color:#94a3b8;line-height:1.6;margin-top:14px;">
                The ${REFERRER_REWARD_DAYS} days are granted after your friend&rsquo;s first week, so the programme doesn&rsquo;t pay out for accounts that sign up and vanish. Nothing to claim — it lands on your account on its own.
              </div>
            </td></tr>

          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 4px 32px;">
          <div style="font-size:12px;color:#64748b;line-height:1.7;">
            Sent to <strong>${esc(d.recipientEmail)}</strong> because you have a Hireoven account.<br>
            <a href="${esc(d.unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">Unsubscribe</a>
            &nbsp;&middot;&nbsp;
            <a href="${esc(base)}/dashboard/email-preferences" style="color:#64748b;text-decoration:underline;">Email preferences</a>
            &nbsp;&middot;&nbsp;
            <a href="${esc(base)}" style="color:#64748b;text-decoration:underline;">Open Hireoven</a>
          </div>
          <div style="margin-top:12px;">
            <img src="${getHireovenEmailLogoUrl("wordmark")}" alt="Hireoven" height="20"
                 style="display:block;height:20px;width:auto;border:0;outline:none;text-decoration:none;" />
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:6px;">
            &copy; ${year} &middot; ${esc(PHYSICAL_ADDRESS)}
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`

  const text = `${d.firstName?.trim() ? `${d.firstName.trim().split(/\s+/)[0]},` : "Hey there,"}

Give a friend ${REFEREE_REWARD_DAYS} days of Pro. Get ${REFERRER_REWARD_DAYS} back.

They get ${REFEREE_REWARD_DAYS} days of Pro free the moment they sign up — no credit card. You get ${REFERRER_REWARD_DAYS} days once they've been around a week, up to ${MAX_REFERRAL_REWARDS} friends. That's ${maxDays} days of Pro without paying for any of it.
${status ? `\n${status}\n` : ""}
Your personal link: ${d.referralUrl}

How it works:
  1. You share your link.
  2. They get ${REFEREE_REWARD_DAYS} days of Pro the moment they sign up.
  3. You get ${REFERRER_REWARD_DAYS} days once they've been around a week.

See your referrals: ${d.referralsUrl}

The ${REFERRER_REWARD_DAYS} days are granted after your friend's first week, so the programme doesn't pay out for accounts that sign up and vanish. Nothing to claim — it lands on your account on its own.

—
Sent to ${d.recipientEmail} because you have a Hireoven account.
Unsubscribe: ${d.unsubscribeUrl}
${PHYSICAL_ADDRESS}`

  return { subject, html, text }
}

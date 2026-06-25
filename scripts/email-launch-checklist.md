# Email system (Spec 08) — launch checklist

Everything that must be true **before** the email crons are scheduled or any message
is sent to a real user. Code is shipped; this is the ops gate.

## 1. Required env vars

| Var | Purpose | Status |
|-----|---------|--------|
| `RESEND_API_KEY` | ESP auth | already set |
| `RESEND_FROM_EMAIL` | From address (use the warmed subdomain, e.g. `Hireoven <alerts@mail.hireoven.com>`) | verify |
| `MAIL_PHYSICAL_ADDRESS` | **CAN-SPAM** — real registered or virtual mailbox address, shown in every footer. A placeholder is hard-coded as fallback; **replace it.** | **REQUIRED** |
| `RESEND_WEBHOOK_SECRET` | `whsec_…` from the Resend webhook config; verifies bounce/complaint/click callbacks | **REQUIRED** |
| `NEXT_PUBLIC_APP_URL` | absolute origin for links | already set |

> Without `RESEND_WEBHOOK_SECRET` the webhook returns 503 in production (fail-closed).
> Without a real `MAIL_PHYSICAL_ADDRESS` you are not CAN-SPAM compliant.

## 2. Sending domain + DNS (warm a subdomain, never the apex)

Send from `mail.hireoven.com`. In Resend → Domains, add it, then add the records it
shows. They look like:

- **SPF** (TXT on `mail.hireoven.com`): `v=spf1 include:amazonses.com ~all` (Resend uses SES)
- **DKIM** (3× CNAME `resend._domainkey…` as shown in the Resend dashboard)
- **DMARC** (TXT on `_dmarc.hireoven.com`): `v=DMARC1; p=none; rua=mailto:dmarc@hireoven.com`

Verify:
```bash
dig +short TXT mail.hireoven.com          # SPF present
dig +short TXT _dmarc.hireoven.com        # DMARC present
# DKIM: confirm "Verified" in the Resend dashboard
```
Then send a test to **mail-tester.com** — target ≥9/10.

## 3. Resend webhook

Resend → Webhooks → add `https://hireoven.com/api/webhooks/email`, subscribe to
`email.bounced`, `email.complained`, `email.clicked`, `email.delivered`. Copy the
signing secret into `RESEND_WEBHOOK_SECRET`.

## 4. Render checks (before any real send)

```bash
npx tsx scripts/render-email-previews.ts   # writes /tmp/email-previews/*.html
```
Open each in Gmail (web + mobile), Apple Mail, and Outlook. Read every visible
string. The plain-text body is printed to stdout — confirm it matches.

## 5. Cron schedule (HARVESTER box — runs the work off the web box)

The email jobs run as `npm run …:execute` tsx scripts **on the harvester box** (8GB),
not as web-app HTTP routes — DB reads + Resend sends stay off the 4GB web box. The
harvester needs the same env as the web app (`DATABASE_URL`, `RESEND_API_KEY`,
`RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`, `MAIL_PHYSICAL_ADDRESS`).

```cron
# Leaderboard rank snapshot — daily (feeds week-over-week movers; run for ≥2 weeks first)
30 5 * * *   cd $HIREOVEN_REPO && npm run email:snapshot-ranks:execute  >>/var/log/hireoven/email-snapshot.log 2>&1
# Weekly digest — hourly (timezone-local 8am per user)
0 * * * *    cd $HIREOVEN_REPO && npm run email:weekly:execute          >>/var/log/hireoven/email-weekly.log 2>&1
# Layoff alerts — every 15 min (24h debounce inside)
*/15 * * * * cd $HIREOVEN_REPO && npm run email:layoff-alerts:execute   >>/var/log/hireoven/email-layoffs.log 2>&1
# Scorecard view milestones — daily
15 9 * * *   cd $HIREOVEN_REPO && npm run email:milestones:execute      >>/var/log/hireoven/email-milestones.log 2>&1
# OPT / STEM-OPT expiration reminders — daily
20 9 * * *   cd $HIREOVEN_REPO && npm run email:opt-reminders:execute   >>/var/log/hireoven/email-opt.log 2>&1
# Queue health / reaper — every 30 min
*/30 * * * * cd $HIREOVEN_REPO && npm run email:queue-health:execute    >>/var/log/hireoven/email-health.log 2>&1
```

Only `/api/webhooks/email` stays on the web box (Resend calls it). The **Lottery
Brief** is a deliberate manual one-off (no cron) — send it by hand in late March /
early April.

## 6. Launch sequence (don't blast existing users)

1. Snapshot cron runs for ≥2 weeks first, so movers have data.
2. Wave 1: a "Subscribe to the weekly digest" CTA in the dashboard — opt-in only.
3. Wave 2: auto-enroll new signups after 7 days of activity, with clear notice.
4. Existing users: one opt-in email; treat non-response as no.

Watch in `email_sends`: bounce rate (pause >3%), complaint rate (pause >0.1%),
unsubscribe rate. `email-queue-health` surfaces these.

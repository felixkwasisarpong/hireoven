/**
 * Render every Spec 08 email template with sample data for inspection. Writes HTML
 * to /tmp/email-previews/ and prints each subject + plain-text body so every visible
 * string can be read before any real send. No emails are sent.
 *
 *   npx tsx scripts/render-email-previews.ts
 */
import fs from "node:fs"
import { renderLayoffAlert } from "@/lib/email/templates/layoff-alert"
import { renderScorecardMilestone } from "@/lib/email/templates/scorecard-milestone"
import { renderOptExpiration } from "@/lib/email/templates/opt-expiration"
import { renderLotteryBrief } from "@/lib/email/templates/lottery-brief"
import { renderWeeklyDigest } from "@/lib/email/templates/weekly-digest"

const UNSUB = "https://hireoven.com/unsubscribe?token=sample"
const out = "/tmp/email-previews"
fs.mkdirSync(out, { recursive: true })

const emails = [
  ["layoff-alert", renderLayoffAlert({
    companyName: "Stripe", source: "WARN", eventDate: "Mar 3", employeesAffected: 312,
    location: "CA", nthEvent: 2, signalUrl: "https://hireoven.com/h1b-sponsors/stripe-x",
    rolesUrl: "https://hireoven.com/h1b-sponsors/leaderboard", unsubscribeUrl: UNSUB,
  })],
  ["scorecard-milestone", renderScorecardMilestone({
    views: 100, topDomains: ["github.com", "linkedin.com"], cardUrl: "https://hireoven.com/scorecard/x",
    embedUrl: "https://hireoven.com/dashboard/scorecard", revokeUrl: "https://hireoven.com/dashboard/scorecard", unsubscribeUrl: UNSUB,
  })],
  ["opt-90", renderOptExpiration({ stage: 90, isStem: false, capExemptUrl: "https://hireoven.com/h1b-sponsors/leaderboard?cap_exempt_only=true", everifyUrl: "https://hireoven.com/h1b-sponsors/leaderboard?e_verify_only=true", scorecardUrl: "https://hireoven.com/dashboard/scorecard", unsubscribeUrl: UNSUB })],
  ["lottery-brief", renderLotteryBrief({ rescueUrl: "https://hireoven.com/h1b-sponsors/leaderboard", capExemptUrl: "https://hireoven.com/h1b-sponsors/leaderboard?cap_exempt_only=true", everifyUrl: "https://hireoven.com/h1b-sponsors/leaderboard?e_verify_only=true", unsubscribeUrl: UNSUB })],
  ["weekly-digest", renderWeeklyDigest({
    subject: "Hireoven Weekly — Jun 24: your scorecard is now A-",
    preheader: "Your weekly H-1B sponsorship brief.",
    scorecard: { score: 82, grade: "A-", delta: 4, recomputeUrl: "https://hireoven.com/dashboard/scorecard", stale: false },
    watched: [{ name: "Stripe", rankChange: null, layoffChange: "Recent layoffs" }, { name: "Anthropic", rankChange: null, layoffChange: null }],
    layoffs: [{ name: "Stripe", date: "Jun 21", affected: 312 }],
    editorial: { title: "How we rank H-1B sponsors", url: "https://hireoven.com/h1b-sponsors/leaderboard/methodology", blurb: "Our full methodology." },
    unsubscribeUrl: UNSUB,
  })],
] as const

async function main() {
  for (const [name, email] of emails) {
    fs.writeFileSync(`${out}/${name}.html`, email.html)
    console.log(`\n${"=".repeat(70)}\n${name}\n${"=".repeat(70)}`)
    console.log(`SUBJECT: ${email.subject}`)
    console.log(`--- text body ---\n${email.text}`)
  }
  console.log(`\nHTML written to ${out}/`)
}

main()

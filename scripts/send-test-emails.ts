/**
 * Send one real copy of each Spec 08 template to a single recipient for inbox
 * inspection (Gmail/Apple Mail/Outlook). Sends ONLY to the address passed/owner —
 * never to real users. Subjects are prefixed [TEST].
 *
 *   npx tsx scripts/send-test-emails.ts felixsarpong25@gmail.com
 *
 * Env is loaded before the provider is imported (the Resend client reads
 * RESEND_API_KEY at module load), so all imports are dynamic inside main().
 */
import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

const TO = process.argv[2] || "felixsarpong25@gmail.com"
const U = "https://hireoven.com/unsubscribe?token=sample"
const A = (p: string) => `https://hireoven.com${p}`

async function main() {
  const { resendProvider } = await import("@/lib/email/provider")
  const { renderLayoffAlert } = await import("@/lib/email/templates/layoff-alert")
  const { renderScorecardMilestone } = await import("@/lib/email/templates/scorecard-milestone")
  const { renderOptExpiration } = await import("@/lib/email/templates/opt-expiration")
  const { renderLotteryBrief } = await import("@/lib/email/templates/lottery-brief")
  const { renderWeeklyDigest } = await import("@/lib/email/templates/weekly-digest")

  const emails = [
    renderWeeklyDigest({
      subject: "Hireoven Weekly — Jun 25: your scorecard is now A-",
      preheader: "Your weekly H-1B sponsorship brief.",
      scorecard: { score: 82, grade: "A-", delta: 4, recomputeUrl: A("/dashboard/scorecard"), stale: false },
      watched: [{ name: "Stripe", rankChange: -3, layoffChange: "Recent layoffs" }, { name: "Anthropic", rankChange: 5, layoffChange: null }],
      movers: { risers: [{ name: "Anthropic", delta: 8 }, { name: "Databricks", delta: 5 }], fallers: [{ name: "Meta", delta: -4 }] },
      layoffs: [{ name: "Stripe", date: "Jun 22", affected: 312 }],
      editorial: { title: "How we rank H-1B sponsors", url: A("/h1b-sponsors/leaderboard/methodology"), blurb: "Our full methodology." },
      unsubscribeUrl: U,
    }),
    renderLayoffAlert({ companyName: "Stripe", source: "WARN", eventDate: "Jun 22", employeesAffected: 312, location: "CA", nthEvent: 2, signalUrl: A("/h1b-sponsors/stripe-x"), rolesUrl: A("/h1b-sponsors/leaderboard"), unsubscribeUrl: U }),
    renderScorecardMilestone({ views: 100, topDomains: ["github.com", "linkedin.com"], cardUrl: A("/scorecard/x"), embedUrl: A("/dashboard/scorecard"), revokeUrl: A("/dashboard/scorecard"), unsubscribeUrl: U }),
    renderOptExpiration({ stage: 90, isStem: false, capExemptUrl: A("/h1b-sponsors/leaderboard?cap_exempt_only=true"), everifyUrl: A("/h1b-sponsors/leaderboard?e_verify_only=true"), scorecardUrl: A("/dashboard/scorecard"), unsubscribeUrl: U }),
    renderLotteryBrief({ rescueUrl: A("/h1b-sponsors/leaderboard"), capExemptUrl: A("/h1b-sponsors/leaderboard?cap_exempt_only=true"), everifyUrl: A("/h1b-sponsors/leaderboard?e_verify_only=true"), unsubscribeUrl: U }),
  ]

  for (const e of emails) {
    try {
      const { provider_id } = await resendProvider.send({
        to: TO,
        subject: `[TEST] ${e.subject}`,
        html: e.html,
        text: e.text,
        headers: { "List-Unsubscribe": `<${U}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        tags: { test: "spec08" },
      })
      console.log(`SENT  ${e.subject}  (id=${provider_id})`)
    } catch (err) {
      console.log(`FAIL  ${e.subject}  -> ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })

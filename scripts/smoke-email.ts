/** Validate sendManaged invariants with a MOCK provider — no real emails sent. */
import { loadEnvConfig } from "@next/env"
import { sendManaged, type EmailProvider } from "@/lib/email/provider"
import { suppress, unsuppress } from "@/lib/email/preferences"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const mock: EmailProvider = { async send() { return { provider_id: "mock_" + Math.round(performance.now()) } } }
const base = { emailType: "weekly_digest", subject: "s", html: "<p>h</p>", text: "t", provider: mock, userId: null }

async function main() {
  const pool = getPostgresPool()
  await pool.query(`DELETE FROM email_sends WHERE dedupe_key LIKE 'smoke:%'`)
  await unsuppress("smoke-supp@example.test")

  const r1 = await sendManaged({ ...base, dedupeKey: "smoke:1", toEmail: "smoke-a@example.test" })
  const r2 = await sendManaged({ ...base, dedupeKey: "smoke:1", toEmail: "smoke-a@example.test" })

  await suppress("smoke-supp@example.test", "manual")
  const r3 = await sendManaged({ ...base, dedupeKey: "smoke:2", toEmail: "smoke-supp@example.test" })

  console.log("idempotency: first =", r1, "(expect sent), second =", r2, "(expect duplicate)")
  console.log("suppression at send time:", r3, "(expect suppressed)")

  const dupes = await pool.query(`SELECT dedupe_key, COUNT(*) c FROM email_sends WHERE dedupe_key LIKE 'smoke:%' GROUP BY 1 HAVING COUNT(*) > 1`)
  console.log("duplicate dedupe rows (expect 0):", dupes.rowCount)

  await pool.query(`DELETE FROM email_sends WHERE dedupe_key LIKE 'smoke:%'`)
  await unsuppress("smoke-supp@example.test")
  console.log("cleaned up")
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })

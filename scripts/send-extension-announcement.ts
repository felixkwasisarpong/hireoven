/**
 * One-off sender for the Chrome extension launch announcement.
 *
 * Usage:
 *   npx tsx scripts/send-extension-announcement.ts felixsarpong25@gmail.com
 *   npx tsx scripts/send-extension-announcement.ts a@x.com b@y.com c@z.com
 *
 * Requires RESEND_API_KEY (read from .env.local).
 */
import { loadEnvConfig } from "@next/env"
import { sendExtensionAnnouncement } from "../lib/email/extension-announcement"
import { getPostgresPool } from "../lib/postgres/server"

loadEnvConfig(process.cwd())

async function lookupName(email: string): Promise<string | null> {
  try {
    const pool = getPostgresPool()
    const result = await pool.query<{ full_name: string | null }>(
      `SELECT full_name FROM profiles WHERE email = $1 LIMIT 1`,
      [email]
    )
    return result.rows[0]?.full_name ?? null
  } catch {
    return null
  }
}

async function main() {
  const recipients = process.argv.slice(2).filter(Boolean)
  if (recipients.length === 0) {
    console.error("Usage: npx tsx scripts/send-extension-announcement.ts <email>...")
    process.exit(1)
  }

  for (const to of recipients) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      console.error(`Skipping invalid email: ${to}`)
      continue
    }
    const name = await lookupName(to)
    try {
      const result = await sendExtensionAnnouncement({ to, recipientName: name })
      console.log(`✓ sent to ${to}${name ? ` (${name})` : ""} — id=${result.id}`)
    } catch (err) {
      console.error(`✗ failed for ${to}: ${err instanceof Error ? err.message : err}`)
    }
  }

  try {
    await getPostgresPool().end()
  } catch {
    // ignore — pool may not have been initialized
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

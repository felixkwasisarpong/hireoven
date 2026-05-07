/**
 * Refresh stored logo.dev URLs to the current publishable token.
 *
 * Why:
 * - Older rows can keep stale/invalid token query params (for example `sk_...`).
 * - When the token rotates, existing DB rows keep the old token until repaired.
 *
 * Usage:
 *   npx tsx scripts/refresh-logo-dev-urls.ts
 *   npx tsx scripts/refresh-logo-dev-urls.ts --execute
 *   npx tsx scripts/refresh-logo-dev-urls.ts --execute --limit=500
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { normalizeCompanyDomain } from "@/lib/companies/logo-url"
import { isAtsDomain } from "@/lib/companies/ats-domains"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

function getLogoDevPublishableToken(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN,
    process.env.LOGO_DEV_TOKEN,
  ]
  for (const raw of candidates) {
    const token = (raw ?? "").trim()
    if (token.startsWith("pk_")) return token
  }
  return ""
}

type CompanyRow = {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
}

const execute = process.argv.includes("--execute")
const limit = Math.max(0, Number(flag("limit")) || 0) || undefined

function extractLogoDevDomain(logoUrl: string): string | null {
  try {
    const u = new URL(logoUrl)
    if (u.hostname !== "img.logo.dev") return null
    const pathDomain = u.pathname.replace(/^\/+/, "").split("/")[0] ?? ""
    const normalized = normalizeCompanyDomain(pathDomain)
    if (!normalized || isAtsDomain(normalized)) return null
    return normalized
  } catch {
    return null
  }
}

function canonicalLogoDevUrl(domain: string, token: string): string {
  return `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(token)}`
}

async function main() {
  const token = getLogoDevPublishableToken()
  if (!token) {
    throw new Error(
      "Missing publishable logo.dev token. Set NEXT_PUBLIC_LOGO_DEV_TOKEN (pk_...) or LOGO_DEV_TOKEN (pk_...)."
    )
  }

  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL (or TARGET_POSTGRES_URL)")

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  try {
    const limitSql = limit ? `LIMIT ${limit}` : ""
    const { rows } = await pool.query<CompanyRow>(
      `SELECT id, name, domain, logo_url
       FROM companies
       WHERE logo_url ILIKE 'https://img.logo.dev/%'
       ORDER BY updated_at DESC NULLS LAST
       ${limitSql}`
    )

    let scanned = 0
    let unchanged = 0
    let invalid = 0
    let stale = 0
    let updated = 0

    for (const row of rows) {
      scanned += 1
      const current = row.logo_url?.trim() ?? ""
      if (!current) {
        unchanged += 1
        continue
      }

      const domain = extractLogoDevDomain(current)
      if (!domain) {
        invalid += 1
        continue
      }

      const next = canonicalLogoDevUrl(domain, token)
      if (current === next) {
        unchanged += 1
        continue
      }

      stale += 1
      console.log(
        `${execute ? "" : "[dry] "}${row.name} (${row.domain ?? domain})\n  ${current}\n  → ${next}`
      )
      if (execute) {
        await pool.query(
          `UPDATE companies
           SET logo_url = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [next, row.id]
        )
        updated += 1
      }
    }

    console.log(
      `\nmode=${execute ? "EXECUTE" : "dry-run"} scanned=${scanned} stale=${stale} updated=${updated} unchanged=${unchanged} invalid=${invalid}`
    )
    if (!execute) console.log("Re-run with --execute to apply changes.")
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[refresh-logo-dev-urls] failed:", error)
  process.exit(1)
})


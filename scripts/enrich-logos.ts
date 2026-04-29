/**
 * Upgrade company logo_url to logo.dev brand marks (primary provider).
 *
 * Targets rows that are using Clearbit or Google Favicon CDN and replaces
 * them with logo.dev URLs derived from the company's real domain.
 * Curated local SVG marks (/company-logos/…) are always skipped.
 * ATS-domain logos are skipped (those need a domain fix first).
 *
 * Requires: DATABASE_URL, LOGO_DEV_TOKEN
 *
 * Usage:
 *   npx tsx scripts/enrich-logos.ts            # dry run
 *   npx tsx scripts/enrich-logos.ts --execute  # write to DB
 *   npx tsx scripts/enrich-logos.ts --execute --force  # overwrite even non-Clearbit/Google URLs
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"
import { companyLogoUrlFromDomain, normalizeCompanyDomain } from "../lib/companies/logo-url"
import { isAtsDomain } from "../lib/companies/ats-domains"

const execute = process.argv.includes("--execute")
const force = process.argv.includes("--force")

function isGoogleFaviconUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.includes("google.com") || host.endsWith(".gstatic.com")
  } catch {
    return false
  }
}

function isClearbitUrl(url: string) {
  try {
    return new URL(url).hostname === "logo.clearbit.com"
  } catch {
    return false
  }
}

function isLogoDevUrl(url: string) {
  try {
    return new URL(url).hostname === "img.logo.dev"
  } catch {
    return false
  }
}

function isLocalAsset(url: string) {
  return url.trim().startsWith("/")
}

function isAtsDomainLogoUrl(url: string) {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    // Clearbit with an ATS domain in its path
    if (host === "logo.clearbit.com") {
      const pathDomain = u.pathname.replace(/^\/+/, "").split("/")[0] ?? ""
      return isAtsDomain(pathDomain)
    }
    // Google favicon with ATS domain param
    if (host.includes("google.com")) {
      const d = u.searchParams.get("domain") ?? ""
      return isAtsDomain(d)
    }
    return false
  } catch {
    return false
  }
}

async function main() {
  const token = process.env.LOGO_DEV_TOKEN ?? process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ?? ""
  if (!token) {
    console.error("LOGO_DEV_TOKEN is not set — logo.dev URLs cannot be generated. Set it in .env.local.")
    process.exit(1)
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const { rows } = await pool.query<{
    id: string
    name: string
    domain: string
    logo_url: string | null
  }>("SELECT id, name, domain, logo_url FROM companies ORDER BY name")

  let updated = 0
  let skipped = 0

  for (const row of rows) {
    const domain = normalizeCompanyDomain(row.domain ?? "")
    if (!domain) { skipped++; continue }

    // Skip ATS domains — domain itself is wrong, can't generate a valid logo
    if (isAtsDomain(domain)) { skipped++; continue }

    const current = row.logo_url?.trim() ?? ""

    // Never overwrite curated local SVG marks
    if (current && isLocalAsset(current) && !force) { skipped++; continue }

    // Skip ATS-domain logo URLs (clearbit/google pointed at an ATS)
    if (current && isAtsDomainLogoUrl(current) && !force) { skipped++; continue }

    // Skip already-correct logo.dev URLs
    if (current && isLogoDevUrl(current) && !force) { skipped++; continue }

    // Only upgrade Clearbit or Google Favicon URLs (unless --force)
    const isClearbit = current ? isClearbitUrl(current) : false
    const isGoogle = current ? isGoogleFaviconUrl(current) : false
    if (current && !isClearbit && !isGoogle && !force) { skipped++; continue }

    const next = companyLogoUrlFromDomain(domain, "logo-dev")
    if (!next || current === next) { skipped++; continue }

    const fromLabel = isClearbit ? "clearbit" : isGoogle ? "google-favicon" : current ? "other" : "null"
    console.log(`${execute ? "" : "[dry] "}${row.name} (${domain}) [${fromLabel}]\n  ${current || "(null)"}\n  → ${next}`)

    if (execute) {
      await pool.query(
        "UPDATE companies SET logo_url = $1, updated_at = NOW() WHERE id = $2",
        [next, row.id]
      )
    }
    updated++
  }

  console.log(`\n${execute ? "Updated" : "Would update"}: ${updated} | Skipped: ${skipped} | Total: ${rows.length}`)
  if (!execute) console.log("Re-run with --execute to apply.")
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })

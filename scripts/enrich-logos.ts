/**
 * Upgrade company logo_url from Google Favicon CDN to Clearbit brand marks.
 *
 * Clearbit returns actual company logos (not browser favicons), with graceful
 * 404 fallback handled by CompanyLogo.tsx. Curated local SVG logos are skipped.
 *
 * Usage:
 *   npx tsx scripts/enrich-logos.ts            # dry run
 *   npx tsx scripts/enrich-logos.ts --execute  # write to DB
 *   npx tsx scripts/enrich-logos.ts --execute --force  # overwrite even non-Google URLs
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"
import { companyLogoUrlFromDomain, normalizeCompanyDomain } from "../lib/companies/logo-url"

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

function isLocalAsset(url: string) {
  return url.trim().startsWith("/")
}

async function main() {
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

    const current = row.logo_url?.trim() ?? ""

    // Never overwrite curated local SVG marks
    if (current && isLocalAsset(current) && !force) { skipped++; continue }

    // Only upgrade Google Favicon URLs (or force-overwrite everything)
    if (current && !isGoogleFaviconUrl(current) && !force) { skipped++; continue }

    const next = companyLogoUrlFromDomain(domain, "clearbit")
    if (current === next) { skipped++; continue }

    console.log(`${execute ? "" : "[dry] "}${row.name} (${domain})\n  ${current || "(null)"}\n  → ${next}`)

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

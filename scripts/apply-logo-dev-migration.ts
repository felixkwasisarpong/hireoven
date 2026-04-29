/**
 * Apply high-confidence logo.dev URL upgrades to the companies table.
 *
 * Only touches rows classified as "high confidence":
 *   - Current logo_url is a Clearbit URL, Google Favicon URL, or null/missing
 *   - Company has a non-ATS real domain to generate a logo.dev URL from
 *
 * Rows with ATS-domain logos, curated local assets, or already-correct logo.dev
 * URLs are never modified.
 *
 * Requires: DATABASE_URL, LOGO_DEV_TOKEN
 *
 * Usage:
 *   npx tsx scripts/apply-logo-dev-migration.ts            # dry run (show what would change)
 *   npx tsx scripts/apply-logo-dev-migration.ts --execute  # write to DB
 *   npx tsx scripts/apply-logo-dev-migration.ts --execute --limit=500  # batch cap
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { companyLogoUrlFromDomain, normalizeCompanyDomain } from "../lib/companies/logo-url"
import { isAtsDomain } from "../lib/companies/ats-domains"

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const execute = process.argv.includes("--execute")
const limit = Number(flag("limit")) || undefined

// ─── URL classifiers ─────────────────────────────────────────────────────────

function isLocalAsset(url: string) {
  return url.trim().startsWith("/")
}

function isLogoDevUrl(url: string) {
  try { return new URL(url).hostname === "img.logo.dev" } catch { return false }
}

function isClearbitUrl(url: string) {
  try { return new URL(url).hostname === "logo.clearbit.com" } catch { return false }
}

function isGoogleFaviconUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.includes("google.com") || host.endsWith(".gstatic.com")
  } catch { return false }
}

function logoUrlAtsDomain(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (host === "logo.clearbit.com") {
      const d = u.pathname.replace(/^\/+/, "").split("/")[0] ?? ""
      return isAtsDomain(d)
    }
    if (host.includes("google.com")) {
      const d = u.searchParams.get("domain") ?? ""
      return isAtsDomain(d)
    }
    return false
  } catch { return false }
}

type Row = {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const token = process.env.LOGO_DEV_TOKEN ?? process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ?? ""
  if (!token) {
    console.error(
      "LOGO_DEV_TOKEN is not set — cannot generate logo.dev URLs.\n" +
      "Set it in .env.local and re-run."
    )
    process.exit(1)
  }

  console.log(`\n[logo-dev] mode=${execute ? "EXECUTE" : "dry-run"}${limit ? ` limit=${limit}` : ""}`)

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const { rows } = await pool.query<Row>(
    `SELECT id, name, domain, logo_url
     FROM companies
     WHERE is_active = true
     ORDER BY name`
  )

  console.log(`[logo-dev] active companies loaded: ${rows.length.toLocaleString()}`)

  type Fix = { id: string; name: string; domain: string; current: string; next: string; reason: string }

  const fixes: Fix[] = []
  let skipped = 0

  for (const row of rows) {
    const current = row.logo_url?.trim() ?? ""
    const domain = normalizeCompanyDomain(row.domain ?? "")

    // Skip: no domain
    if (!domain) { skipped++; continue }

    // Skip: ATS domain for the company itself
    if (isAtsDomain(domain)) { skipped++; continue }

    // Skip: already a curated local asset
    if (current && isLocalAsset(current)) { skipped++; continue }

    // Skip: already a valid logo.dev URL
    if (current && isLogoDevUrl(current)) { skipped++; continue }

    // Skip: ATS-domain embedded in current logo URL (need domain fix first)
    if (current && logoUrlAtsDomain(current)) { skipped++; continue }

    // Determine reason / confidence gate
    const isClearbit = current ? isClearbitUrl(current) : false
    const isGoogle = current ? isGoogleFaviconUrl(current) : false
    const isMissing = !current

    // High-confidence only: clearbit, google-favicon, or missing
    if (!isClearbit && !isGoogle && !isMissing) { skipped++; continue }

    const next = companyLogoUrlFromDomain(domain, "logo-dev")
    if (!next || current === next) { skipped++; continue }

    const reason = isClearbit ? "clearbit" : isGoogle ? "google_favicon" : "missing"
    fixes.push({ id: row.id, name: row.name, domain, current, next, reason })
  }

  const batch = limit ? fixes.slice(0, limit) : fixes

  console.log(`[logo-dev] high-confidence fixes: ${batch.length.toLocaleString()} (skipped: ${skipped.toLocaleString()})`)

  if (batch.length === 0) {
    console.log("[logo-dev] Nothing to update.")
    await pool.end()
    return
  }

  console.log("\nSample (first 25):")
  for (const f of batch.slice(0, 25)) {
    console.log(
      `  ${execute ? "" : "[dry] "}${f.name.slice(0, 40).padEnd(40)} [${f.reason}]\n` +
      `    ${f.current || "(null)"}\n` +
      `    → ${f.next}`
    )
  }
  if (batch.length > 25) console.log(`  … and ${batch.length - 25} more`)

  if (execute) {
    let done = 0
    for (const f of batch) {
      try {
        await pool.query(
          "UPDATE companies SET logo_url = $1, updated_at = NOW() WHERE id = $2",
          [f.next, f.id]
        )
        done++
      } catch (err) {
        console.error(`  FAILED ${f.name} (${f.id}):`, err)
      }
    }
    console.log(`\n[logo-dev] Updated ${done.toLocaleString()} / ${batch.length.toLocaleString()} rows.`)
  } else {
    console.log(`\n[logo-dev] Dry run — ${batch.length.toLocaleString()} rows would be updated.`)
    console.log("Re-run with --execute to apply.")
  }

  await pool.end()
}

main().catch((err) => {
  console.error("\napply-logo-dev-migration failed:", err)
  process.exit(1)
})

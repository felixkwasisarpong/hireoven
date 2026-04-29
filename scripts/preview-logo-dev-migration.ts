/**
 * Audit all active companies and classify their current logo_url.
 *
 * Categories:
 *   ok_local        — curated /company-logos/ static asset (no change needed)
 *   ok_logo_dev     — already using logo.dev correctly (no change needed)
 *   clearbit        — uses logo.clearbit.com (candidate → upgrade to logo.dev)
 *   google_favicon  — uses Google Favicon CDN (candidate → upgrade to logo.dev)
 *   missing         — logo_url is null or empty (candidate → backfill with logo.dev)
 *   ats_domain      — logo URL points at an ATS domain (broken, needs domain fix first)
 *   other           — some other stored URL (informational)
 *
 * High-confidence candidates (clearbit / google_favicon / missing + valid real domain)
 * are the rows that `apply-logo-dev-migration.ts --execute` will update.
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL or DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * For logo-dev URL generation: LOGO_DEV_TOKEN
 *
 * Usage:
 *   npx tsx scripts/preview-logo-dev-migration.ts
 *   npx tsx scripts/preview-logo-dev-migration.ts --report=scripts/output/logo-migration-preview.json
 */

import path from "node:path"
import fs from "node:fs"
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { companyLogoUrlFromDomain, normalizeCompanyDomain, isLogoUrlSafe } from "../lib/companies/logo-url"
import { isAtsDomain } from "../lib/companies/ats-domains"

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const reportPath =
  flag("report") ??
  path.join(process.cwd(), "scripts", "output", "logo-migration-preview.json")

// ─── URL classifier helpers ──────────────────────────────────────────────────

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

function logoUrlAtsDomain(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (host === "logo.clearbit.com") {
      const d = u.pathname.replace(/^\/+/, "").split("/")[0] ?? ""
      return isAtsDomain(d) ? d : null
    }
    if (host.includes("google.com")) {
      const d = u.searchParams.get("domain") ?? ""
      return isAtsDomain(d) ? d : null
    }
    if (host === "img.logo.dev") {
      const d = u.pathname.replace(/^\/+/, "").split("?")[0] ?? ""
      return isAtsDomain(d) ? d : null
    }
    return null
  } catch { return null }
}

type LogoCategory =
  | "ok_local"
  | "ok_logo_dev"
  | "clearbit"
  | "google_favicon"
  | "missing"
  | "ats_domain"
  | "other"

function classifyLogoUrl(url: string | null): LogoCategory {
  if (!url?.trim()) return "missing"
  const u = url.trim()
  if (isLocalAsset(u)) return "ok_local"
  if (isLogoDevUrl(u)) return "ok_logo_dev"
  if (logoUrlAtsDomain(u)) return "ats_domain"
  if (isClearbitUrl(u)) return "clearbit"
  if (isGoogleFaviconUrl(u)) return "google_favicon"
  return "other"
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Row = {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
  is_active: boolean | null
}

type AuditEntry = {
  id: string
  name: string
  domain: string | null
  current_logo_url: string | null
  category: LogoCategory
  next_logo_url: string | null
  confidence: "high" | "low" | null
  skip_reason: string | null
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const token = process.env.LOGO_DEV_TOKEN ?? process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ?? ""
  if (!token) {
    console.warn(
      "⚠  LOGO_DEV_TOKEN is not set — next_logo_url fields will fall back to Google Favicon URLs."
    )
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const { rows } = await pool.query<Row>(
    `SELECT id, name, domain, logo_url, is_active
     FROM companies
     WHERE is_active = true
     ORDER BY name`
  )
  await pool.end()

  console.log(`\n[audit] active companies: ${rows.length.toLocaleString()}`)

  const entries: AuditEntry[] = []
  const counts: Record<LogoCategory, number> = {
    ok_local: 0,
    ok_logo_dev: 0,
    clearbit: 0,
    google_favicon: 0,
    missing: 0,
    ats_domain: 0,
    other: 0,
  }

  for (const row of rows) {
    const category = classifyLogoUrl(row.logo_url)
    counts[category]++

    let next_logo_url: string | null = null
    let confidence: AuditEntry["confidence"] = null
    let skip_reason: string | null = null

    if (category === "ok_local" || category === "ok_logo_dev") {
      skip_reason = "already_good"
    } else {
      const domain = normalizeCompanyDomain(row.domain ?? "")
      if (!domain) {
        skip_reason = "no_domain"
        confidence = "low"
      } else if (isAtsDomain(domain)) {
        skip_reason = "ats_domain"
        confidence = "low"
      } else {
        next_logo_url = companyLogoUrlFromDomain(domain, "logo-dev")
        confidence =
          category === "clearbit" || category === "google_favicon" || category === "missing"
            ? "high"
            : "low"
      }
    }

    entries.push({
      id: row.id,
      name: row.name,
      domain: row.domain,
      current_logo_url: row.logo_url,
      category,
      next_logo_url,
      confidence,
      skip_reason,
    })
  }

  // ─── Summary ───────────────────────────────────────────────────────────────

  const highConfidence = entries.filter((e) => e.confidence === "high")
  const atsDomainRows = entries.filter((e) => e.category === "ats_domain")

  console.log("\n[audit] logo_url breakdown:")
  for (const [cat, n] of Object.entries(counts)) {
    console.log(`  ${cat.padEnd(16)} ${n.toLocaleString()}`)
  }
  console.log(`\n[audit] high-confidence upgrades available: ${highConfidence.length.toLocaleString()}`)
  console.log(`[audit] broken ATS-domain logos:            ${atsDomainRows.length.toLocaleString()}`)

  if (highConfidence.length > 0) {
    console.log("\nSample high-confidence upgrades (first 20):")
    for (const e of highConfidence.slice(0, 20)) {
      console.log(
        `  ${e.name.slice(0, 40).padEnd(40)} [${e.category}]\n` +
        `    ${e.current_logo_url ?? "(null)"}\n` +
        `    → ${e.next_logo_url}`
      )
    }
  }

  if (atsDomainRows.length > 0) {
    console.log("\nSample ATS-domain logos (need domain fix first, first 10):")
    for (const e of atsDomainRows.slice(0, 10)) {
      console.log(`  ${e.name.slice(0, 40).padEnd(40)} ${e.current_logo_url}`)
    }
  }

  // ─── Write report ──────────────────────────────────────────────────────────

  const abs = path.isAbsolute(reportPath)
    ? reportPath
    : path.join(process.cwd(), reportPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(
    abs,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        token_present: Boolean(token),
        active_companies: rows.length,
        counts,
        high_confidence_count: highConfidence.length,
        ats_domain_count: atsDomainRows.length,
        entries,
      },
      null,
      2
    )
  )
  console.log(`\n[audit] Report written: ${abs}`)
  console.log(
    `\nTo apply high-confidence updates run:\n  npx tsx scripts/apply-logo-dev-migration.ts\n  npx tsx scripts/apply-logo-dev-migration.ts --execute`
  )
}

main().catch((err) => {
  console.error("\npreview-logo-dev-migration failed:", err)
  process.exit(1)
})

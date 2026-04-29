/**
 * Read-only crawler health audit by default.
 *
 * Usage:
 *   npx tsx scripts/audit-crawler-health.ts
 *   npx tsx scripts/audit-crawler-health.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { normalizeAtsUrl } from "@/lib/companies/ats-url-normalization"
import { isAtsDomain, isTemporaryCareersUrl, normalizeDomain } from "@/lib/companies/ats-domains"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")

type CompanyRow = {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
  careers_url: string | null
  ats_type: string | null
  ats_identifier: string | null
  job_count: number | null
  raw_ats_config: Record<string, unknown> | null
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function logoDomain(logoUrl: string | null | undefined) {
  if (!logoUrl) return ""
  try {
    const url = new URL(logoUrl)
    const host = url.hostname.toLowerCase()
    if (host.includes("google.com") || host.endsWith(".gstatic.com")) {
      return normalizeDomain(url.searchParams.get("domain") ?? url.searchParams.get("domain_url"))
    }
    if (host === "logo.clearbit.com" || host === "unavatar.io") {
      return normalizeDomain(url.pathname.replace(/^\/+/, ""))
    }
    if (host === "icons.duckduckgo.com") {
      return normalizeDomain(url.pathname.replace(/^\/+ip3\//, "").replace(/\.ico$/i, ""))
    }
    if (host === "icon.horse") {
      return normalizeDomain(url.pathname.replace(/^\/+icon\//, ""))
    }
    if (host === "img.logo.dev") {
      return normalizeDomain(url.pathname.replace(/^\/+/, ""))
    }
    return normalizeDomain(host)
  } catch {
    return ""
  }
}

function compact(value: string | null | undefined, maxLength = 160) {
  const text = (value ?? "").replace(/\s+/g, " ").trim()
  if (text.length <= maxLength) return text || "none"
  return `${text.slice(0, maxLength - 1)}…`
}

async function getPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({ connectionString })
}

async function main() {
  const pool = await getPool()
  try {
    const { rows } = await pool.query<CompanyRow>(
      `SELECT id, name, domain, logo_url, careers_url, ats_type, ats_identifier, job_count, raw_ats_config
       FROM companies
       WHERE is_active = true
       ORDER BY name ASC`
    )

    const atsDomainRows = rows.filter((row) => isAtsDomain(row.domain))
    const missingLogoRows = rows.filter((row) => !row.logo_url || isAtsDomain(logoDomain(row.logo_url)))
    const zeroJobRows = rows.filter((row) => Number(row.job_count ?? 0) === 0)
    const temporaryUrlRows = rows.filter((row) => isTemporaryCareersUrl(row.careers_url))
    const normalizedUrlRows = rows
      .map((row) => ({
        row,
        normalized: row.careers_url
          ? normalizeAtsUrl(row.careers_url, { atsType: row.ats_type })
          : null,
      }))
      .filter(({ row, normalized }) => {
        return Boolean(
          normalized?.shouldPersist &&
            row.careers_url &&
            normalized.normalizedUrl !== row.careers_url &&
            (normalized.provider !== "custom" || isTemporaryCareersUrl(row.careers_url))
        )
      })

    const failedCrawls = await pool.query<{
      status: string
      error_reason: string | null
      count: string
    }>(
      `SELECT status,
              COALESCE(error_message, 'none') AS error_reason,
              COUNT(*)::text AS count
       FROM crawl_logs
       WHERE crawled_at >= NOW() - INTERVAL '14 days'
       GROUP BY status, COALESCE(error_message, 'none')
       ORDER BY COUNT(*) DESC
       LIMIT 25`
    )

    console.log(`\n[crawler-health] mode=${execute ? "EXECUTE" : "DRY-RUN"}`)
    console.log(`Active companies checked: ${rows.length}`)
    console.log(`ATS domains in companies.domain: ${atsDomainRows.length}`)
    console.log(`Missing or ATS-derived logos: ${missingLogoRows.length}`)
    console.log(`Companies with 0 jobs: ${zeroJobRows.length}`)
    console.log(`Temporary/unstable careers URLs: ${temporaryUrlRows.length}`)
    console.log(`Careers URLs with normalized replacements: ${normalizedUrlRows.length}`)

    const zeroByAts = new Map<string, number>()
    for (const row of zeroJobRows) {
      const key = row.ats_type ?? "null"
      zeroByAts.set(key, (zeroByAts.get(key) ?? 0) + 1)
    }
    console.log("\nZero-job companies by ATS:")
    for (const [ats, count] of [...zeroByAts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${ats.padEnd(18)} ${count}`)
    }

    console.log("\nRecent crawl status/error counts:")
    for (const row of failedCrawls.rows) {
      console.log(`  ${row.status.padEnd(10)} ${row.count.padStart(5)}  ${compact(row.error_reason)}`)
    }

    console.log("\nPreview SQL:")
    console.log("BEGIN;")

    for (const { row, normalized } of normalizedUrlRows.slice(0, 200)) {
      if (!normalized) continue
      console.log(
        `UPDATE companies SET careers_url = ${sqlString(normalized.normalizedUrl)}, ats_identifier = COALESCE(ats_identifier, ${normalized.atsIdentifier ? sqlString(normalized.atsIdentifier) : "NULL"}), updated_at = NOW() WHERE id = ${sqlString(row.id)}; -- ${row.name}`
      )
      if (execute) {
        await pool.query(
          `UPDATE companies
           SET careers_url = $1,
               ats_identifier = COALESCE(ats_identifier, $2),
               updated_at = NOW()
           WHERE id = $3`,
          [normalized.normalizedUrl, normalized.atsIdentifier, row.id]
        )
      }
    }

    for (const row of missingLogoRows.slice(0, 200)) {
      const domain = normalizeDomain(row.domain)
      if (!domain || isAtsDomain(domain)) continue
      const nextLogo = companyLogoUrlFromDomain(domain)
      if (!nextLogo || nextLogo === row.logo_url) continue
      console.log(
        `UPDATE companies SET logo_url = ${sqlString(nextLogo)}, updated_at = NOW() WHERE id = ${sqlString(row.id)}; -- ${row.name}`
      )
      if (execute) {
        await pool.query(
          `UPDATE companies SET logo_url = $1, updated_at = NOW() WHERE id = $2`,
          [nextLogo, row.id]
        )
      }
    }

    if (atsDomainRows.length > 0) {
      console.log("-- Companies with ATS domains need manual domain repair:")
      for (const row of atsDomainRows.slice(0, 50)) {
        console.log(`-- ${row.name}: domain=${row.domain ?? "null"} careers=${row.careers_url ?? "null"}`)
      }
    }

    console.log(execute ? "COMMIT;" : "ROLLBACK; -- review first, rerun with --execute to apply safe updates")
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("audit-crawler-health failed:", error)
  process.exit(1)
})

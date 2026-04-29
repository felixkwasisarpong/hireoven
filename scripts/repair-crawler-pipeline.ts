/**
 * Unified crawler pipeline repair script.
 *
 * Fixes:
 *   1. ATS type backfill  — detectAts() from careers_url + apply URLs
 *   2. Careers URL repair — deriveCanonicalCareersUrl() per company
 *   3. Logo repair        — fix ATS-subdomain domains + Clearbit 404s
 *   4. Domain audit       — detect ATS-contaminated/null domains; flag 0-job companies
 *
 * Usage:
 *   npx tsx scripts/repair-crawler-pipeline.ts              # dry-run (safe)
 *   npx tsx scripts/repair-crawler-pipeline.ts --execute    # write changes
 *   npx tsx scripts/repair-crawler-pipeline.ts --step=ats --execute
 *   npx tsx scripts/repair-crawler-pipeline.ts --step=careers --execute
 *   npx tsx scripts/repair-crawler-pipeline.ts --step=logos --execute
 *   npx tsx scripts/repair-crawler-pipeline.ts --step=domains --execute  # CSV export
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { detectAts } from "@/lib/companies/detect-ats"
import { deriveCanonicalCareersUrl } from "@/lib/companies/canonical-careers-url"
import { companyLogoUrlFromDomain, isLogoUrlSafe } from "@/lib/companies/logo-url"
import {
  isAtsDomain as isKnownAtsDomain,
  isTemporaryCareersUrl,
} from "@/lib/companies/ats-domains"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const stepArg = process.argv.find((a) => a.startsWith("--step="))?.split("=")[1] ?? "all"
const runStep = (name: string) => stepArg === "all" || stepArg === name

const ATS_SUBDOMAIN_PATTERNS = [
  ".icims.com",
  ".greenhouse.io",
  ".lever.co",
  ".ashbyhq.com",
  ".myworkdayjobs.com",
  ".smartrecruiters.com",
  ".bamboohr.com",
]

function normalizeDomain(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
}

function isAtsDomain(domain: string | null | undefined): boolean {
  const d = normalizeDomain(domain)
  return isKnownAtsDomain(d) || ATS_SUBDOMAIN_PATTERNS.some((p) => d.endsWith(p))
}

function domainFromUrl(url: string | null | undefined): string {
  if (!url) return ""
  try { return normalizeDomain(new URL(url).hostname) } catch { return "" }
}

function isPlaceholderDomain(d: string | null | undefined): boolean {
  const n = normalizeDomain(d)
  return n.endsWith(".lca-employer") || n.endsWith(".uscis-employer") || !n
}

async function getPool(): Promise<Pool> {
  const connStr = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connStr) {
    console.error("Missing DATABASE_URL / TARGET_POSTGRES_URL")
    process.exit(1)
  }
  const sslMode = process.env.PGSSLMODE ?? process.env.DATABASE_SSL ?? ""
  let ssl: object | undefined = undefined
  if (sslMode === "disable" || sslMode === "false" || sslMode === "0") {
    ssl = undefined
  } else if (sslMode === "require" || sslMode === "true" || sslMode === "1") {
    ssl = { rejectUnauthorized: false }
  } else if (!connStr.includes("sslmode=disable")) {
    // local dev — try without SSL first
    ssl = undefined
  }
  return new Pool({ connectionString: connStr, ssl })
}

// ── Step 1: ATS Backfill ──────────────────────────────────────────────────────

async function stepAts(pool: Pool) {
  console.log("\n═══ STEP 1: ATS TYPE BACKFILL ═══")

  const companies = await pool.query<{
    id: string; name: string; domain: string | null
    careers_url: string | null; ats_type: string | null; ats_identifier: string | null
  }>(
    `SELECT id, name, domain, careers_url, ats_type, ats_identifier
     FROM companies WHERE is_active = true`
  )

  const jobs = await pool.query<{ company_id: string; apply_url: string }>(
    `SELECT company_id, apply_url FROM jobs
     WHERE is_active = true AND apply_url IS NOT NULL`
  )

  const applyByCompany = new Map<string, string[]>()
  for (const r of jobs.rows) {
    if (!r.company_id || !r.apply_url) continue
    const list = applyByCompany.get(r.company_id) ?? []
    list.push(r.apply_url)
    applyByCompany.set(r.company_id, list)
  }

  let changed = 0; let skipped = 0

  for (const co of companies.rows) {
    const detected = detectAts({
      careersUrl: co.careers_url,
      applyUrls: applyByCompany.get(co.id) ?? [],
    })
    if (!detected) { skipped++; continue }

    const shouldUpdateType =
      !co.ats_type || co.ats_type === "custom" || co.ats_type === "unknown"
    const shouldUpdateId = !co.ats_identifier && Boolean(detected.atsIdentifier)

    if (!shouldUpdateType && !shouldUpdateId) { skipped++; continue }

    const nextType = shouldUpdateType ? detected.atsType : co.ats_type
    const nextId = shouldUpdateId ? detected.atsIdentifier : co.ats_identifier

    console.log(
      `  ${execute ? "" : "[dry] "}${co.name.slice(0, 40).padEnd(40)} ${(co.ats_type ?? "null").padEnd(12)} → ${nextType}${nextId ? ` (${nextId})` : ""} [${detected.confidence}]`
    )

    if (execute) {
      await pool.query(
        `UPDATE companies SET ats_type=$1, ats_identifier=COALESCE(ats_identifier,$2), updated_at=NOW()
         WHERE id=$3`,
        [nextType, nextId, co.id]
      )
    }
    changed++
  }

  console.log(`\n  ATS: ${execute ? "updated" : "would update"} ${changed}, skipped ${skipped}`)
}

// ── Step 2: Careers URL Backfill ─────────────────────────────────────────────

async function stepCareers(pool: Pool) {
  console.log("\n═══ STEP 2: CAREERS URL BACKFILL ═══")

  const companies = await pool.query<{
    id: string; name: string; domain: string | null
    careers_url: string | null; ats_type: string | null; ats_identifier: string | null
  }>(
    `SELECT id, name, domain, careers_url, ats_type, ats_identifier
     FROM companies WHERE is_active = true`
  )

  const jobs = await pool.query<{ company_id: string; apply_url: string }>(
    `SELECT company_id, apply_url FROM jobs
     WHERE is_active = true AND apply_url IS NOT NULL`
  )

  const applyByCompany = new Map<string, string[]>()
  for (const r of jobs.rows) {
    if (!r.company_id || !r.apply_url) continue
    const list = applyByCompany.get(r.company_id) ?? []
    list.push(r.apply_url)
    applyByCompany.set(r.company_id, list)
  }

  let changed = 0; let unchanged = 0

  for (const co of companies.rows) {
    if (!co.domain) continue
    const applyUrls = applyByCompany.get(co.id) ?? []
    const next = deriveCanonicalCareersUrl(
      { domain: co.domain, careers_url: co.careers_url ?? "", ats_type: co.ats_type, ats_identifier: co.ats_identifier },
      { applyUrls }
    )
    const prev = (co.careers_url ?? "").trim()
    if (prev === next) { unchanged++; continue }
    const needsReview = isTemporaryCareersUrl(prev) && applyUrls.length === 0

    console.log(
      `  ${execute ? "" : "[dry] "}${co.name.slice(0, 36).padEnd(36)}${needsReview ? " [needs review]" : ""}\n    ${prev || "(empty)"}\n    → ${next}`
    )

    if (execute) {
      await pool.query(
        `UPDATE companies
         SET careers_url=$1,
             raw_ats_config = CASE
               WHEN $3::boolean THEN COALESCE(raw_ats_config, '{}'::jsonb) || '{"needs_manual_review": true, "manual_review_reason": "temporary_careers_url_repaired_without_apply_url_evidence"}'::jsonb
               ELSE raw_ats_config
             END,
             updated_at=NOW()
         WHERE id=$2`,
        [next, co.id, needsReview]
      )
    }
    changed++
  }

  console.log(`\n  Careers: ${execute ? "updated" : "would update"} ${changed}, unchanged ${unchanged}`)
}

// ── Step 3: Logo Repair ───────────────────────────────────────────────────────

async function stepLogos(pool: Pool) {
  console.log("\n═══ STEP 3: LOGO REPAIR ═══")

  const companies = await pool.query<{
    id: string; name: string; domain: string | null
    logo_url: string | null; careers_url: string | null
    raw_ats_config: Record<string, unknown> | null
  }>(
    `SELECT id, name, domain, logo_url, careers_url, raw_ats_config
     FROM companies WHERE is_active = true`
  )

  let fixed = 0; let reviewed = 0

  for (const co of companies.rows) {
    const domain = normalizeDomain(co.domain)
    const logoUrl = co.logo_url ?? ""

    const isBrokenDomain = isAtsDomain(domain) || isPlaceholderDomain(domain)
    const logoIsUnsafe = !isLogoUrlSafe(logoUrl)
    const logoHasAtsDomain = ATS_SUBDOMAIN_PATTERNS.some((p) =>
      logoUrl.toLowerCase().includes(p.slice(1))
    )

    // Also repair companies with null/empty logos when a valid domain exists
    const logoIsMissing = !logoUrl

    const needsRepair = isBrokenDomain || logoIsUnsafe || logoHasAtsDomain || logoIsMissing
    if (!needsRepair) continue

    // Try to derive a better domain from careers_url or raw_ats_config
    const careersHost = domainFromUrl(co.careers_url)
    // Skip ATS hosts from careers_url
    const safeCareersHost = careersHost && !isAtsDomain(careersHost) ? careersHost : ""

    const matchedUrlHost = domainFromUrl(
      (co.raw_ats_config as Record<string, unknown> | null)?.ats_detection
        ? ((co.raw_ats_config as Record<string, { matchedUrl?: string }>)
            ?.ats_detection?.matchedUrl ?? null)
        : null
    )
    const guessedDomain =
      (co.raw_ats_config as Record<string, unknown> | null)?.domain_verified === true
        ? normalizeDomain(
            String(
              (co.raw_ats_config as Record<string, unknown>)?.guessed_domain ?? ""
            )
          )
        : ""

    // Pick best candidate that isn't an ATS subdomain or placeholder
    const candidates = [guessedDomain, !isBrokenDomain ? domain : "", safeCareersHost, matchedUrlHost].filter(
      (d) => d && !isAtsDomain(d) && !isPlaceholderDomain(d) && d.includes(".")
    )
    const bestDomain = candidates[0] ?? null

    if (!bestDomain) {
      console.log(`  [review] ${co.name.slice(0, 42)} — cannot infer domain (current: ${domain || "null"})`)
      reviewed++
      continue
    }

    const nextLogo = companyLogoUrlFromDomain(bestDomain)
    // If we already have a safe logo and the domain isn't broken, skip unless domain changes
    if (!isBrokenDomain && isLogoUrlSafe(logoUrl) && nextLogo === logoUrl) continue
    if (nextLogo === logoUrl && bestDomain === domain) continue

    const reason = isBrokenDomain
      ? "ats-domain"
      : logoHasAtsDomain
      ? "ats-logo-domain"
      : logoIsUnsafe
      ? "unsafe-logo"
      : logoIsMissing
      ? "missing-logo"
      : "logo-refresh"

    console.log(
      `  ${execute ? "" : "[dry] "}${co.name.slice(0, 36).padEnd(36)} [${reason}]\n    domain: ${domain} → ${bestDomain}\n    logo:   ${(logoUrl || "(none)").slice(0, 60)}\n         → ${nextLogo}`
    )

    if (execute) {
      await pool.query(
        `UPDATE companies SET domain=$1, logo_url=$2, updated_at=NOW() WHERE id=$3`,
        [bestDomain, nextLogo, co.id]
      )
    }
    fixed++
  }

  console.log(`\n  Logos: ${execute ? "fixed" : "would fix"} ${fixed}, needs manual review: ${reviewed}`)
}

// ── Step 4: Domain Audit ──────────────────────────────────────────────────────

/**
 * Identify companies with ATS-contaminated, null, or placeholder domains and
 * flag companies with 0 jobs that have homepage-looking career URLs.
 *
 * In --execute mode this writes a CSV to stdout for manual review.
 * Without --execute it prints a summary and sample rows.
 */
async function stepDomains(pool: Pool) {
  console.log("\n═══ STEP 4: DOMAIN AUDIT ═══")

  const companies = await pool.query<{
    id: string
    name: string
    domain: string | null
    careers_url: string | null
    logo_url: string | null
    ats_type: string | null
    ats_identifier: string | null
    job_count: number | null
    last_crawled_at: string | null
  }>(
    `SELECT id, name, domain, careers_url, logo_url, ats_type, ats_identifier,
            job_count, last_crawled_at
     FROM companies
     WHERE is_active = true
     ORDER BY name`
  )

  type DomainIssue = {
    id: string
    name: string
    domain: string | null
    careers_url: string | null
    ats_type: string | null
    job_count: number | null
    issues: string[]
  }

  const flagged: DomainIssue[] = []

  for (const co of companies.rows) {
    const domain = normalizeDomain(co.domain)
    const issues: string[] = []

    // Domain issues
    if (!domain) {
      issues.push("domain_missing")
    } else if (isAtsDomain(domain)) {
      issues.push("domain_is_ats")
    } else if (isPlaceholderDomain(domain)) {
      issues.push("domain_is_placeholder")
    }

    // Logo issues
    if (!isLogoUrlSafe(co.logo_url)) {
      issues.push("logo_unsafe_or_missing")
    }

    // Career URL issues
    if (!co.careers_url) {
      issues.push("careers_url_missing")
    } else {
      try {
        const careersHost = new URL(co.careers_url).hostname.toLowerCase()
        if (isAtsDomain(careersHost) && co.ats_type === "custom") {
          issues.push("careers_url_is_ats_for_custom")
        }
      } catch {
        issues.push("careers_url_invalid")
      }
    }

    // 0-job issue
    if ((co.job_count ?? 0) === 0) {
      issues.push("zero_jobs")
    }

    if (issues.length > 0) {
      flagged.push({
        id: co.id,
        name: co.name,
        domain: co.domain,
        careers_url: co.careers_url,
        ats_type: co.ats_type,
        job_count: co.job_count,
        issues,
      })
    }
  }

  console.log(`\n  Total active companies: ${companies.rows.length}`)
  console.log(`  Companies with domain issues: ${flagged.length}`)

  // Group by issue type for summary
  const issueCounts = new Map<string, number>()
  for (const f of flagged) {
    for (const issue of f.issues) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1)
    }
  }
  console.log("\n  Issue breakdown:")
  for (const [issue, count] of [...issueCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${issue.padEnd(32)} ${count}`)
  }

  if (execute) {
    // Export CSV to stdout for spreadsheet review
    const header = "id,name,domain,careers_url,ats_type,job_count,issues"
    const rows = flagged.map((f) => {
      const esc = (v: string | null | number | undefined) =>
        `"${String(v ?? "").replace(/"/g, '""')}"`
      return [esc(f.id), esc(f.name), esc(f.domain), esc(f.careers_url), esc(f.ats_type), esc(f.job_count), esc(f.issues.join("|"))].join(",")
    })
    console.log("\n" + [header, ...rows].join("\n"))
  } else {
    // Sample of flagged companies
    console.log("\n  Sample flagged companies (up to 20):")
    for (const f of flagged.slice(0, 20)) {
      console.log(`    [${f.issues.join(",")}] ${f.name.slice(0, 40)} — domain: ${f.domain ?? "null"}, jobs: ${f.job_count ?? 0}`)
    }
  }
}

// ── Step 5: Diagnostics Summary ───────────────────────────────────────────────

async function stepDiagnostics(pool: Pool) {
  console.log("\n═══ DIAGNOSTICS SUMMARY ═══")

  const zeroJobs = await pool.query<{ count: string; ats_type: string }>(
    `SELECT ats_type, COUNT(*)::text AS count
     FROM companies
     WHERE is_active = true AND job_count = 0
     GROUP BY ats_type
     ORDER BY COUNT(*) DESC`
  )
  console.log("\n  Companies with 0 active jobs by ATS type:")
  for (const r of zeroJobs.rows) {
    console.log(`    ${(r.ats_type ?? "null").padEnd(16)} ${r.count}`)
  }

  const neverCrawled = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM companies
     WHERE is_active = true AND last_crawled_at IS NULL`
  )
  console.log(`\n  Never-crawled active companies: ${neverCrawled.rows[0]?.count ?? 0}`)

  const icimsWrong = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM companies
     WHERE ats_type = 'icims'
       AND careers_url NOT ILIKE '%icims.com%'
       AND is_active = true`
  )
  console.log(`  iCIMS companies on branded (non-icims.com) portal: ${icimsWrong.rows[0]?.count ?? 0}`)

  const clearbitLogos = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM companies
     WHERE logo_url ILIKE 'https://logo.clearbit.com/%' AND is_active = true`
  )
  console.log(`  Companies with Clearbit logo URLs: ${clearbitLogos.rows[0]?.count ?? 0}`)

  const atsSubdomainLogos = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM companies
     WHERE is_active = true AND (
       domain ILIKE '%.icims.com' OR domain ILIKE '%.greenhouse.io' OR
       domain ILIKE '%.lever.co' OR domain ILIKE '%.myworkdayjobs.com' OR
       domain ILIKE '%.bamboohr.com' OR domain ILIKE '%.lca-employer' OR
       domain ILIKE '%.uscis-employer' OR domain IS NULL OR domain = ''
     )`
  )
  console.log(`  Companies with ATS/placeholder/null domain: ${atsSubdomainLogos.rows[0]?.count ?? 0}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pool = await getPool()
  console.log(`\n[repair-pipeline] mode=${execute ? "EXECUTE" : "DRY-RUN"}, step=${stepArg}`)
  console.log("─".repeat(60))

  try {
    await stepDiagnostics(pool)
    if (runStep("ats"))     await stepAts(pool)
    if (runStep("careers")) await stepCareers(pool)
    if (runStep("logos"))   await stepLogos(pool)
    if (runStep("domains")) await stepDomains(pool)

    console.log("\n" + "═".repeat(60))
    console.log(execute
      ? "✓ Repair complete. Re-run the admin crawl for affected companies."
      : "↑ Dry-run complete. Append --execute to apply changes.")
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error("\nrepair-crawler-pipeline failed:", err)
  process.exit(1)
})

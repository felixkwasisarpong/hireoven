/**
 * Seed universities into `companies` and link H1B/LCA data where available.
 *
 * What it does:
 * 1) Pulls a broad US university list (name + domains + website).
 * 2) Upserts universities into `companies` by domain.
 * 3) Links unmatched `lca_records`, `h1b_records`, and `employer_lca_stats`
 *    rows to a university company using normalized employer names.
 * 4) Recomputes denormalized sponsorship fields for touched companies.
 *
 * Defaults to dry-run. Pass --execute to write.
 *
 * Usage:
 *   npx tsx scripts/seed-universities.ts
 *   npx tsx scripts/seed-universities.ts --execute
 *   npx tsx scripts/seed-universities.ts --execute --limit=500
 *   npx tsx scripts/seed-universities.ts --execute --source-url=<url>
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { companyLogoUrlFromDomain } from "../lib/companies/logo-url"
import { normalizeEmployerName } from "../lib/h1b/normalize-employer"

loadEnvConfig(process.cwd())

const DEFAULT_SOURCE_URL =
  "https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json"

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const execute = process.argv.includes("--execute")
const verbose = process.argv.includes("--verbose")
const sourceUrl = flag("source-url") ?? DEFAULT_SOURCE_URL
const limit = Number(flag("limit")) || undefined
const dryRun = !execute
const BATCH_SIZE = 100
const UNIVERSITY_SQL_RE = "(university|college|polytechnic|institute|school)"

type UniversitySourceRow = {
  name?: string | null
  country?: string | null
  domains?: string[] | null
  web_pages?: string[] | null
}

type UniversitySeed = {
  name: string
  domain: string
  careers_url: string
  normalized: string
}

type CompanyRow = {
  id: string
  name: string
  domain: string
}

type H1bEmployerRow = {
  employer_name: string
}

type LcaEmployerRow = {
  employer_name_normalized: string
}

type EmployerStatsRow = {
  employer_name_normalized: string
}

type CompanyPatch = {
  sponsors_h1b: boolean
  sponsorship_confidence: number
  h1b_sponsor_count_1yr: number
  h1b_sponsor_count_3yr: number
}

const HIGHER_ED_INCLUDE =
  /\b(university|college|polytechnic|institute(?:\s+of\s+technology)?|school\s+of\s+(medicine|law|public\s+health|engineering|business))\b/i

const HIGHER_ED_EXCLUDE =
  /\b(school\s+district|public\s+schools|high\s+school|middle\s+school|elementary\s+school|board\s+of\s+education|department\s+of\s+education|k[\s-]?12)\b/i

function isHigherEdName(name: string): boolean {
  const value = name.trim()
  if (!value) return false
  if (HIGHER_ED_EXCLUDE.test(value)) return false
  return HIGHER_ED_INCLUDE.test(value)
}

function sanitizeDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "")
  const withoutPath = withoutProtocol.split("/")[0] ?? ""
  const withoutPort = withoutPath.split(":")[0] ?? ""
  const withoutWww = withoutPort.replace(/^www\./, "")
  const clean = withoutWww.replace(/\.+$/, "")
  if (!clean || clean.length < 3) return null
  if (!clean.includes(".")) return null
  if (!/^[a-z0-9.-]+$/.test(clean)) return null
  return clean
}

function toHttpsUrl(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol === "http:") url.protocol = "https:"
    return url.toString()
  } catch {
    return null
  }
}

function normalizeCareersUrl(webPages: string[] | null | undefined, domain: string): string {
  for (const page of webPages ?? []) {
    const url = toHttpsUrl(page)
    if (url) return url
  }
  return `https://www.${domain}`
}

function bestDomain(domains: string[] | null | undefined): string | null {
  const cleaned = (domains ?? [])
    .map((d) => sanitizeDomain(d))
    .filter((d): d is string => Boolean(d))

  if (cleaned.length === 0) return null

  const edu = cleaned.find((d) => d.endsWith(".edu"))
  if (edu) return edu

  cleaned.sort((a, b) => a.length - b.length)
  return cleaned[0] ?? null
}

function toCompanyPatchFromSignals(
  uscisApprovals1y: number,
  uscisDenials1y: number,
  lcaCert1y: number,
  lcaCert3y: number,
  lcaTotalCertified: number,
  lcaTotalDenied: number
): CompanyPatch {
  const uscisTotal = uscisApprovals1y + uscisDenials1y
  const uscisApprovalRate = uscisTotal > 0 ? uscisApprovals1y / uscisTotal : 0
  const lcaDecided = lcaTotalCertified + lcaTotalDenied
  const lcaApprovalRate = lcaDecided > 0 ? lcaTotalCertified / lcaDecided : 0

  if (uscisTotal > 0) {
    let confidence = 0
    if (uscisApprovals1y > 0) confidence += 70
    if (uscisApprovalRate > 0.8) confidence += 10
    if (uscisApprovals1y > 10) confidence += 10
    if (uscisApprovals1y > 50) confidence += 10
    return {
      sponsors_h1b: uscisApprovals1y > 0 || lcaCert3y > 0,
      sponsorship_confidence: Math.min(100, confidence),
      h1b_sponsor_count_1yr: uscisApprovals1y,
      h1b_sponsor_count_3yr: lcaCert3y,
    }
  }

  let confidence = 0
  if (lcaCert1y > 0) confidence += 70
  if (lcaApprovalRate > 0.85) confidence += 10
  if (lcaCert1y > 10) confidence += 10
  if (lcaCert1y > 50) confidence += 10

  return {
    sponsors_h1b: lcaCert1y > 0 || lcaCert3y > 0,
    sponsorship_confidence: Math.min(100, confidence),
    h1b_sponsor_count_1yr: lcaCert1y,
    h1b_sponsor_count_3yr: lcaCert3y,
  }
}

async function loadSourceUniversities(): Promise<UniversitySeed[]> {
  const response = await fetch(sourceUrl, {
    headers: { "user-agent": "hireoven-university-seed/1.0" },
  })
  if (!response.ok) {
    throw new Error(`download source failed: HTTP ${response.status}`)
  }

  const rows = (await response.json()) as UniversitySourceRow[]
  const byDomain = new Map<string, UniversitySeed>()

  for (const row of rows) {
    const name = (row.name ?? "").trim()
    const country = (row.country ?? "").trim()
    if (!name || !country) continue
    if (!/united states/i.test(country)) continue
    if (!isHigherEdName(name)) continue

    const domain = bestDomain(row.domains)
    if (!domain) continue

    const careersUrl = normalizeCareersUrl(row.web_pages, domain)
    const normalized = normalizeEmployerName(name)
    if (!normalized) continue

    const existing = byDomain.get(domain)
    if (existing) {
      if (existing.name.length < name.length) {
        byDomain.set(domain, { name, domain, careers_url: careersUrl, normalized })
      }
      continue
    }

    byDomain.set(domain, {
      name,
      domain,
      careers_url: careersUrl,
      normalized,
    })
  }

  return Array.from(byDomain.values()).sort((a, b) => a.name.localeCompare(b.name))
}

async function loadCompanies(pool: Pool): Promise<CompanyRow[]> {
  const rows: CompanyRow[] = []
  let offset = 0
  const pageSize = 2000

  for (;;) {
    const res = await pool.query<CompanyRow>(
      `SELECT id, name, domain
       FROM companies
       ORDER BY created_at ASC
       OFFSET $1
       LIMIT $2`,
      [offset, pageSize]
    )
    if (res.rows.length === 0) break
    rows.push(...res.rows)
    if (res.rows.length < pageSize) break
    offset += pageSize
  }

  return rows
}

function buildCompanyIndex(companies: CompanyRow[]): {
  byDomain: Map<string, CompanyRow>
  byNormalized: Map<string, CompanyRow[]>
} {
  const byDomain = new Map<string, CompanyRow>()
  const byNormalized = new Map<string, CompanyRow[]>()

  for (const c of companies) {
    byDomain.set(c.domain.toLowerCase(), c)
    const normalized = normalizeEmployerName(c.name)
    if (!normalized) continue
    byNormalized.set(normalized, [...(byNormalized.get(normalized) ?? []), c])
  }

  return { byDomain, byNormalized }
}

function isPlaceholderDomain(domain: string): boolean {
  const d = domain.toLowerCase()
  return d.endsWith(".lca-employer") || d.endsWith(".uscis-employer")
}

async function upsertUniversityCompanies(
  pool: Pool,
  seeds: UniversitySeed[],
  existingCompanies: CompanyRow[]
): Promise<{
  companyIds: Set<string>
  inserted: number
  updated: number
  convertedPlaceholderDomain: number
}> {
  const index = buildCompanyIndex(existingCompanies)
  const companyIds = new Set<string>()

  let inserted = 0
  let updated = 0
  let convertedPlaceholderDomain = 0

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]!
    const byDomain = index.byDomain.get(seed.domain)
    const normMatches = index.byNormalized.get(seed.normalized) ?? []
    const logoUrl = companyLogoUrlFromDomain(seed.domain, "google-favicon")

    if (dryRun) {
      if (!byDomain && normMatches.length === 0) inserted++
      else updated++
      continue
    }

    if (byDomain) {
      await pool.query(
        `UPDATE companies
            SET name = $1,
                careers_url = COALESCE(NULLIF(companies.careers_url, ''), $2),
                industry = COALESCE(NULLIF(companies.industry, ''), 'Higher Education'),
                size = COALESCE(NULLIF(companies.size, ''), 'enterprise'),
                logo_url = COALESCE(NULLIF(companies.logo_url, ''), $3),
                is_active = true,
                updated_at = now()
          WHERE id = $4`,
        [seed.name, seed.careers_url, logoUrl, byDomain.id]
      )
      updated++
      companyIds.add(byDomain.id)
    } else if (normMatches.length === 1 && isPlaceholderDomain(normMatches[0]!.domain)) {
      const placeholder = normMatches[0]!
      const domainConflict = index.byDomain.get(seed.domain)
      if (!domainConflict) {
        await pool.query(
          `UPDATE companies
              SET name = $1,
                  domain = $2,
                  careers_url = COALESCE(NULLIF(companies.careers_url, ''), $3),
                  industry = COALESCE(NULLIF(companies.industry, ''), 'Higher Education'),
                  size = COALESCE(NULLIF(companies.size, ''), 'enterprise'),
                  logo_url = COALESCE(NULLIF(companies.logo_url, ''), $4),
                  is_active = true,
                  updated_at = now()
            WHERE id = $5`,
          [seed.name, seed.domain, seed.careers_url, logoUrl, placeholder.id]
        )
        convertedPlaceholderDomain++
        updated++
        companyIds.add(placeholder.id)
        index.byDomain.set(seed.domain, { ...placeholder, domain: seed.domain, name: seed.name })
      } else {
        companyIds.add(domainConflict.id)
      }
    } else {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO companies
           (name, domain, careers_url, logo_url, industry, size, is_active,
            sponsors_h1b, sponsorship_confidence)
         VALUES ($1,$2,$3,$4,'Higher Education','enterprise',true,false,0)
         ON CONFLICT (domain) DO UPDATE SET
           name = EXCLUDED.name,
           careers_url = COALESCE(NULLIF(companies.careers_url, ''), EXCLUDED.careers_url),
           logo_url = COALESCE(NULLIF(companies.logo_url, ''), EXCLUDED.logo_url),
           industry = COALESCE(NULLIF(companies.industry, ''), EXCLUDED.industry),
           size = COALESCE(NULLIF(companies.size, ''), EXCLUDED.size),
           is_active = true,
           updated_at = now()
         RETURNING id, (xmax = 0) AS inserted_flag`,
        [seed.name, seed.domain, seed.careers_url, logoUrl]
      )
      const companyId = result.rows[0]?.id
      const insertedFlag = Boolean((result.rows[0] as { inserted_flag?: boolean } | undefined)?.inserted_flag)
      if (companyId) companyIds.add(companyId)
      if (insertedFlag) inserted++
      else updated++
    }

    if (verbose && (i + 1) % 250 === 0) {
      console.log(`[universities] upsert progress ${i + 1}/${seeds.length}`)
    }
  }

  return { companyIds, inserted, updated, convertedPlaceholderDomain }
}

async function buildUniversityNameToCompanyId(pool: Pool): Promise<Map<string, string>> {
  const rows = await pool.query<CompanyRow>(
    `SELECT id, name, domain
       FROM companies
      WHERE industry = 'Higher Education'
         OR name ~* '(university|college|polytechnic|institute)'`
  )

  const normalizedToIds = new Map<string, Set<string>>()
  for (const row of rows.rows) {
    const norm = normalizeEmployerName(row.name)
    if (!norm) continue
    const set = normalizedToIds.get(norm) ?? new Set<string>()
    set.add(row.id)
    normalizedToIds.set(norm, set)
  }

  const unique = new Map<string, string>()
  for (const [norm, ids] of normalizedToIds) {
    if (ids.size === 1) unique.set(norm, Array.from(ids)[0]!)
  }
  return unique
}

async function linkLcaRecords(
  pool: Pool,
  normalizedToCompanyId: Map<string, string>
): Promise<{ linkedRows: number; touchedCompanyIds: Set<string> }> {
  const res = await pool.query<LcaEmployerRow>(
    `SELECT DISTINCT employer_name_normalized
       FROM lca_records
      WHERE company_id IS NULL
        AND employer_name_normalized IS NOT NULL
        AND employer_name ~* '${UNIVERSITY_SQL_RE}'`
  )

  let linkedRows = 0
  const touchedCompanyIds = new Set<string>()

  for (const row of res.rows) {
    const companyId = normalizedToCompanyId.get(row.employer_name_normalized)
    if (!companyId) continue
    touchedCompanyIds.add(companyId)
    if (dryRun) continue
    const update = await pool.query(
      `UPDATE lca_records
          SET company_id = $1
        WHERE company_id IS NULL
          AND employer_name_normalized = $2`,
      [companyId, row.employer_name_normalized]
    )
    linkedRows += update.rowCount ?? 0
  }

  return { linkedRows, touchedCompanyIds }
}

async function linkEmployerLcaStats(
  pool: Pool,
  normalizedToCompanyId: Map<string, string>
): Promise<{ linkedRows: number; touchedCompanyIds: Set<string> }> {
  const res = await pool.query<EmployerStatsRow>(
    `SELECT employer_name_normalized
       FROM employer_lca_stats
      WHERE company_id IS NULL
        AND employer_name_normalized IS NOT NULL
        AND COALESCE(display_name, employer_name_normalized) ~* '${UNIVERSITY_SQL_RE}'`
  )

  let linkedRows = 0
  const touchedCompanyIds = new Set<string>()

  for (const row of res.rows) {
    const companyId = normalizedToCompanyId.get(row.employer_name_normalized)
    if (!companyId) continue
    touchedCompanyIds.add(companyId)
    if (dryRun) continue
    const update = await pool.query(
      `UPDATE employer_lca_stats
          SET company_id = $1
        WHERE company_id IS NULL
          AND employer_name_normalized = $2`,
      [companyId, row.employer_name_normalized]
    )
    linkedRows += update.rowCount ?? 0
  }

  return { linkedRows, touchedCompanyIds }
}

async function linkH1bRecords(
  pool: Pool,
  normalizedToCompanyId: Map<string, string>
): Promise<{ linkedRows: number; touchedCompanyIds: Set<string> }> {
  const res = await pool.query<H1bEmployerRow>(
    `SELECT DISTINCT employer_name
       FROM h1b_records
      WHERE company_id IS NULL
        AND employer_name IS NOT NULL
        AND employer_name ~* '${UNIVERSITY_SQL_RE}'`
  )

  let linkedRows = 0
  const touchedCompanyIds = new Set<string>()

  for (const row of res.rows) {
    const norm = normalizeEmployerName(row.employer_name)
    if (!norm) continue
    const companyId = normalizedToCompanyId.get(norm)
    if (!companyId) continue
    touchedCompanyIds.add(companyId)
    if (dryRun) continue
    const update = await pool.query(
      `UPDATE h1b_records
          SET company_id = $1
        WHERE company_id IS NULL
          AND employer_name = $2`,
      [companyId, row.employer_name]
    )
    linkedRows += update.rowCount ?? 0
  }

  return { linkedRows, touchedCompanyIds }
}

async function loadUniversityFallbackCandidates(
  pool: Pool,
  knownNormalized: Set<string>
): Promise<Array<{
  normalized: string
  displayName: string
  source: "lca" | "h1b"
  lcaRows: number
  h1bApprovals: number
  h1bNames: Set<string>
}>> {
  const candidates = new Map<
    string,
    {
      normalized: string
      displayName: string
      source: "lca" | "h1b"
      lcaRows: number
      h1bApprovals: number
      h1bNames: Set<string>
    }
  >()

  const lcaRows = await pool.query<{ employer_name: string; employer_name_normalized: string; rows: string }>(
    `SELECT employer_name,
            employer_name_normalized,
            COUNT(*)::text AS rows
       FROM lca_records
      WHERE company_id IS NULL
        AND employer_name_normalized IS NOT NULL
        AND employer_name ~* '${UNIVERSITY_SQL_RE}'
      GROUP BY employer_name, employer_name_normalized`
  )

  for (const row of lcaRows.rows) {
    const norm = row.employer_name_normalized
    if (!norm || knownNormalized.has(norm)) continue
    if (!isHigherEdName(row.employer_name)) continue
    const current = candidates.get(norm) ?? {
      normalized: norm,
      displayName: row.employer_name,
      source: "lca" as const,
      lcaRows: 0,
      h1bApprovals: 0,
      h1bNames: new Set<string>(),
    }
    current.lcaRows += Number(row.rows) || 0
    candidates.set(norm, current)
  }

  const h1bRows = await pool.query<{ employer_name: string; approvals: string }>(
    `SELECT employer_name,
            SUM(COALESCE(approved,0))::text AS approvals
       FROM h1b_records
      WHERE company_id IS NULL
        AND employer_name ~* '${UNIVERSITY_SQL_RE}'
      GROUP BY employer_name`
  )

  for (const row of h1bRows.rows) {
    const display = row.employer_name.trim()
    if (!display) continue
    if (!isHigherEdName(display)) continue
    const norm = normalizeEmployerName(display)
    if (!norm || knownNormalized.has(norm)) continue
    const current = candidates.get(norm) ?? {
      normalized: norm,
      displayName: display,
      source: "h1b" as const,
      lcaRows: 0,
      h1bApprovals: 0,
      h1bNames: new Set<string>(),
    }
    current.h1bApprovals += Number(row.approvals) || 0
    current.h1bNames.add(display)
    candidates.set(norm, current)
  }

  return Array.from(candidates.values()).sort((a, b) => {
    const left = b.lcaRows + b.h1bApprovals * 2
    const right = a.lcaRows + a.h1bApprovals * 2
    return left - right
  })
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

async function seedFallbackUniversities(
  pool: Pool,
  candidates: Array<{
    normalized: string
    displayName: string
    source: "lca" | "h1b"
    lcaRows: number
    h1bApprovals: number
    h1bNames: Set<string>
  }>
): Promise<{ inserted: number; linkedLcaRows: number; linkedH1bRows: number; linkedStatsRows: number; companyIds: Set<string> }> {
  const companyIds = new Set<string>()
  let inserted = 0
  let linkedLcaRows = 0
  let linkedH1bRows = 0
  let linkedStatsRows = 0

  const work = limit ? candidates.slice(0, limit) : candidates

  for (const c of work) {
    const suffix = c.source === "h1b" ? "uscis-employer" : "lca-employer"
    const slug = slugify(c.displayName) || c.normalized.replace(/\s+/g, "-")
    const domain = `${slug}.${suffix}`
    const logoDomainGuess = `${slug.replace(/-/g, "")}.edu`
    const logoUrl = companyLogoUrlFromDomain(logoDomainGuess, "google-favicon")
    const careersUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(c.displayName)}`

    if (dryRun) {
      inserted++
      continue
    }

    const upsert = await pool.query<{ id: string; inserted_flag: boolean }>(
      `INSERT INTO companies
         (name, domain, careers_url, logo_url, industry, size, is_active, ats_type, sponsors_h1b, sponsorship_confidence)
       VALUES ($1,$2,$3,$4,'Higher Education','enterprise',false,NULL,false,0)
       ON CONFLICT (domain) DO UPDATE SET
         name = EXCLUDED.name,
         industry = COALESCE(NULLIF(companies.industry, ''), EXCLUDED.industry),
         size = COALESCE(NULLIF(companies.size, ''), EXCLUDED.size),
         updated_at = now()
       RETURNING id, (xmax = 0) AS inserted_flag`,
      [c.displayName, domain, careersUrl, logoUrl]
    )
    const companyId = upsert.rows[0]?.id
    if (!companyId) continue
    companyIds.add(companyId)
    if (upsert.rows[0]?.inserted_flag) inserted++

    const [lcaRes, statsRes] = await Promise.all([
      pool.query(
        `UPDATE lca_records
            SET company_id = $1
          WHERE company_id IS NULL
            AND employer_name_normalized = $2`,
        [companyId, c.normalized]
      ),
      pool.query(
        `UPDATE employer_lca_stats
            SET company_id = $1
          WHERE company_id IS NULL
            AND employer_name_normalized = $2`,
        [companyId, c.normalized]
      ),
    ])

    let h1bLinkedForCandidate = 0
    for (const employerName of c.h1bNames) {
      const h1bRes = await pool.query(
        `UPDATE h1b_records
            SET company_id = $1
          WHERE company_id IS NULL
            AND employer_name = $2`,
        [companyId, employerName]
      )
      h1bLinkedForCandidate += h1bRes.rowCount ?? 0
    }

    linkedLcaRows += lcaRes.rowCount ?? 0
    linkedH1bRows += h1bLinkedForCandidate
    linkedStatsRows += statsRes.rowCount ?? 0
  }

  return { inserted, linkedLcaRows, linkedH1bRows, linkedStatsRows, companyIds }
}

async function recomputeSponsorshipForCompanies(
  pool: Pool,
  companyIds: Set<string>
): Promise<number> {
  if (companyIds.size === 0) return 0
  if (dryRun) return companyIds.size

  const ids = Array.from(companyIds)
  let updated = 0

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE)
    const uscis = await pool.query<{
      company_id: string
      latest_year: number | null
      approvals_1y: number
      denials_1y: number
    }>(
      `WITH latest AS (
         SELECT company_id, MAX(year) AS latest_year
           FROM h1b_records
          WHERE company_id = ANY($1::uuid[])
          GROUP BY company_id
       )
       SELECT l.company_id,
              l.latest_year,
              COALESCE(SUM(h.approved), 0)::int AS approvals_1y,
              COALESCE(SUM(h.denied), 0)::int AS denials_1y
         FROM latest l
         LEFT JOIN h1b_records h
           ON h.company_id = l.company_id
          AND h.year = l.latest_year
        GROUP BY l.company_id, l.latest_year`,
      [chunk]
    )

    const lca = await pool.query<{
      company_id: string
      total_certified: number
      total_denied: number
      cert_1y: number
      cert_3y: number
    }>(
      `WITH lca_years AS (
         SELECT company_id,
                fiscal_year,
                SUM(
                  CASE
                    WHEN case_status ILIKE '%CERTIFIED%' THEN 1
                    ELSE 0
                  END
                )::int AS cert_count
           FROM lca_records
          WHERE company_id = ANY($1::uuid[])
            AND fiscal_year IS NOT NULL
          GROUP BY company_id, fiscal_year
       ),
       ranked AS (
         SELECT company_id,
                fiscal_year,
                cert_count,
                ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY fiscal_year DESC) AS rn
           FROM lca_years
       ),
       overall AS (
         SELECT company_id,
                SUM(CASE WHEN case_status ILIKE '%CERTIFIED%' THEN 1 ELSE 0 END)::int AS total_certified,
                SUM(CASE WHEN case_status ILIKE '%DENIED%' THEN 1 ELSE 0 END)::int AS total_denied
           FROM lca_records
          WHERE company_id = ANY($1::uuid[])
          GROUP BY company_id
       )
       SELECT o.company_id,
              o.total_certified,
              o.total_denied,
              COALESCE(MAX(CASE WHEN r.rn = 1 THEN r.cert_count END), 0)::int AS cert_1y,
              COALESCE(SUM(CASE WHEN r.rn <= 3 THEN r.cert_count ELSE 0 END), 0)::int AS cert_3y
         FROM overall o
         LEFT JOIN ranked r ON r.company_id = o.company_id
        GROUP BY o.company_id, o.total_certified, o.total_denied`,
      [chunk]
    )

    const uscisByCompany = new Map(uscis.rows.map((r) => [r.company_id, r]))
    const lcaByCompany = new Map(lca.rows.map((r) => [r.company_id, r]))

    for (const companyId of chunk) {
      const u = uscisByCompany.get(companyId)
      const l = lcaByCompany.get(companyId)
      const patch = toCompanyPatchFromSignals(
        u?.approvals_1y ?? 0,
        u?.denials_1y ?? 0,
        l?.cert_1y ?? 0,
        l?.cert_3y ?? 0,
        l?.total_certified ?? 0,
        l?.total_denied ?? 0
      )

      await pool.query(
        `UPDATE companies
            SET sponsors_h1b = $1,
                sponsorship_confidence = $2,
                h1b_sponsor_count_1yr = $3,
                h1b_sponsor_count_3yr = $4,
                updated_at = now()
          WHERE id = $5`,
        [
          patch.sponsors_h1b,
          patch.sponsorship_confidence,
          patch.h1b_sponsor_count_1yr,
          patch.h1b_sponsor_count_3yr,
          companyId,
        ]
      )
      updated++
    }
  }

  return updated
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL (or TARGET_POSTGRES_URL) in env")
  }

  console.log(
    `[seed-universities] mode=${execute ? "EXECUTE" : "dry-run"} source=${sourceUrl}${
      limit ? ` limit=${limit}` : ""
    }`
  )

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  })

  try {
    const universities = await loadSourceUniversities()
    const scopedUniversities = limit ? universities.slice(0, limit) : universities
    console.log(`[seed-universities] source universities (US): ${universities.length.toLocaleString()}`)

    const existingCompanies = await loadCompanies(pool)
    const upsert = await upsertUniversityCompanies(pool, scopedUniversities, existingCompanies)

    const normalizedToCompanyId = await buildUniversityNameToCompanyId(pool)
    const knownNormalized = new Set(normalizedToCompanyId.keys())

    const lcaLink = await linkLcaRecords(pool, normalizedToCompanyId)
    const h1bLink = await linkH1bRecords(pool, normalizedToCompanyId)
    const statsLink = await linkEmployerLcaStats(pool, normalizedToCompanyId)

    const fallbackCandidates = await loadUniversityFallbackCandidates(pool, knownNormalized)
    const fallback = await seedFallbackUniversities(pool, fallbackCandidates)

    const touched = new Set<string>()
    for (const id of upsert.companyIds) touched.add(id)
    for (const id of lcaLink.touchedCompanyIds) touched.add(id)
    for (const id of h1bLink.touchedCompanyIds) touched.add(id)
    for (const id of statsLink.touchedCompanyIds) touched.add(id)
    for (const id of fallback.companyIds) touched.add(id)

    const recomputed = await recomputeSponsorshipForCompanies(pool, touched)

    console.log("")
    console.log("[seed-universities] Summary")
    console.log(`  Universities upserted (source): ${scopedUniversities.length.toLocaleString()}`)
    console.log(`  Inserted companies: ${upsert.inserted.toLocaleString()}`)
    console.log(`  Updated companies: ${upsert.updated.toLocaleString()}`)
    console.log(`  Placeholder domains converted: ${upsert.convertedPlaceholderDomain.toLocaleString()}`)
    console.log(`  Linked lca_records: ${lcaLink.linkedRows.toLocaleString()}`)
    console.log(`  Linked h1b_records: ${h1bLink.linkedRows.toLocaleString()}`)
    console.log(`  Linked employer_lca_stats: ${statsLink.linkedRows.toLocaleString()}`)
    console.log(`  Fallback placeholder companies inserted: ${fallback.inserted.toLocaleString()}`)
    console.log(`  Fallback linked lca_records: ${fallback.linkedLcaRows.toLocaleString()}`)
    console.log(`  Fallback linked h1b_records: ${fallback.linkedH1bRows.toLocaleString()}`)
    console.log(`  Fallback linked employer_lca_stats: ${fallback.linkedStatsRows.toLocaleString()}`)
    console.log(`  Recomputed sponsorship rows: ${recomputed.toLocaleString()}`)
    console.log(`  Distinct touched companies: ${touched.size.toLocaleString()}`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[seed-universities] failed", error)
  process.exit(1)
})

/**
 * Add "known/popular" companies as crawl targets from curated seeds.
 *
 * Safety goals:
 * - DRY RUN by default; pass `--execute` to write.
 * - Never writes `sponsors_h1b` / `sponsorship_confidence`.
 * - Prefers activating/fixing existing rows before inserting new rows.
 * - Promotes placeholder rows (e.g. `*.lca-employer`) to real domains when
 *   there is an unambiguous name match.
 *
 * Usage:
 *   npx tsx scripts/add-known-crawl-companies.ts
 *   npx tsx scripts/add-known-crawl-companies.ts --execute
 *   npx tsx scripts/add-known-crawl-companies.ts --limit=50 --execute
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { detectAtsFromUrl } from '../lib/companies/detect-ats'
import { companyLogoUrlFromDomain } from '../lib/companies/logo-url'
import {
  COMPANY_SEED_ROWS,
  type CompanySize,
  type SeedExtra,
} from './data/company-seeds'

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const execute = process.argv.includes('--execute')
const limit = Number(flag('limit')) || undefined
const reportPath =
  flag('report') ??
  path.join(process.cwd(), 'scripts', 'output', 'known-company-topup-report.json')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env'
  )
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type ExistingCompany = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  logo_url: string | null
  industry: string | null
  size: CompanySize | null
  ats_type: string | null
  ats_identifier: string | null
  is_active: boolean | null
  last_crawled_at: string | null
  raw_ats_config: Record<string, unknown> | null
}

type SeedCompany = {
  name: string
  domain: string
  careers_url: string
  industry: string
  size: CompanySize
  ats_type: string | null
  ats_identifier: string | null
  logo_url: string
}

type WorkSummary = {
  inserted: number
  updatedByDomain: number
  promotedPlaceholderByName: number
  skippedAlreadyGood: number
  skippedAmbiguousName: number
  skippedNonPlaceholderNameMatch: number
  errors: number
}

const LEGAL_SUFFIXES = new Set([
  'INC',
  'INCORPORATED',
  'LLC',
  'L',
  'LTD',
  'LIMITED',
  'CORP',
  'CORPORATION',
  'CO',
  'COMPANY',
  'PLC',
  'LLP',
  'LP',
  'HOLDINGS',
  'HOLDING',
  'GROUP',
])

function normalizeDomain(domain: string | null | undefined): string {
  return (domain ?? '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]!
}

function isPlaceholderDomain(domain: string | null | undefined): boolean {
  const d = normalizeDomain(domain)
  return d.endsWith('.lca-employer') || d.endsWith('.uscis-employer')
}

function isLinkedinFallback(urlLike: string | null | undefined): boolean {
  if (!urlLike) return false
  try {
    const u = new URL(urlLike)
    return u.hostname.toLowerCase().includes('linkedin.com')
  } catch {
    return false
  }
}

function normalizeNameKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !LEGAL_SUFFIXES.has(token))
    .join(' ')
    .trim()
}

function tightNameKey(name: string): string {
  return normalizeNameKey(name).replace(/\s+/g, '')
}

function rowFromTuple(
  row:
    | readonly [string, string, string, string, CompanySize]
    | readonly [string, string, string, string, CompanySize, SeedExtra]
): SeedCompany {
  const name = row[0]
  const domain = normalizeDomain(row[1])
  const careers_url = row[2]
  const industry = row[3]
  const size = row[4]
  const extra: SeedExtra = row.length > 5 ? (row[5] as SeedExtra) : {}
  const detected = detectAtsFromUrl(careers_url)

  return {
    name,
    domain,
    careers_url,
    industry,
    size,
    ats_type: extra.ats_type ?? detected?.atsType ?? 'custom',
    ats_identifier: extra.ats_identifier ?? detected?.atsIdentifier ?? null,
    logo_url: companyLogoUrlFromDomain(domain),
  }
}

function uniqueSeedsByDomain(): SeedCompany[] {
  const map = new Map<string, SeedCompany>()
  for (const row of COMPANY_SEED_ROWS) {
    const seed = rowFromTuple(row)
    if (!seed.domain) continue
    map.set(seed.domain, seed)
  }
  return [...map.values()]
}

async function loadAllCompanies(): Promise<ExistingCompany[]> {
  const out: ExistingCompany[] = []
  const pageSize = 1000
  let offset = 0

  for (;;) {
    const { data, error } = await admin
      .from('companies')
      .select(
        'id, name, domain, careers_url, logo_url, industry, size, ats_type, ats_identifier, is_active, last_crawled_at, raw_ats_config'
      )
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`load companies: ${error.message}`)

    const page = (data ?? []) as ExistingCompany[]
    out.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }

  return out
}

function withTopupMeta(
  row: ExistingCompany | null,
  seed: SeedCompany,
  mode: 'insert' | 'domain_match' | 'promote_placeholder',
  nowIso: string
) {
  const existing = row?.raw_ats_config ?? {}
  const priorMeta =
    (existing['known_seed_topup'] as Record<string, unknown> | undefined) ?? {}

  return {
    ...existing,
    guessed_domain: seed.domain,
    known_seed_topup: {
      ...priorMeta,
      mode,
      synced_at: nowIso,
      seed_name: seed.name,
      seed_domain: seed.domain,
      seed_careers_url: seed.careers_url,
    },
  }
}

function keys<T extends object>(obj: T): string[] {
  return Object.keys(obj)
}

function writeReport(report: unknown): void {
  const abs = path.isAbsolute(reportPath)
    ? reportPath
    : path.join(process.cwd(), reportPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(report, null, 2))
  console.log(`[known-topup] report: ${abs}`)
}

async function main() {
  console.log(
    `\n[known-topup] mode=${execute ? 'EXECUTE' : 'dry-run'}${
      limit ? ` limit=${limit}` : ''
    }\n`
  )

  const nowIso = new Date().toISOString()
  const seedRows = uniqueSeedsByDomain()
  const work = limit ? seedRows.slice(0, limit) : seedRows
  const companies = await loadAllCompanies()

  const byDomain = new Map<string, ExistingCompany>()
  const byNorm = new Map<string, ExistingCompany[]>()
  const byTight = new Map<string, ExistingCompany[]>()

  for (const row of companies) {
    const d = normalizeDomain(row.domain)
    if (d) byDomain.set(d, row)

    const norm = normalizeNameKey(row.name)
    if (norm) byNorm.set(norm, [...(byNorm.get(norm) ?? []), row])

    const tight = tightNameKey(row.name)
    if (tight) byTight.set(tight, [...(byTight.get(tight) ?? []), row])
  }

  const summary: WorkSummary = {
    inserted: 0,
    updatedByDomain: 0,
    promotedPlaceholderByName: 0,
    skippedAlreadyGood: 0,
    skippedAmbiguousName: 0,
    skippedNonPlaceholderNameMatch: 0,
    errors: 0,
  }

  const report = {
    mode: execute ? 'execute' : 'dry-run',
    started_at: nowIso,
    seed_rows_total: seedRows.length,
    evaluated_rows: work.length,
    existing_companies: companies.length,
    summary,
    changed: [] as Array<Record<string, unknown>>,
    skipped: [] as Array<Record<string, unknown>>,
    errors: [] as Array<Record<string, unknown>>,
  }

  for (const seed of work) {
    const direct = byDomain.get(seed.domain)

    if (direct) {
      const patch: Record<string, unknown> = {}

      if (!direct.is_active) {
        patch.is_active = true
        patch.last_crawled_at = null
      }

      if (!direct.careers_url || isLinkedinFallback(direct.careers_url)) {
        patch.careers_url = seed.careers_url
      }

      if (!direct.logo_url) {
        patch.logo_url = seed.logo_url
      }

      if (!direct.industry && seed.industry) {
        patch.industry = seed.industry
      }

      if (!direct.size && seed.size) {
        patch.size = seed.size
      }

      const directAts = (direct.ats_type ?? '').toLowerCase().trim()
      if (!directAts || directAts === 'unknown') {
        patch.ats_type = seed.ats_type ?? 'custom'
      }
      if (!direct.ats_identifier && seed.ats_identifier) {
        patch.ats_identifier = seed.ats_identifier
      }

      if (keys(patch).length === 0) {
        summary.skippedAlreadyGood += 1
        report.skipped.push({
          seed_domain: seed.domain,
          seed_name: seed.name,
          reason: 'already_good_domain_match',
          company_id: direct.id,
          company_name: direct.name,
        })
        continue
      }

      patch.raw_ats_config = withTopupMeta(direct, seed, 'domain_match', nowIso)
      patch.updated_at = nowIso

      if (execute) {
        const { error } = await admin
          .from('companies')
          .update(patch as never)
          .eq('id', direct.id)
        if (error) {
          summary.errors += 1
          report.errors.push({
            action: 'update_domain_match',
            seed_domain: seed.domain,
            company_id: direct.id,
            error: error.message,
          })
          continue
        }
      }

      summary.updatedByDomain += 1
      report.changed.push({
        action: 'update_domain_match',
        company_id: direct.id,
        company_name: direct.name,
        seed_name: seed.name,
        seed_domain: seed.domain,
        patch_fields: keys(patch),
      })
      continue
    }

    const norm = normalizeNameKey(seed.name)
    const tight = tightNameKey(seed.name)
    const nameMatchesMap = new Map<string, ExistingCompany>()
    for (const m of byNorm.get(norm) ?? []) nameMatchesMap.set(m.id, m)
    for (const m of byTight.get(tight) ?? []) nameMatchesMap.set(m.id, m)
    const nameMatches = [...nameMatchesMap.values()]

    if (nameMatches.length > 1) {
      summary.skippedAmbiguousName += 1
      report.skipped.push({
        seed_domain: seed.domain,
        seed_name: seed.name,
        reason: 'ambiguous_name_match',
        candidates: nameMatches.map((m) => ({
          id: m.id,
          name: m.name,
          domain: m.domain,
        })),
      })
      continue
    }

    const only = nameMatches[0] ?? null
    if (only) {
      if (!isPlaceholderDomain(only.domain)) {
        summary.skippedNonPlaceholderNameMatch += 1
        report.skipped.push({
          seed_domain: seed.domain,
          seed_name: seed.name,
          reason: 'name_match_non_placeholder_domain',
          company_id: only.id,
          company_name: only.name,
          company_domain: only.domain,
        })
        continue
      }

      const previousDomain = only.domain
      const patch: Record<string, unknown> = {
        name: seed.name,
        domain: seed.domain,
        careers_url: seed.careers_url,
        logo_url: seed.logo_url,
        industry: only.industry ?? seed.industry,
        size: only.size ?? seed.size,
        ats_type: seed.ats_type ?? only.ats_type ?? 'custom',
        ats_identifier: seed.ats_identifier ?? only.ats_identifier,
        is_active: true,
        last_crawled_at: null,
        raw_ats_config: {
          ...withTopupMeta(only, seed, 'promote_placeholder', nowIso),
          domain_verified: true,
          ats_discovery_status: 'checked',
        },
        updated_at: nowIso,
      }

      if (execute) {
        const { error } = await admin
          .from('companies')
          .update(patch as never)
          .eq('id', only.id)
        if (error) {
          summary.errors += 1
          report.errors.push({
            action: 'promote_placeholder',
            seed_domain: seed.domain,
            company_id: only.id,
            error: error.message,
          })
          continue
        }
      }

      // Keep in-memory index coherent for the rest of this run.
      only.name = seed.name
      only.domain = seed.domain
      only.careers_url = seed.careers_url
      only.logo_url = seed.logo_url
      only.industry = only.industry ?? seed.industry
      only.size = only.size ?? seed.size
      only.ats_type = seed.ats_type ?? only.ats_type
      only.ats_identifier = seed.ats_identifier ?? only.ats_identifier
      only.is_active = true
      only.last_crawled_at = null
      byDomain.set(seed.domain, only)

      summary.promotedPlaceholderByName += 1
      report.changed.push({
        action: 'promote_placeholder',
        company_id: only.id,
        previous_domain: previousDomain,
        seed_domain: seed.domain,
        seed_name: seed.name,
      })
      continue
    }

    const payload = {
      name: seed.name,
      domain: seed.domain,
      careers_url: seed.careers_url,
      logo_url: seed.logo_url,
      industry: seed.industry,
      size: seed.size,
      ats_type: seed.ats_type ?? 'custom',
      ats_identifier: seed.ats_identifier,
      is_active: true,
      last_crawled_at: null as string | null,
      raw_ats_config: {
        source: 'known_seed_topup',
        created_via: 'add_known_crawl_companies',
        created_at: nowIso,
        guessed_domain: seed.domain,
        domain_verified: true,
        ats_discovery_status: 'checked',
        known_seed_topup: {
          mode: 'insert',
          synced_at: nowIso,
          seed_name: seed.name,
          seed_domain: seed.domain,
          seed_careers_url: seed.careers_url,
        },
      },
    }

    if (execute) {
      const { data, error } = await admin
        .from('companies')
        .insert(payload as never)
        .select('id, name, domain')
        .single()
      if (error) {
        summary.errors += 1
        report.errors.push({
          action: 'insert',
          seed_domain: seed.domain,
          seed_name: seed.name,
          error: error.message,
        })
        continue
      }

      if (data) {
        byDomain.set(seed.domain, {
          id: data.id as string,
          name: data.name as string,
          domain: data.domain as string,
          careers_url: seed.careers_url,
          logo_url: seed.logo_url,
          industry: seed.industry,
          size: seed.size,
          ats_type: seed.ats_type ?? 'custom',
          ats_identifier: seed.ats_identifier,
          is_active: true,
          last_crawled_at: null,
          raw_ats_config: payload.raw_ats_config as Record<string, unknown>,
        })
      }
    }

    summary.inserted += 1
    report.changed.push({
      action: 'insert',
      seed_domain: seed.domain,
      seed_name: seed.name,
    })
  }

  console.log(`[known-topup] evaluated: ${work.length.toLocaleString()}`)
  console.log(`[known-topup] inserted: ${summary.inserted.toLocaleString()}`)
  console.log(
    `[known-topup] updated by domain: ${summary.updatedByDomain.toLocaleString()}`
  )
  console.log(
    `[known-topup] promoted placeholders: ${summary.promotedPlaceholderByName.toLocaleString()}`
  )
  console.log(
    `[known-topup] skipped already good: ${summary.skippedAlreadyGood.toLocaleString()}`
  )
  console.log(
    `[known-topup] skipped ambiguous name: ${summary.skippedAmbiguousName.toLocaleString()}`
  )
  console.log(
    `[known-topup] skipped non-placeholder name matches: ${summary.skippedNonPlaceholderNameMatch.toLocaleString()}`
  )
  if (summary.errors > 0) {
    console.log(`[known-topup] errors: ${summary.errors.toLocaleString()}`)
  }

  writeReport(report)

  if (!execute) {
    console.log('\n[known-topup] dry-run only. Re-run with --execute to commit.')
  }
}

main().catch((err) => {
  console.error('[known-topup] failed', err)
  process.exit(1)
})

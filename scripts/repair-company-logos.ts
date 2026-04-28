/**
 * Repair suspicious company logos.
 *
 * Strategy:
 * - Auto-fix only high-confidence rows where we can infer a trusted domain.
 * - Emit a review report for ambiguous rows that need human triage.
 *
 * Domain selection:
 * - Score multiple candidates (current logo domain, companies.domain,
 *   matchedUrl host, verified guessed_domain).
 * - Auto-fix only when a replacement candidate is plausibly better than
 *   the current logo domain by a clear margin.
 *
 * Usage:
 *   npx tsx scripts/repair-company-logos.ts
 *   npx tsx scripts/repair-company-logos.ts --execute
 *   npx tsx scripts/repair-company-logos.ts --limit=200 --execute
 *   npx tsx scripts/repair-company-logos.ts --report=scripts/output/company-logo-review.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { companyLogoUrlFromDomain } from '@/lib/companies/logo-url'
import { isAtsDomain } from '@/lib/companies/ats-domains'

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
  path.join(process.cwd(), 'scripts', 'output', 'company-logo-review.json')

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

type CompanyRow = {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
  is_active: boolean | null
  raw_ats_config: {
    guessed_domain?: string | null
    domain_verified?: boolean
    ats_detection?: {
      matchedUrl?: string | null
    } | null
    [key: string]: unknown
  } | null
}

const LEGAL_SUFFIXES =
  /\b(incorporated|inc|l\.?l\.?c\.?|llp|corp|corporation|ltd|limited|co|company|plc|holdings|group|partners)\b\.?,?/gi

const NAME_STOPWORDS = new Set([
  'the',
  'and',
  'of',
  'for',
  'to',
  'in',
  'at',
  'on',
  'by',
  'us',
  'usa',
  'north',
  'america',
  'americas',
])

const GENERIC_DOMAIN_ROOTS = new Set([
  'university',
  'college',
  'hospital',
  'medical',
  'health',
  'global',
  'international',
  'group',
  'services',
  'solutions',
  'technology',
  'technologies',
  'systems',
  'company',
])

const ROOT_SUFFIX_PENALTIES = ['inc', 'llc', 'corp', 'ltd', 'plc', 'na', 'usa', 'us']

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

function tryHost(urlLike: string | null | undefined): string {
  if (!urlLike) return ''
  try {
    return normalizeDomain(new URL(urlLike).host)
  } catch {
    return ''
  }
}

function parseLogoDomain(logoUrl: string | null): string {
  if (!logoUrl) return ''
  try {
    const u = new URL(logoUrl)
    const host = u.hostname.toLowerCase()
    if (host.includes('google.com')) {
      return normalizeDomain(
        u.searchParams.get('domain') ?? u.searchParams.get('domain_url') ?? ''
      )
    }
    if (host === 'logo.clearbit.com' || host === 'unavatar.io') {
      return normalizeDomain(u.pathname.replace(/^\//, '').split('/')[0] ?? '')
    }
    return normalizeDomain(host)
  } catch {
    return ''
  }
}

function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.,&]/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !NAME_STOPWORDS.has(w))
}

function plausibleDomainForName(name: string, domain: string): boolean {
  const root = normalizeDomain(domain).split('.')[0] ?? ''
  if (!root || root.length < 3) return false
  if (GENERIC_DOMAIN_ROOTS.has(root)) return false

  const tokens = tokenizeName(name)
  const collapsed = tokens.join('')
  for (const t of tokens) {
    if (t.length >= 4 && root.includes(t)) return true
  }
  if (root.length >= 5 && collapsed.includes(root)) return true
  const acronym = tokens.map((t) => t[0]).join('')
  if (root.length >= 4 && root.length <= 8 && acronym === root) return true
  return false
}

type DomainCandidate = {
  domain: string
  source:
    | 'current_logo'
    | 'companies.domain'
    | 'raw_ats_config.ats_detection.matchedUrl'
    | 'raw_ats_config.guessed_domain'
  score: number
  plausible: boolean
  generic: boolean
}

function domainScore(name: string, domain: string): DomainCandidate['score'] {
  const normalized = normalizeDomain(domain)
  if (!normalized || isPlaceholderDomain(normalized) || isAtsDomain(normalized)) return -100
  const [root, tld] = normalized.split('.')
  if (!root) return -100

  const generic = GENERIC_DOMAIN_ROOTS.has(root)
  const tokens = tokenizeName(name)
  const matches = tokens.filter((t) => t.length >= 4 && root.includes(t)).length
  const plausible = plausibleDomainForName(name, normalized)

  let score = 0
  score += matches * 5
  score += Math.min(root.length, 16) / 4
  if (tokens[0] && root === tokens[0]) score += 2
  if (tokens[0] && root.startsWith(tokens[0])) score += 1
  if (ROOT_SUFFIX_PENALTIES.some((sfx) => root.endsWith(sfx))) score -= 2
  if (tld === 'com') score += 2
  else if (['org', 'edu', 'io', 'ai', 'co'].includes(tld ?? '')) score += 1
  if (generic) score -= 10
  if (plausible) score += 3
  else score -= 4
  return score
}

function buildCandidates(row: CompanyRow): DomainCandidate[] {
  const seen = new Set<string>()
  const out: DomainCandidate[] = []
  const add = (raw: string | null | undefined, source: DomainCandidate['source']) => {
    const d = normalizeDomain(raw)
    if (!d || seen.has(d) || isPlaceholderDomain(d) || isAtsDomain(d)) return
    seen.add(d)
    const root = d.split('.')[0] ?? ''
    out.push({
      domain: d,
      source,
      score: domainScore(row.name, d),
      plausible: plausibleDomainForName(row.name, d),
      generic: GENERIC_DOMAIN_ROOTS.has(root),
    })
  }

  add(parseLogoDomain(row.logo_url), 'current_logo')
  add(row.domain, 'companies.domain')
  add(tryHost(row.raw_ats_config?.ats_detection?.matchedUrl ?? null), 'raw_ats_config.ats_detection.matchedUrl')
  if (row.raw_ats_config?.domain_verified === true) {
    add(row.raw_ats_config?.guessed_domain ?? null, 'raw_ats_config.guessed_domain')
  }
  return out
}

async function loadActiveCompanies(): Promise<CompanyRow[]> {
  const out: CompanyRow[] = []
  let from = 0
  const page = 1000
  for (;;) {
    const { data, error } = await admin
      .from('companies')
      .select('id, name, domain, logo_url, is_active, raw_ats_config')
      .eq('is_active', true)
      .range(from, from + page - 1)
    if (error) throw new Error(`load companies: ${error.message}`)
    const rows = (data ?? []) as CompanyRow[]
    out.push(...rows)
    if (rows.length < page) break
    from += page
  }
  return out
}

type FixCandidate = {
  id: string
  name: string
  current_logo_domain: string
  trusted_domain: string
  trusted_source: string
  current_score: number
  trusted_score: number
  next_logo_url: string
}

type ReviewRow = {
  id: string
  name: string
  current_domain: string
  current_logo_domain: string
  trusted_domain: string | null
  trusted_source: string | null
  reasons: string[]
}

function writeReport(payload: unknown): void {
  const abs = path.isAbsolute(reportPath)
    ? reportPath
    : path.join(process.cwd(), reportPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2))
  console.log(`Report written: ${abs}`)
}

async function main() {
  console.log(`\n[logos] mode=${execute ? 'EXECUTE' : 'dry-run'}${limit ? ` limit=${limit}` : ''}`)
  const rows = await loadActiveCompanies()
  console.log(`[logos] active companies: ${rows.length.toLocaleString()}`)

  const fixCandidates: FixCandidate[] = []
  const reviewRows: ReviewRow[] = []

  for (const row of rows) {
    const currentDomain = normalizeDomain(row.domain)
    const currentLogoDomain = parseLogoDomain(row.logo_url)
    const reasons: string[] = []
    const candidates = buildCandidates(row).sort((a, b) => b.score - a.score)
    const currentCandidate =
      candidates.find((c) => c.source === 'current_logo') ??
      ({
        domain: currentLogoDomain,
        source: 'current_logo',
        score: currentLogoDomain ? domainScore(row.name, currentLogoDomain) : -100,
        plausible: currentLogoDomain
          ? plausibleDomainForName(row.name, currentLogoDomain)
          : false,
        generic: currentLogoDomain
          ? GENERIC_DOMAIN_ROOTS.has(currentLogoDomain.split('.')[0] ?? '')
          : false,
      } as DomainCandidate)
    const best = candidates[0] ?? null

    if (!currentLogoDomain) reasons.push('missing_logo_domain')
    if (currentLogoDomain) {
      const root = currentLogoDomain.split('.')[0] ?? ''
      if (GENERIC_DOMAIN_ROOTS.has(root)) reasons.push('generic_logo_domain')
      if (!plausibleDomainForName(row.name, currentLogoDomain)) {
        reasons.push('name_domain_implausible')
      }
    }

    const canAutoFix =
      best &&
      best.source !== 'current_logo' &&
      best.plausible &&
      !best.generic &&
      (currentCandidate.score <= -20 || best.score >= currentCandidate.score + 2)

    if (canAutoFix && currentLogoDomain !== best.domain) {
      fixCandidates.push({
        id: row.id,
        name: row.name,
        current_logo_domain: currentLogoDomain,
        trusted_domain: best.domain,
        trusted_source: best.source,
        current_score: currentCandidate.score,
        trusted_score: best.score,
        next_logo_url: companyLogoUrlFromDomain(best.domain),
      })
      continue
    }

    if (
      currentLogoDomain &&
      best &&
      best.domain !== currentLogoDomain &&
      best.plausible &&
      !best.generic &&
      best.score > currentCandidate.score
    ) {
      reasons.push('low_confidence_domain_change')
    }

    if (reasons.length > 0) {
      reviewRows.push({
        id: row.id,
        name: row.name,
        current_domain: currentDomain,
        current_logo_domain: currentLogoDomain,
        trusted_domain: best?.domain ?? null,
        trusted_source: best?.source ?? null,
        reasons,
      })
    }
  }

  const fixes = limit ? fixCandidates.slice(0, limit) : fixCandidates

  console.log(`[logos] high-confidence fixes: ${fixes.length.toLocaleString()}`)
  console.log(`[logos] manual-review rows:   ${reviewRows.length.toLocaleString()}`)

  for (const row of fixes.slice(0, 25)) {
    console.log(
      `  fix ${row.name.slice(0, 42).padEnd(42)} ${row.current_logo_domain || '-'} -> ${row.trusted_domain} (${row.trusted_source})`
    )
  }

  if (execute) {
    for (const row of fixes) {
      const { error } = await admin
        .from('companies')
        .update({
          logo_url: row.next_logo_url,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', row.id)
      if (error) throw new Error(`logo update ${row.id}: ${error.message}`)
    }
  }

  writeReport({
    generated_at: new Date().toISOString(),
    mode: execute ? 'execute' : 'dry-run',
    active_companies: rows.length,
    high_confidence_fixes: fixes,
    manual_review: reviewRows,
  })

  console.log(
    `\n[logos] ${execute ? 'updated' : 'would update'} ${fixes.length.toLocaleString()} row(s).\n`
  )
}

main().catch((err) => {
  console.error('\nrepair-company-logos failed:', err)
  process.exit(1)
})

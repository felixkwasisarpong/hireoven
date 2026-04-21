/**
 * Merge obvious duplicate company rows and re-link dependents.
 *
 * Why this exists:
 * - Placeholder enrichment historically stored verified domains in
 *   `raw_ats_config.guessed_domain` but left `companies.domain` as
 *   `*.lca-employer` / `*.uscis-employer`.
 * - That allowed multiple active rows for the same real company/domain.
 *
 * Safety model (conservative):
 * - Only considers active companies.
 * - Only considers rows with a derived "effective domain".
 * - Only merges rows inside the same effective-domain bucket where names
 *   are highly similar (token Jaccard >= 0.67).
 *
 * Re-linked tables:
 * - jobs.company_id
 * - watchlist.company_id (with duplicate user/company guard)
 * - crawl_logs.company_id
 * - h1b_records.company_id
 * - lca_records.company_id
 * - employer_lca_stats.company_id
 * - job_alerts.company_ids (UUID array)
 *
 * Usage:
 *   npx tsx scripts/dedupe-companies.ts
 *   npx tsx scripts/dedupe-companies.ts --execute
 *   npx tsx scripts/dedupe-companies.ts --limit=10 --execute
 *   npx tsx scripts/dedupe-companies.ts --verbose
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { companyLogoUrlFromDomain } from '@/lib/companies/logo-url'

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
const verbose = process.argv.includes('--verbose')
const limit = Number(flag('limit')) || undefined
const reportPath =
  flag('report') ??
  path.join(process.cwd(), 'scripts', 'output', 'company-dedupe-report.json')

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
  careers_url: string | null
  ats_type: string | null
  is_active: boolean | null
  created_at: string | null
  updated_at: string | null
  raw_ats_config: {
    source?: string
    guessed_domain?: string | null
    domain_verified?: boolean
    ats_detection?: {
      matchedUrl?: string | null
      confidence?: string | null
    } | null
    [key: string]: unknown
  } | null
}

type RefCounts = {
  jobs: number
  watchlist: number
  crawl_logs: number
  h1b_records: number
  lca_records: number
  employer_lca_stats: number
}

type MergeCluster = {
  effectiveDomain: string
  members: CompanyRow[]
}

type MergePlan = {
  effectiveDomain: string
  winner: CompanyRow
  losers: CompanyRow[]
  memberIds: string[]
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

const REF_CHUNK = 150

function isPlaceholderDomain(domain: string | null | undefined): boolean {
  const d = normalizeDomain(domain)
  return d.endsWith('.lca-employer') || d.endsWith('.uscis-employer')
}

function normalizeDomain(domain: string | null | undefined): string {
  return (domain ?? '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]!
}

function tryHost(urlLike: string | null | undefined): string {
  if (!urlLike) return ''
  try {
    return normalizeDomain(new URL(urlLike).host)
  } catch {
    return ''
  }
}

function effectiveDomain(row: CompanyRow): string {
  const matched = tryHost(row.raw_ats_config?.ats_detection?.matchedUrl ?? null)
  if (matched) return matched

  const guessed = normalizeDomain(row.raw_ats_config?.guessed_domain ?? null)
  if (guessed && !isPlaceholderDomain(guessed)) return guessed

  const domain = normalizeDomain(row.domain)
  if (domain && !isPlaceholderDomain(domain)) return domain
  return ''
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

function normalizeCareersUrl(urlLike: string | null | undefined): string {
  if (!urlLike) return ''
  try {
    const u = new URL(urlLike)
    const host = normalizeDomain(u.host)
    const pathname = (u.pathname || '/').replace(/\/+$/, '') || '/'
    return `${host}${pathname}`.toLowerCase()
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

function tokenJaccard(a: string[], b: string[]): number {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size === 0 || sb.size === 0) return 0
  let intersection = 0
  for (const x of sa) {
    if (sb.has(x)) intersection += 1
  }
  const union = new Set<string>([...sa, ...sb]).size
  return union === 0 ? 0 : intersection / union
}

function namesSimilar(a: string, b: string): boolean {
  const ta = tokenizeName(a)
  const tb = tokenizeName(b)
  const jac = tokenJaccard(ta, tb)
  if (jac >= 0.67) return true

  // Guarded prefix-ish fallback (e.g. "JPMORGAN CHASE" vs
  // "JPMORGAN CHASE AND").
  const aa = ta.join(' ')
  const bb = tb.join(' ')
  if (!aa || !bb) return false
  const shorter = aa.length <= bb.length ? aa : bb
  const longer = aa.length <= bb.length ? bb : aa
  return shorter.length >= 8 && longer.includes(shorter)
}

function shouldForceMergeByCanonicalSignals(
  a: CompanyRow,
  b: CompanyRow,
  domain: string
): boolean {
  const atsA = (a.ats_type ?? '').toLowerCase().trim()
  const atsB = (b.ats_type ?? '').toLowerCase().trim()
  if (!atsA || !atsB || atsA !== atsB) return false
  if (atsA === 'custom') return false

  const careersA = normalizeCareersUrl(a.careers_url)
  const careersB = normalizeCareersUrl(b.careers_url)
  if (!careersA || !careersB || careersA !== careersB) return false

  // Keep this strict: exactly one canonical row + one placeholder sibling.
  // This captures Visa-style legal-entity duplicates while avoiding broad
  // over-merges where both rows are still unresolved placeholders.
  const aIsCanonical = normalizeDomain(a.domain) === domain
  const bIsCanonical = normalizeDomain(b.domain) === domain
  const aIsPlaceholder = isPlaceholderDomain(a.domain)
  const bIsPlaceholder = isPlaceholderDomain(b.domain)
  if (aIsCanonical && bIsPlaceholder) return true
  if (bIsCanonical && aIsPlaceholder) return true
  return false
}

function withEmptyRefCounts(): RefCounts {
  return {
    jobs: 0,
    watchlist: 0,
    crawl_logs: 0,
    h1b_records: 0,
    lca_records: 0,
    employer_lca_stats: 0,
  }
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < attempts) {
        const ms = 500 * Math.pow(2, attempt - 1)
        console.warn(
          `  ${label}: attempt ${attempt}/${attempts} failed; retrying in ${ms}ms`
        )
        await new Promise((r) => setTimeout(r, ms))
      }
    }
  }
  throw new Error(
    `${label}: failed after ${attempts} attempts (${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    })`
  )
}

async function fetchActiveCompanies(): Promise<CompanyRow[]> {
  const out: CompanyRow[] = []
  let from = 0
  const page = 1000
  for (;;) {
    const { data, error } = await admin
      .from('companies')
      .select(
        'id, name, domain, logo_url, careers_url, ats_type, is_active, created_at, updated_at, raw_ats_config'
      )
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

function buildDuplicateClusters(rows: CompanyRow[]): MergeCluster[] {
  const byDomain = new Map<string, CompanyRow[]>()
  for (const row of rows) {
    const d = effectiveDomain(row)
    if (!d) continue
    const arr = byDomain.get(d) ?? []
    arr.push(row)
    byDomain.set(d, arr)
  }

  const clusters: MergeCluster[] = []

  for (const [domain, bucket] of byDomain.entries()) {
    if (bucket.length < 2) continue
    const root = domain.split('.')[0] ?? ''
    if (!root || GENERIC_DOMAIN_ROOTS.has(root)) continue

    // Build connected components by similarity.
    const visited = new Set<string>()
    const byId = new Map(bucket.map((r) => [r.id, r]))

    for (const seed of bucket) {
      if (visited.has(seed.id)) continue
      const component: CompanyRow[] = []
      const queue: CompanyRow[] = [seed]
      visited.add(seed.id)

      while (queue.length > 0) {
        const cur = queue.shift()!
        component.push(cur)
        for (const other of bucket) {
          if (visited.has(other.id)) continue
          if (!byId.has(other.id)) continue
          if (
            namesSimilar(cur.name, other.name) ||
            shouldForceMergeByCanonicalSignals(cur, other, domain)
          ) {
            visited.add(other.id)
            queue.push(other)
          }
        }
      }

      if (component.length > 1) {
        clusters.push({
          effectiveDomain: domain,
          members: component,
        })
      }
    }
  }

  clusters.sort((a, b) => b.members.length - a.members.length)
  return limit ? clusters.slice(0, limit) : clusters
}

async function aggregateCounts(
  table: 'jobs' | 'watchlist' | 'crawl_logs' | 'h1b_records' | 'lca_records' | 'employer_lca_stats',
  ids: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < ids.length; i += REF_CHUNK) {
    const chunk = ids.slice(i, i + REF_CHUNK)
    const { data, error } = await withRetry(`${table} chunk ${i}`, () =>
      admin.from(table).select('company_id').in('company_id', chunk)
    )
    if (error) throw new Error(`${table}: ${error.message}`)
    for (const row of (data ?? []) as Array<{ company_id: string | null }>) {
      if (!row.company_id) continue
      out.set(row.company_id, (out.get(row.company_id) ?? 0) + 1)
    }
  }
  return out
}

function chooseWinner(
  members: CompanyRow[],
  refs: Map<string, RefCounts>,
  effectiveDomain: string
): CompanyRow {
  const sorted = [...members].sort((a, b) => {
    const ra = refs.get(a.id) ?? withEmptyRefCounts()
    const rb = refs.get(b.id) ?? withEmptyRefCounts()
    const aDomain = normalizeDomain(a.domain)
    const bDomain = normalizeDomain(b.domain)
    const aCanonical = aDomain === effectiveDomain
    const bCanonical = bDomain === effectiveDomain
    const aPlaceholder = isPlaceholderDomain(a.domain)
    const bPlaceholder = isPlaceholderDomain(b.domain)

    const scoreA =
      // Prefer the canonical real-domain row over legal-entity placeholders;
      // references are re-linked, so winner does not need to carry legacy IDs.
      (aCanonical ? 2_000_000 : 0) +
      (aPlaceholder ? -250_000 : 0) +
      ra.jobs * 1_000_000 +
      ra.watchlist * 100_000 +
      ra.crawl_logs * 10_000 +
      ra.h1b_records * 50 +
      ra.lca_records * 10 +
      ra.employer_lca_stats * 1000 +
      (a.ats_type ? 100 : 0) +
      (a.careers_url && !a.careers_url.includes('linkedin.com') ? 50 : 0) +
      (a.logo_url ? 25 : 0)

    const scoreB =
      (bCanonical ? 2_000_000 : 0) +
      (bPlaceholder ? -250_000 : 0) +
      rb.jobs * 1_000_000 +
      rb.watchlist * 100_000 +
      rb.crawl_logs * 10_000 +
      rb.h1b_records * 50 +
      rb.lca_records * 10 +
      rb.employer_lca_stats * 1000 +
      (b.ats_type ? 100 : 0) +
      (b.careers_url && !b.careers_url.includes('linkedin.com') ? 50 : 0) +
      (b.logo_url ? 25 : 0)

    if (scoreB !== scoreA) return scoreB - scoreA
    return (a.created_at ?? '').localeCompare(b.created_at ?? '')
  })
  return sorted[0]!
}

function makeMergePlans(
  clusters: MergeCluster[],
  refs: Map<string, RefCounts>
): MergePlan[] {
  const plans: MergePlan[] = []
  for (const cluster of clusters) {
    const winner = chooseWinner(cluster.members, refs, cluster.effectiveDomain)
    const losers = cluster.members.filter((m) => m.id !== winner.id)
    if (losers.length === 0) continue
    plans.push({
      effectiveDomain: cluster.effectiveDomain,
      winner,
      losers,
      memberIds: cluster.members.map((m) => m.id),
    })
  }
  return plans
}

async function updateRefsSingleLoser(
  loserId: string,
  winnerId: string
): Promise<void> {
  const directTables: Array<'jobs' | 'crawl_logs'> = ['jobs', 'crawl_logs']
  for (const table of directTables) {
    const { error } = await withRetry(`relink ${table} ${loserId}`, () =>
      admin.from(table).update({ company_id: winnerId }).eq('company_id', loserId)
    )
    if (error) throw new Error(`relink ${table}: ${error.message}`)
  }

  // Heavy tables can timeout on a single giant UPDATE ... WHERE company_id=...
  // Use batched id-based rewrites instead.
  const heavyTables: Array<'h1b_records' | 'lca_records' | 'employer_lca_stats'> = [
    'h1b_records',
    'lca_records',
    'employer_lca_stats',
  ]
  for (const table of heavyTables) {
    await relinkTableByIds(table, loserId, winnerId)
  }
}

async function relinkTableByIds(
  table: 'h1b_records' | 'lca_records' | 'employer_lca_stats',
  loserId: string,
  winnerId: string
): Promise<void> {
  const BATCH = 500
  for (;;) {
    const { data, error } = await withRetry(`load ${table} ids ${loserId}`, () =>
      admin
        .from(table)
        .select('id')
        .eq('company_id', loserId)
        .limit(BATCH)
    )
    if (error) throw new Error(`load ${table} ids: ${error.message}`)
    const ids = (data ?? []).map((r) => (r as { id: string }).id).filter(Boolean)
    if (ids.length === 0) break

    const { error: updErr } = await withRetry(`relink ${table} ids ${loserId}`, () =>
      admin
        .from(table)
        .update({ company_id: winnerId })
        .in('id', ids)
    )
    if (updErr) throw new Error(`relink ${table}: ${updErr.message}`)
  }
}

async function mergeWatchlist(loserId: string, winnerId: string): Promise<void> {
  const { data, error } = await withRetry(`load watchlist ${loserId}`, () =>
    admin
      .from('watchlist')
      .select('id, user_id, company_id')
      .in('company_id', [loserId, winnerId])
  )
  if (error) throw new Error(`watchlist load: ${error.message}`)
  const rows = (data ?? []) as Array<{
    id: string
    user_id: string
    company_id: string
  }>

  const usersWithWinner = new Set(
    rows.filter((r) => r.company_id === winnerId).map((r) => r.user_id)
  )
  const loserRows = rows.filter((r) => r.company_id === loserId)
  const deleteIds = loserRows
    .filter((r) => usersWithWinner.has(r.user_id))
    .map((r) => r.id)

  if (deleteIds.length > 0) {
    const { error: delErr } = await withRetry(
      `delete dup watchlist ${loserId}`,
      () => admin.from('watchlist').delete().in('id', deleteIds)
    )
    if (delErr) throw new Error(`watchlist dedupe delete: ${delErr.message}`)
  }

  const { error: updErr } = await withRetry(`relink watchlist ${loserId}`, () =>
    admin
      .from('watchlist')
      .update({ company_id: winnerId })
      .eq('company_id', loserId)
  )
  if (updErr) throw new Error(`watchlist relink: ${updErr.message}`)
}

async function rewriteJobAlertsArrays(
  loserId: string,
  winnerId: string
): Promise<number> {
  const { data, error } = await withRetry(`load job_alerts ${loserId}`, () =>
    (admin
      .from('job_alerts')
      .select('id, company_ids')
      .contains('company_ids', [loserId]) as unknown as Promise<{
      data: Array<{ id: string; company_ids: string[] | null }> | null
      error: { message: string } | null
    }>)
  )
  if (error) throw new Error(`job_alerts load: ${error.message}`)
  const rows = data ?? []
  let touched = 0

  for (const row of rows) {
    const ids = row.company_ids ?? []
    if (!ids.includes(loserId)) continue
    const rewritten = Array.from(
      new Set(ids.map((id) => (id === loserId ? winnerId : id)))
    )
    const { error: updErr } = await withRetry(`update job_alert ${row.id}`, () =>
      admin.from('job_alerts').update({ company_ids: rewritten }).eq('id', row.id)
    )
    if (updErr) throw new Error(`job_alerts update: ${updErr.message}`)
    touched += 1
  }
  return touched
}

function isPlausibleDomainForName(name: string, domain: string): boolean {
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

async function maybeUpdateWinner(
  plan: MergePlan,
  allRowsById: Map<string, CompanyRow>
): Promise<void> {
  const winner = plan.winner
  const effective = plan.effectiveDomain
  const allMembers = plan.memberIds
    .map((id) => allRowsById.get(id))
    .filter(Boolean) as CompanyRow[]

  const bestCareers =
    allMembers.find((r) => r.careers_url && !r.careers_url.includes('linkedin.com'))
      ?.careers_url ?? winner.careers_url
  const bestAts = allMembers.find((r) => r.ats_type)?.ats_type ?? winner.ats_type

  const domainPatch =
    effective &&
    isPlausibleDomainForName(winner.name, effective) &&
    isPlaceholderDomain(winner.domain)
      ? effective
      : null

  const patch: Record<string, unknown> = {
    careers_url: bestCareers,
    ats_type: bestAts,
    updated_at: new Date().toISOString(),
  }

  if (domainPatch) {
    patch.domain = domainPatch
    patch.logo_url = companyLogoUrlFromDomain(domainPatch)
  } else if (
    isPlausibleDomainForName(winner.name, effective) &&
    parseLogoDomain(winner.logo_url) !== effective
  ) {
    patch.logo_url = companyLogoUrlFromDomain(effective)
  }

  patch.raw_ats_config = {
    ...(winner.raw_ats_config ?? {}),
    guessed_domain: effective || (winner.raw_ats_config?.guessed_domain ?? null),
    domain_verified: Boolean(effective),
    dedupe_merged_from: plan.losers.map((l) => l.id),
    dedupe_merged_at: new Date().toISOString(),
  }

  const { error } = await withRetry(`update winner ${winner.id}`, () =>
    admin.from('companies').update(patch as never).eq('id', winner.id)
  )

  if (error?.message && /duplicate|unique|23505/i.test(error.message) && domainPatch) {
    // Domain conflict with a non-merged row: keep winner but skip domain write.
    const conflictSafePatch: Record<string, unknown> = {
      ...patch,
      domain: winner.domain,
      raw_ats_config: {
        ...(winner.raw_ats_config ?? {}),
        dedupe_domain_conflict: domainPatch,
        dedupe_merged_from: plan.losers.map((l) => l.id),
        dedupe_merged_at: new Date().toISOString(),
      },
    }
    const { error: retryErr } = await withRetry(
      `update winner (conflict-safe) ${winner.id}`,
      () => admin.from('companies').update(conflictSafePatch as never).eq('id', winner.id)
    )
    if (retryErr) {
      throw new Error(`winner update conflict-safe failed: ${retryErr.message}`)
    }
    return
  }

  if (error) throw new Error(`winner update failed: ${error.message}`)
}

async function deleteLosers(loserIds: string[]): Promise<number> {
  if (loserIds.length === 0) return 0
  let deleted = 0
  const chunk = 200
  for (let i = 0; i < loserIds.length; i += chunk) {
    const ids = loserIds.slice(i, i + chunk)
    const { error, count } = await withRetry(`delete losers ${i}`, () =>
      admin.from('companies').delete({ count: 'exact' }).in('id', ids)
    )
    if (error) throw new Error(`delete losers: ${error.message}`)
    deleted += count ?? ids.length
  }
  return deleted
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
  console.log(
    `\n[dedupe] mode=${execute ? 'EXECUTE' : 'dry-run'}${limit ? ` limit=${limit}` : ''}\n`
  )

  const active = await fetchActiveCompanies()
  console.log(`[dedupe] active companies: ${active.length.toLocaleString()}`)

  const clusters = buildDuplicateClusters(active)
  console.log(`[dedupe] duplicate clusters found: ${clusters.length.toLocaleString()}`)

  if (clusters.length === 0) {
    writeReport({
      generated_at: new Date().toISOString(),
      mode: execute ? 'execute' : 'dry-run',
      active_companies: active.length,
      clusters: [],
      plans: [],
      executed: false,
    })
    console.log('[dedupe] nothing to merge.')
    return
  }

  const candidateIds = Array.from(new Set(clusters.flatMap((c) => c.members.map((m) => m.id))))
  const [jobs, watchlist, crawl, h1b, lca, stats] = await Promise.all([
    aggregateCounts('jobs', candidateIds),
    aggregateCounts('watchlist', candidateIds),
    aggregateCounts('crawl_logs', candidateIds),
    aggregateCounts('h1b_records', candidateIds),
    aggregateCounts('lca_records', candidateIds),
    aggregateCounts('employer_lca_stats', candidateIds),
  ])

  const refs = new Map<string, RefCounts>()
  for (const id of candidateIds) {
    refs.set(id, {
      jobs: jobs.get(id) ?? 0,
      watchlist: watchlist.get(id) ?? 0,
      crawl_logs: crawl.get(id) ?? 0,
      h1b_records: h1b.get(id) ?? 0,
      lca_records: lca.get(id) ?? 0,
      employer_lca_stats: stats.get(id) ?? 0,
    })
  }

  const plans = makeMergePlans(clusters, refs)
  const allRowsById = new Map(active.map((r) => [r.id, r]))

  const preview = plans.map((p) => ({
    effective_domain: p.effectiveDomain,
    winner: {
      id: p.winner.id,
      name: p.winner.name,
      domain: p.winner.domain,
      refs: refs.get(p.winner.id) ?? withEmptyRefCounts(),
    },
    losers: p.losers.map((l) => ({
      id: l.id,
      name: l.name,
      domain: l.domain,
      refs: refs.get(l.id) ?? withEmptyRefCounts(),
    })),
  }))

  console.log(
    `[dedupe] merge plans: ${plans.length.toLocaleString()}  companies to delete: ${plans.reduce(
      (n, p) => n + p.losers.length,
      0
    ).toLocaleString()}`
  )
  for (const p of preview.slice(0, 20)) {
    console.log(
      `  ${p.effective_domain} -> keep ${p.winner.name} (${p.winner.id}) / drop ${p.losers.length}`
    )
    if (verbose) {
      for (const l of p.losers) {
        console.log(`      drop ${l.name} (${l.id})`)
      }
    }
  }

  if (!execute) {
    writeReport({
      generated_at: new Date().toISOString(),
      mode: 'dry-run',
      active_companies: active.length,
      clusters: clusters.map((c) => ({
        effective_domain: c.effectiveDomain,
        size: c.members.length,
        members: c.members.map((m) => ({ id: m.id, name: m.name, domain: m.domain })),
      })),
      plans: preview,
      executed: false,
    })
    console.log('\n[dedupe] dry-run complete. Re-run with --execute.\n')
    return
  }

  let relinkedLosers = 0
  let touchedAlerts = 0
  const deletedLosers: string[] = []

  for (const plan of plans) {
    for (const loser of plan.losers) {
      await mergeWatchlist(loser.id, plan.winner.id)
      await updateRefsSingleLoser(loser.id, plan.winner.id)
      touchedAlerts += await rewriteJobAlertsArrays(loser.id, plan.winner.id)
      relinkedLosers += 1
      deletedLosers.push(loser.id)
    }
    await maybeUpdateWinner(plan, allRowsById)
  }

  const deleted = await deleteLosers(deletedLosers)

  writeReport({
    generated_at: new Date().toISOString(),
    mode: 'execute',
    active_companies: active.length,
    plans: preview,
    executed: true,
    relinked_losers: relinkedLosers,
    deleted_companies: deleted,
    touched_job_alert_rows: touchedAlerts,
  })

  console.log('\n[dedupe] done.')
  console.log(`[dedupe] relinked losers: ${relinkedLosers}`)
  console.log(`[dedupe] deleted companies: ${deleted}`)
  console.log(`[dedupe] job_alert rows updated: ${touchedAlerts}\n`)
}

main().catch((err) => {
  console.error('\ndedupe-companies failed:', err)
  process.exit(1)
})

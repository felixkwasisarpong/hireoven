/**
 * Targeted company cleanup for logos, duplicate merges, and H1B/LCA relinks.
 *
 * Usage:
 *   npx tsx scripts/fix-target-company-issues.ts
 *   npx tsx scripts/fix-target-company-issues.ts --execute
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { companyLogoUrlFromDomain } from '@/lib/companies/logo-url'

loadEnvConfig(process.cwd())

const execute = process.argv.includes('--execute')

const reportPath = path.join(process.cwd(), 'scripts', 'output', 'company-targeted-fix-report.json')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
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
    ats_detection?: { matchedUrl?: string | null } | null
    [key: string]: unknown
  } | null
}

type MergePair = { winnerName: string; loserName: string }

type AliasRelink = {
  employerName: string
  companyName: string
}

const MERGE_PAIRS: MergePair[] = [
  { winnerName: 'Capital One', loserName: 'Capital One Services, LLC' },
  { winnerName: 'Cisco', loserName: 'Cisco Systems, Inc.' },
  { winnerName: 'AT&T', loserName: 'AT AND T SERVICES INC' },
  { winnerName: 'Uber', loserName: 'Uber Technologies, Inc.' },
  { winnerName: 'Bank of America', loserName: 'BANK OF AMERICA NA' },
  { winnerName: 'Micron', loserName: 'Micron Technology, Inc.' },
  { winnerName: 'T-Mobile', loserName: 'T-Mobile USA, Inc.' },
  { winnerName: 'TEXAS A&M UNIVERSITY', loserName: 'TEXAS A AND M UNIVERSITY' },
  { winnerName: 'Ernst & Young U.S. LLP', loserName: 'ERNST AND YOUNG U S LLP' },
  { winnerName: 'BURNS & MCDONNELL ENGINEERING COMPANY, INC.', loserName: 'BURNS AND MCDONNELL ENGINEERING COMPANY INC' },
  { winnerName: 'OpenAI', loserName: 'OpenAI OpCo, LLC' },
  { winnerName: 'IQVIA Inc.', loserName: 'IQVIA RDS Inc.' },
]

const MANUAL_H1B_RELINKS: AliasRelink[] = [
  { employerName: 'EXPEDIA INC', companyName: 'Expedia Group' },
  { employerName: 'ANTHROPIC PBC', companyName: 'Anthropic' },
  { employerName: 'AMERICAN EXPRESS COMPANY', companyName: 'AMERICAN EXPRESS TRAVEL RELATED' },
  { employerName: 'IQVIA CSMS US INC', companyName: 'IQVIA Inc.' },
]

const LOGO_TARGETS = [
  'Hugging Face',
  'Boeing',
  'Expedia Group',
  'UnitedHealth Group',
  'Insulet Corporation',
  'Cigna-Evernorth Services Inc.',
  'Career Soft Solutions Inc',
  'PlanetScale',
  'DoorDash',
  'SOLUTION IT, Inc',
  'eBay',
  'RapidIT Inc',
  'Cisco',
  'OpenAI',
  'Hire IT People, Inc',
  'D2Sol, Inc.',
  'INFO KEYS INC',
  'Twitch Interactive, Inc.',
  'Natera, Inc.',
  'ASTIR IT SOLUTIONS, INC',
  'University of South Florida',
  'Samsara Inc.',
  'NOVITIUM PHARMA LLC.',
  'Anthropic',
  'MACYS SYSTEMS AND TECHNOLOGY INC',
  'CVS Health',
  'AMERICAN EXPRESS TRAVEL RELATED',
  'Johnson & Johnson',
  'BRAINS TECHNOLOGY SOLUTIONS, INC',
  'EY',
]

const DOMAIN_OVERRIDES: Record<string, string> = {
  'Insulet Corporation': 'insulet.com',
  'Cigna-Evernorth Services Inc.': 'cigna.com',
  'Career Soft Solutions Inc': 'career-soft.com',
  'SOLUTION IT, Inc': 'solutionit.com',
  'RapidIT Inc': 'rapiditinc.com',
  'Twitch Interactive, Inc.': 'twitch.tv',
  'University of South Florida': 'usf.edu',
  'Samsara Inc.': 'samsara.com',
  'MACYS SYSTEMS AND TECHNOLOGY INC': 'macys.com',
  'BRAINS TECHNOLOGY SOLUTIONS, INC': 'brains.co',
}

const LEGAL_SUFFIXES = new Set([
  'INC',
  'INCORPORATED',
  'LLC',
  'L.L.C',
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
  'SERVICES',
  'SERVICE',
  'PBC',
])

function normalizeDomain(domain: string | null | undefined): string {
  return (domain ?? '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]!
}

function parseHost(urlLike: string | null | undefined): string {
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
    if (host === 'logo.clearbit.com' || host === 'unavatar.io' || host === 'icon.horse') {
      return normalizeDomain(u.pathname.replace(/^\/icon\//, '').replace(/^\//, '').split('/')[0] ?? '')
    }
    return normalizeDomain(host)
  } catch {
    return ''
  }
}

function isPlaceholderDomain(domain: string | null | undefined): boolean {
  const d = normalizeDomain(domain)
  return d.endsWith('.lca-employer') || d.endsWith('.uscis-employer')
}

function normalizeEmployerName(name: string): string {
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

function lcaNormalized(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(
      /\b(incorporated|inc|llc|l\.l\.c|corp|corporation|ltd|limited|co|company|plc|holdings|group|services|service|pbc)\b/g,
      ''
    )
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function withRetry<T>(
  label: string,
  fn: () => PromiseLike<T>,
  attempts = 3
): Promise<T> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, 400 * i))
      }
    }
  }
  throw new Error(`${label}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

async function countRefs(table: 'jobs' | 'watchlist' | 'crawl_logs' | 'h1b_records' | 'lca_records' | 'employer_lca_stats', companyId: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select('id', { head: true, count: 'exact' })
    .eq('company_id', companyId)
  if (error) throw new Error(`${table} count: ${error.message}`)
  return count ?? 0
}

async function mergeWatchlist(loserId: string, winnerId: string): Promise<void> {
  const { data, error } = await admin
    .from('watchlist')
    .select('id, user_id, company_id')
    .in('company_id', [loserId, winnerId])
  if (error) throw new Error(`watchlist load: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; user_id: string; company_id: string }>

  const usersWithWinner = new Set(
    rows.filter((r) => r.company_id === winnerId).map((r) => r.user_id)
  )
  const loserRows = rows.filter((r) => r.company_id === loserId)
  const dupIds = loserRows.filter((r) => usersWithWinner.has(r.user_id)).map((r) => r.id)

  if (dupIds.length > 0) {
    const { error: delErr } = await admin.from('watchlist').delete().in('id', dupIds)
    if (delErr) throw new Error(`watchlist delete dup: ${delErr.message}`)
  }

  const { error: updErr } = await admin
    .from('watchlist')
    .update({ company_id: winnerId })
    .eq('company_id', loserId)
  if (updErr) throw new Error(`watchlist relink: ${updErr.message}`)
}

async function rewriteJobAlertsArrays(loserId: string, winnerId: string): Promise<number> {
  const { data, error } = await (admin
    .from('job_alerts')
    .select('id, company_ids')
    .contains('company_ids', [loserId]) as unknown as Promise<{
      data: Array<{ id: string; company_ids: string[] | null }> | null
      error: { message: string } | null
    }>)

  if (error) throw new Error(`job_alerts load: ${error.message}`)

  let touched = 0
  for (const row of data ?? []) {
    const ids = row.company_ids ?? []
    if (!ids.includes(loserId)) continue
    const rewritten = Array.from(new Set(ids.map((id) => (id === loserId ? winnerId : id))))
    const { error: updErr } = await admin
      .from('job_alerts')
      .update({ company_ids: rewritten })
      .eq('id', row.id)
    if (updErr) throw new Error(`job_alerts update: ${updErr.message}`)
    touched += 1
  }
  return touched
}

async function relinkTableByIds(
  table: 'h1b_records' | 'lca_records' | 'employer_lca_stats',
  loserId: string,
  winnerId: string
): Promise<void> {
  const BATCH = 500
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select('id')
      .eq('company_id', loserId)
      .limit(BATCH)

    if (error) throw new Error(`load ${table}: ${error.message}`)
    const ids = (data ?? []).map((r) => (r as { id: string }).id).filter(Boolean)
    if (ids.length === 0) break

    const { error: updErr } = await admin
      .from(table)
      .update({ company_id: winnerId })
      .in('id', ids)

    if (updErr) throw new Error(`update ${table}: ${updErr.message}`)
  }
}

async function mergePair(winner: CompanyRow, loser: CompanyRow) {
  const before = {
    winner: {
      jobs: await countRefs('jobs', winner.id),
      watchlist: await countRefs('watchlist', winner.id),
      crawl_logs: await countRefs('crawl_logs', winner.id),
      h1b_records: await countRefs('h1b_records', winner.id),
      lca_records: await countRefs('lca_records', winner.id),
      employer_lca_stats: await countRefs('employer_lca_stats', winner.id),
    },
    loser: {
      jobs: await countRefs('jobs', loser.id),
      watchlist: await countRefs('watchlist', loser.id),
      crawl_logs: await countRefs('crawl_logs', loser.id),
      h1b_records: await countRefs('h1b_records', loser.id),
      lca_records: await countRefs('lca_records', loser.id),
      employer_lca_stats: await countRefs('employer_lca_stats', loser.id),
    },
  }

  if (!execute) return { before, updatedAlerts: 0 }

  await withRetry(`relink jobs ${loser.name}`, () =>
    admin.from('jobs').update({ company_id: winner.id }).eq('company_id', loser.id)
  )

  await withRetry(`relink crawl_logs ${loser.name}`, () =>
    admin.from('crawl_logs').update({ company_id: winner.id }).eq('company_id', loser.id)
  )

  await mergeWatchlist(loser.id, winner.id)
  await relinkTableByIds('h1b_records', loser.id, winner.id)
  await relinkTableByIds('lca_records', loser.id, winner.id)
  await relinkTableByIds('employer_lca_stats', loser.id, winner.id)
  const updatedAlerts = await rewriteJobAlertsArrays(loser.id, winner.id)

  const mergedConfig = {
    ...(loser.raw_ats_config ?? {}),
    merged_into_company_id: winner.id,
    merged_into_company_name: winner.name,
    merged_at: new Date().toISOString(),
  }

  const { error: loserErr } = await admin
    .from('companies')
    .update({
      is_active: false,
      raw_ats_config: mergedConfig as never,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', loser.id)
  if (loserErr) throw new Error(`deactivate loser ${loser.name}: ${loserErr.message}`)

  return { before, updatedAlerts }
}

async function main() {
  console.log(`\n[target-fix] mode=${execute ? 'EXECUTE' : 'dry-run'}\n`)

  const { data: companiesData, error: companiesErr } = await admin
    .from('companies')
    .select('id, name, domain, logo_url, is_active, raw_ats_config')
  if (companiesErr) throw new Error(`load companies: ${companiesErr.message}`)
  const companies = (companiesData ?? []) as CompanyRow[]
  const byName = new Map(companies.map((c) => [c.name, c]))

  const mergePlan = MERGE_PAIRS
    .map((pair) => ({
      ...pair,
      winner: byName.get(pair.winnerName) ?? null,
      loser: byName.get(pair.loserName) ?? null,
    }))
    .filter((p) => p.winner && p.loser)

  const mergeResults: Array<Record<string, unknown>> = []
  for (const plan of mergePlan) {
    const winner = plan.winner!
    const loser = plan.loser!
    const res = await mergePair(winner, loser)
    mergeResults.push({
      winner: winner.name,
      loser: loser.name,
      winnerId: winner.id,
      loserId: loser.id,
      ...res,
    })
    console.log(`[target-fix] merge ${loser.name} -> ${winner.name} ${execute ? 'done' : 'planned'}`)
  }

  const aliasResults: Array<Record<string, unknown>> = []
  for (const relink of MANUAL_H1B_RELINKS) {
    const company = byName.get(relink.companyName)
    if (!company) continue

    const norm = lcaNormalized(relink.employerName)

    const { count: hCount, error: hErr } = await admin
      .from('h1b_records')
      .select('id', { head: true, count: 'exact' })
      .is('company_id', null)
      .eq('employer_name', relink.employerName)
    if (hErr) throw new Error(`h1b count ${relink.employerName}: ${hErr.message}`)

    const { count: lCount, error: lErr } = await admin
      .from('lca_records')
      .select('id', { head: true, count: 'exact' })
      .is('company_id', null)
      .eq('employer_name_normalized', norm)
    if (lErr) throw new Error(`lca count ${relink.employerName}: ${lErr.message}`)

    const { count: sCount, error: sErr } = await admin
      .from('employer_lca_stats')
      .select('id', { head: true, count: 'exact' })
      .is('company_id', null)
      .eq('employer_name_normalized', norm)
    if (sErr) throw new Error(`stats count ${relink.employerName}: ${sErr.message}`)

    if (execute) {
      if ((hCount ?? 0) > 0) {
        const { error } = await admin
          .from('h1b_records')
          .update({ company_id: company.id })
          .is('company_id', null)
          .eq('employer_name', relink.employerName)
        if (error) throw new Error(`h1b relink ${relink.employerName}: ${error.message}`)
      }

      if ((lCount ?? 0) > 0) {
        const { error } = await admin
          .from('lca_records')
          .update({ company_id: company.id })
          .is('company_id', null)
          .eq('employer_name_normalized', norm)
        if (error) throw new Error(`lca relink ${relink.employerName}: ${error.message}`)
      }

      if ((sCount ?? 0) > 0) {
        const { error } = await admin
          .from('employer_lca_stats')
          .update({ company_id: company.id })
          .is('company_id', null)
          .eq('employer_name_normalized', norm)
        if (error) throw new Error(`stats relink ${relink.employerName}: ${error.message}`)
      }
    }

    aliasResults.push({
      employerName: relink.employerName,
      companyName: relink.companyName,
      companyId: company.id,
      h1bRows: hCount ?? 0,
      lcaRows: lCount ?? 0,
      lcaStatsRows: sCount ?? 0,
      executed: execute,
    })

    if ((hCount ?? 0) + (lCount ?? 0) + (sCount ?? 0) > 0) {
      console.log(
        `[target-fix] alias ${relink.employerName} -> ${relink.companyName} (h1b=${hCount ?? 0} lca=${lCount ?? 0} stats=${sCount ?? 0})`
      )
    }
  }

  const logoResults: Array<Record<string, unknown>> = []
  for (const name of LOGO_TARGETS) {
    const row = byName.get(name)
    if (!row) continue

    const guessed = normalizeDomain(row.raw_ats_config?.guessed_domain ?? null)
    const matchedHost = parseHost(row.raw_ats_config?.ats_detection?.matchedUrl ?? null)
    const logoHost = parseLogoDomain(row.logo_url)

    let preferredDomain = normalizeDomain(DOMAIN_OVERRIDES[name] ?? '')
    if (!preferredDomain) {
      const current = normalizeDomain(row.domain)
      if (current && !isPlaceholderDomain(current)) preferredDomain = current
      else if (matchedHost && !isPlaceholderDomain(matchedHost)) preferredDomain = matchedHost
      else if (guessed && !isPlaceholderDomain(guessed)) preferredDomain = guessed
      else if (logoHost && !isPlaceholderDomain(logoHost)) preferredDomain = logoHost
    }

    if (!preferredDomain) {
      logoResults.push({
        name,
        id: row.id,
        skipped: true,
        reason: 'no_preferred_domain',
      })
      continue
    }

    const nextLogo = companyLogoUrlFromDomain(preferredDomain, 'clearbit')
    const nextDomain = isPlaceholderDomain(row.domain) ? preferredDomain : normalizeDomain(row.domain)

    const willChange = normalizeDomain(row.domain) !== nextDomain || (row.logo_url ?? '') !== nextLogo
    logoResults.push({
      name,
      id: row.id,
      fromDomain: row.domain,
      toDomain: nextDomain,
      fromLogo: row.logo_url,
      toLogo: nextLogo,
      changed: willChange,
      executed: execute,
    })

    if (execute && willChange) {
      const { error } = await admin
        .from('companies')
        .update({
          domain: nextDomain,
          logo_url: nextLogo,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (error) throw new Error(`logo update ${row.name}: ${error.message}`)
      console.log(`[target-fix] logo/domain ${row.name} -> ${nextDomain}`)
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode: execute ? 'execute' : 'dry-run',
    merge_count: mergeResults.length,
    alias_relink_count: aliasResults.length,
    logo_target_count: logoResults.length,
    merge_results: mergeResults,
    alias_results: aliasResults,
    logo_results: logoResults,
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\n[target-fix] report: ${reportPath}`)
}

main().catch((err) => {
  console.error('\n[target-fix] failed:', err)
  process.exit(1)
})

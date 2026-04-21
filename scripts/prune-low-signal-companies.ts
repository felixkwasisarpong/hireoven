/**
 * Prune low-signal company rows from the `companies` table.
 *
 * Hireoven's LCA importer historically synthesised a placeholder company for
 * every DOL employer it saw — tens of thousands of rows that never produced
 * a job and whose H1B footprint is too small to meaningfully influence the
 * Bayesian posterior used by the predictor. This script reclaims that space.
 *
 * A company is eligible for pruning when ALL of these hold:
 *   1. `is_active = false` (never shown publicly to begin with)
 *   2. No rows in `jobs` reference it
 *   3. Combined H1B footprint is below the significance threshold:
 *        `employer_lca_stats.total_certified + SUM(h1b_records.approved)
 *           < threshold`
 *
 * Defaults to DRY RUN (prints the report and exits). Pass `--execute` to
 * actually delete. Companion rows in `employer_lca_stats`, `h1b_records`, and
 * `lca_records` are either CASCADE-cleared (lca_records) or have their
 * `company_id` set to NULL so the raw disclosure data is never lost.
 *
 * Usage:
 *   npx tsx scripts/prune-low-signal-companies.ts           # dry run
 *   npx tsx scripts/prune-low-signal-companies.ts --execute # actually delete
 *   npx tsx scripts/prune-low-signal-companies.ts --threshold=25
 *   npx tsx scripts/prune-low-signal-companies.ts --limit=500
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'

loadEnvConfig(process.cwd())

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

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
const lcaThreshold = Number(flag('lca-threshold') ?? flag('threshold')) || 10
const uscisThreshold = Number(flag('uscis-threshold')) || 5

const PLACEHOLDER_SOURCES = new Set([
  'lca_import',
  'lca_reconciliation',
  'uscis_reconciliation',
])

// ---------------------------------------------------------------------------
// Supabase admin client
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type CompanyCandidate = {
  id: string
  name: string
  domain: string | null
  is_active: boolean | null
  lca_certified: number
  uscis_approvals: number
  job_count: number
  source:
    | 'lca_import'
    | 'lca_reconciliation'
    | 'uscis_reconciliation'
    | 'sentinel_domain'
    | 'other'
}

async function main() {
  const banner = [
    '',
    '── Prune low-signal companies ──────────────────────────────────',
    `  mode:               ${execute ? 'EXECUTE (will delete)' : 'DRY RUN'}`,
    `  lca threshold:      < ${lcaThreshold} certified filings`,
    `  uscis threshold:    < ${uscisThreshold} I-129 approvals`,
    `  scope:              inactive companies with zero jobs`,
    limit ? `  limit:              ${limit}` : undefined,
    '────────────────────────────────────────────────────────────────',
    '',
  ]
    .filter(Boolean)
    .join('\n')
  console.log(banner)

  // 1. Load all inactive companies.
  const inactive = await fetchAllInactive()
  console.log(`Loaded ${inactive.length.toLocaleString()} inactive companies.`)

  if (inactive.length === 0) {
    console.log('Nothing to evaluate. Exiting.')
    return
  }

  // 2. Keep only import/reconciliation placeholders. Stage-5 pruning is meant
  //    to clean dead-weight placeholders, not arbitrary inactive companies.
  const placeholders = inactive.filter(isPlaceholderCompany)
  console.log(
    `Scoped to ${placeholders.length.toLocaleString()} placeholder companies (import/reconciliation sources).`
  )
  if (placeholders.length === 0) {
    console.log('No placeholder companies found in inactive set. Exiting.')
    return
  }

  // 3. Attach job counts, LCA totals, USCIS totals. We fetch these serially,
  //    not in parallel, to avoid tripping PostgREST URL-length / rate limits
  //    when the IN() clauses are long. Three small sequential round-trips
  //    are still fast; three concurrent ones with 500-UUID IN clauses were
  //    causing transient `TypeError: fetch failed` errors.
  const ids = placeholders.map((c) => c.id)
  const jobs = await aggregateJobs(ids)
  const lca = await aggregateLCA(ids)
  const uscis = await aggregateUSCIS(ids)

  const candidates: CompanyCandidate[] = []
  for (const c of placeholders) {
    const lcaCert = lca.get(c.id) ?? 0
    const uscisApp = uscis.get(c.id) ?? 0
    const jobCount = jobs.get(c.id) ?? 0
    if (jobCount > 0) continue
    if (lcaCert >= lcaThreshold) continue
    if (uscisApp >= uscisThreshold) continue
    candidates.push({
      id: c.id,
      name: c.name,
      domain: c.domain,
      is_active: c.is_active,
      lca_certified: lcaCert,
      uscis_approvals: uscisApp,
      job_count: jobCount,
      source: detectSource(c),
    })
    if (limit && candidates.length >= limit) break
  }

  // 4. Report.
  printReport(candidates, placeholders.length, inactive.length)

  if (!execute) {
    console.log(
      '\nDry run complete. Re-run with --execute to delete these rows.\n'
    )
    return
  }

  if (candidates.length === 0) {
    console.log('\nNothing to delete.\n')
    return
  }

  // 5. Delete in chunks. Null out company_id on related rows first so the
  //    raw LCA / USCIS history survives the prune.
  await detachRelatedRows(candidates.map((c) => c.id))
  const deleted = await deleteCompanies(candidates.map((c) => c.id))
  console.log(`\nDeleted ${deleted.toLocaleString()} companies.\n`)
}

// ---------------------------------------------------------------------------
// Data access helpers
// ---------------------------------------------------------------------------

async function fetchAllInactive(): Promise<
  Array<{
    id: string
    name: string
    domain: string | null
    is_active: boolean | null
    raw_ats_config: Record<string, unknown> | null
  }>
> {
  const results: Array<{
    id: string
    name: string
    domain: string | null
    is_active: boolean | null
    raw_ats_config: Record<string, unknown> | null
  }> = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await admin
      .from('companies')
      .select('id, name, domain, is_active, raw_ats_config')
      .eq('is_active', false)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`companies page: ${error.message}`)
    if (!data || data.length === 0) break
    results.push(...(data as typeof results))
    if (data.length < pageSize) break
    from += pageSize
  }
  return results
}

function isPlaceholderCompany(c: {
  domain: string | null
  raw_ats_config: Record<string, unknown> | null
}): boolean {
  const src = (c.raw_ats_config as { source?: string } | null)?.source
  if (src && PLACEHOLDER_SOURCES.has(src)) return true
  const d = c.domain?.toLowerCase() ?? ''
  return d.endsWith('.lca-employer') || d.endsWith('.uscis-employer')
}

// Aggregation chunk size. Supabase/PostgREST enforces an ~8 KB URL cap,
// and each UUID in an IN() clause eats ~40 bytes after encoding. 500
// UUIDs = ~18 KB → always fails. 150 UUIDs = ~5.5 KB, safe headroom.
const AGG_CHUNK = 150

// Node's global fetch surfaces DNS hiccups, socket resets, and TLS
// handshake failures as "TypeError: fetch failed" with no clear cause.
// Retry the whole Supabase request up to 3 times with exponential backoff
// to absorb transient network issues instead of aborting the whole run.
async function withRetry<T>(
  label: string,
  // Accept any thenable so Supabase's PostgrestFilterBuilder (which is a
  // PromiseLike, not a true Promise) can be passed without a Promise<>
  // mismatch at call sites.
  fn: () => PromiseLike<T>,
  attempts = 3
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt < attempts) {
        const backoffMs = 500 * Math.pow(2, attempt - 1)
        console.warn(
          `  ${label}: attempt ${attempt}/${attempts} failed (${msg}); retrying in ${backoffMs}ms`
        )
        await new Promise((r) => setTimeout(r, backoffMs))
      }
    }
  }
  throw new Error(
    `${label}: ${attempts} attempts failed — ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  )
}

async function aggregateJobs(companyIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (let i = 0; i < companyIds.length; i += AGG_CHUNK) {
    const chunk = companyIds.slice(i, i + AGG_CHUNK)
    const { data, error } = await withRetry(`jobs chunk ${i}`, () =>
      admin.from('jobs').select('company_id').in('company_id', chunk)
    )
    if (error) throw new Error(`jobs chunk: ${error.message}`)
    for (const row of (data ?? []) as Array<{ company_id: string | null }>) {
      if (!row.company_id) continue
      counts.set(row.company_id, (counts.get(row.company_id) ?? 0) + 1)
    }
  }
  return counts
}

async function aggregateLCA(companyIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (let i = 0; i < companyIds.length; i += AGG_CHUNK) {
    const chunk = companyIds.slice(i, i + AGG_CHUNK)
    const { data, error } = await withRetry(`employer_lca_stats chunk ${i}`, () =>
      admin
        .from('employer_lca_stats')
        .select('company_id, total_certified')
        .in('company_id', chunk)
    )
    if (error) throw new Error(`employer_lca_stats chunk: ${error.message}`)
    for (const row of (data ?? []) as Array<{
      company_id: string | null
      total_certified: number | null
    }>) {
      if (!row.company_id) continue
      counts.set(
        row.company_id,
        (counts.get(row.company_id) ?? 0) + (row.total_certified ?? 0)
      )
    }
  }
  return counts
}

async function aggregateUSCIS(
  companyIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (let i = 0; i < companyIds.length; i += AGG_CHUNK) {
    const chunk = companyIds.slice(i, i + AGG_CHUNK)
    const { data, error } = await withRetry(`h1b_records chunk ${i}`, () =>
      admin.from('h1b_records').select('company_id, approved').in('company_id', chunk)
    )
    if (error) throw new Error(`h1b_records chunk: ${error.message}`)
    for (const row of (data ?? []) as Array<{
      company_id: string | null
      approved: number | null
    }>) {
      if (!row.company_id) continue
      counts.set(
        row.company_id,
        (counts.get(row.company_id) ?? 0) + (row.approved ?? 0)
      )
    }
  }
  return counts
}

function detectSource(c: {
  raw_ats_config: Record<string, unknown> | null
  domain: string | null
}):
  | 'lca_import'
  | 'lca_reconciliation'
  | 'uscis_reconciliation'
  | 'sentinel_domain'
  | 'other' {
  const src = (c.raw_ats_config as { source?: string } | null)?.source
  if (src === 'lca_import') return 'lca_import'
  if (src === 'lca_reconciliation') return 'lca_reconciliation'
  if (src === 'uscis_reconciliation') return 'uscis_reconciliation'
  if (
    c.domain &&
    (c.domain.endsWith('.lca-employer') || c.domain.endsWith('.uscis-employer'))
  ) {
    return 'sentinel_domain'
  }
  return 'other'
}

async function detachRelatedRows(ids: string[]): Promise<void> {
  // Keep raw disclosure history — just unlink it from the company row.
  await detachTable('lca_records', ids)
  await detachTable('employer_lca_stats', ids)
  await detachTable('h1b_records', ids)
}

type DetachTable = 'lca_records' | 'employer_lca_stats' | 'h1b_records'

function isStatementTimeout(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes('statement timeout') || m.includes('canceling statement')
}

async function detachTable(table: DetachTable, ids: string[]): Promise<void> {
  const CHUNK = 75
  console.log(`Detaching ${table} links...`)
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { error } = await withRetry(`detach ${table} chunk ${i}`, () =>
      ((admin.from(table) as any).update({ company_id: null }).in('company_id', chunk) as Promise<{
        error: { message: string } | null
      }>)
    )
    if (!error) continue

    if (isStatementTimeout(error.message) && chunk.length > 1) {
      // Fallback: update one company at a time when a chunk times out.
      for (const companyId of chunk) {
        const { error: singleError } = await withRetry(
          `detach ${table} id ${companyId}`,
          () =>
            ((admin.from(table) as any)
              .update({ company_id: null })
              .eq('company_id', companyId) as Promise<{
              error: { message: string } | null
            }>)
        )
        if (singleError) {
          throw new Error(
            `detach ${table} company ${companyId}: ${singleError.message}`
          )
        }
      }
      continue
    }

    throw new Error(`detach ${table}: ${error.message}`)
  }
}

async function deleteCompanies(ids: string[]): Promise<number> {
  let deleted = 0
  const CHUNK = 500
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { error, count } = await admin
      .from('companies')
      .delete({ count: 'exact' })
      .in('id', chunk)
    if (error) throw new Error(`delete companies: ${error.message}`)
    deleted += count ?? chunk.length
  }
  return deleted
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printReport(
  candidates: CompanyCandidate[],
  placeholderCount: number,
  inactiveCount: number
): void {
  const bySource = new Map<string, number>()
  for (const c of candidates) {
    bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1)
  }

  console.log(
    `\nWould prune ${candidates.length.toLocaleString()} / ${placeholderCount.toLocaleString()} placeholders` +
      ` (${inactiveCount.toLocaleString()} total inactive companies).`
  )
  if (bySource.size > 0) {
    console.log('  by source:')
    for (const [source, count] of bySource) {
      console.log(`    ${source.padEnd(14)} ${count.toLocaleString()}`)
    }
  }

  // Surface the 10 biggest losers so it is easy to spot a misclassification.
  const sample = [...candidates]
    .sort((a, b) => b.lca_certified + b.uscis_approvals - (a.lca_certified + a.uscis_approvals))
    .slice(0, 10)
  if (sample.length > 0) {
    console.log('\n  Top candidates by residual signal (sanity check):')
    console.log('    ' + 'NAME'.padEnd(50) + 'LCA'.padStart(6) + 'USCIS'.padStart(7))
    for (const c of sample) {
      console.log(
        '    ' +
          c.name.slice(0, 48).padEnd(50) +
          String(c.lca_certified).padStart(6) +
          String(c.uscis_approvals).padStart(7)
      )
    }
  }

  if (verbose) {
    console.log('\n  All candidates:')
    for (const c of candidates) {
      console.log(
        `    ${c.id}  ${c.name.slice(0, 60).padEnd(60)}  lca=${c.lca_certified}  uscis=${c.uscis_approvals}  src=${c.source}`
      )
    }
  }
}

// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('\nprune-low-signal-companies failed:', err)
  process.exit(1)
})

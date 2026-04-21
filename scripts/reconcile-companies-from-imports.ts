/**
 * Reconcile `companies` rows from raw USCIS + DOL LCA imports.
 *
 * This is the **single source of truth** for bulk-creating company rows from
 * import data. The importers themselves never touch the `companies` table;
 * they only load raw rows into `lca_records` / `h1b_records`. Running this
 * script after an import will:
 *
 *   1. Scan `lca_records` and `h1b_records` for unmatched employers
 *      (company_id IS NULL) and compute each one's total filings footprint
 *      (LCA filings + USCIS approvals, across every fiscal year we have).
 *   2. For every employer whose footprint clears the configured thresholds,
 *      create a placeholder `companies` row via the shared helper in
 *      `lib/companies/placeholder-from-employer.ts` (inactive, sentinel
 *      domain, guessed public domain, favicon logo, ats_discovery_status =
 *      "pending").
 *   3. Back-link the newly minted company_id onto the raw `lca_records`,
 *      `h1b_records`, and `employer_lca_stats` rows so the prediction engine
 *      and admin UI can join on it.
 *
 * Defaults to a DRY RUN — nothing is written. Pass `--execute` to commit.
 *
 * Usage:
 *   npx tsx scripts/reconcile-companies-from-imports.ts              # dry run
 *   npx tsx scripts/reconcile-companies-from-imports.ts --execute    # commit
 *   npx tsx scripts/reconcile-companies-from-imports.ts --lca-threshold=20
 *   npx tsx scripts/reconcile-companies-from-imports.ts --uscis-threshold=10
 *   npx tsx scripts/reconcile-companies-from-imports.ts --limit=500
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { ensurePlaceholderCompany } from '@/lib/companies/placeholder-from-employer'

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
// Deliberately strict defaults. Running this with `--execute` should never
// flood the companies table — the typical USCIS/LCA dataset has a very long
// tail of one-off employers that are useless for the predictor and only
// bloat admin surfaces. Opt in to looser thresholds explicitly.
const lcaThreshold = Number(flag('lca-threshold') ?? flag('threshold')) || 100
const uscisThreshold = Number(flag('uscis-threshold')) || 50

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
// Utility: paged scan helper
// ---------------------------------------------------------------------------

/**
 * Page through a Supabase query using ranged selects.
 *
 * IMPORTANT: PostgREST silently caps any single response at 1,000 rows by
 * default (the `db.max_rows` / `PGRST_DB_MAX_ROWS` setting). Asking for a
 * larger `pageSize` does NOT get you more rows — the server just truncates
 * the response to 1,000 and the old "break when page.length < pageSize"
 * loop terminated after the first page, silently missing every row past
 * row 1,000.
 *
 * We now:
 *   - request exactly 1,000 rows per page (matches the default cap),
 *   - keep paging as long as the server returns ≥ 1 row,
 *   - stop only when a page comes back empty.
 *
 * This correctly drains tables with hundreds of thousands of rows.
 */
async function scanAll<T>(
  step: (offset: number, pageSize: number) => Promise<T[]>
): Promise<T[]> {
  const pageSize = 1000
  const all: T[] = []
  let offset = 0
  for (;;) {
    const page = await step(offset, pageSize)
    if (page.length === 0) break
    all.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return all
}

// ---------------------------------------------------------------------------
// Step 1 — aggregate LCA + USCIS footprint per normalised employer name
// ---------------------------------------------------------------------------

type Candidate = {
  normalized: string
  displayName: string
  lcaFilings: number
  uscisApprovals: number
  /** Which source(s) contributed, for reporting + the placeholder's
   *  `raw_ats_config.source`. */
  sources: Set<'lca' | 'uscis'>
}

async function buildCandidates(): Promise<Map<string, Candidate>> {
  const candidates = new Map<string, Candidate>()

  // LCA rows that aren't linked yet.
  console.log('[reconcile] scanning lca_records (company_id IS NULL)...')
  const lcaRows = await scanAll(async (offset, pageSize) => {
    const { data, error } = await admin
      .from('lca_records')
      .select('employer_name, employer_name_normalized')
      .is('company_id', null)
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`load lca_records: ${error.message}`)
    if (offset > 0 && offset % 20000 === 0) {
      console.log(`  lca_records scanned so far: ${offset.toLocaleString()}`)
    }
    return (data ?? []) as Array<{
      employer_name: string
      employer_name_normalized: string | null
    }>
  })
  console.log(`[reconcile]   lca_records scanned: ${lcaRows.length.toLocaleString()} unmatched rows`)
  for (const row of lcaRows) {
    const key = row.employer_name_normalized
    if (!key) continue
    const c = candidates.get(key) ?? {
      normalized: key,
      displayName: row.employer_name,
      lcaFilings: 0,
      uscisApprovals: 0,
      sources: new Set<'lca' | 'uscis'>(),
    }
    c.lcaFilings++
    c.sources.add('lca')
    candidates.set(key, c)
  }

  // USCIS employers without a company_id. We don't have normalized_name on
  // h1b_records, so normalise locally using the same rules the LCA importer
  // uses. (That keeps the candidate key consistent across sources.)
  console.log('[reconcile] scanning h1b_records (company_id IS NULL)...')
  const h1bRows = await scanAll(async (offset, pageSize) => {
    const { data, error } = await admin
      .from('h1b_records')
      .select('employer_name, approved, denied')
      .is('company_id', null)
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`load h1b_records: ${error.message}`)
    if (offset > 0 && offset % 20000 === 0) {
      console.log(`  h1b_records scanned so far: ${offset.toLocaleString()}`)
    }
    return (data ?? []) as Array<{
      employer_name: string
      approved: number | null
      denied: number | null
    }>
  })
  console.log(`[reconcile]   h1b_records scanned: ${h1bRows.length.toLocaleString()} unmatched rows`)

  for (const row of h1bRows) {
    const display = row.employer_name?.trim()
    if (!display) continue
    const key = normalizeEmployerName(display)
    if (!key) continue
    const c = candidates.get(key) ?? {
      normalized: key,
      displayName: display,
      lcaFilings: 0,
      uscisApprovals: 0,
      sources: new Set<'lca' | 'uscis'>(),
    }
    c.uscisApprovals += row.approved ?? 0
    c.sources.add('uscis')
    candidates.set(key, c)
  }

  return candidates
}

/**
 * Kept in lockstep with `normalizeEmployerName` in `lib/h1b/lca-importer.ts`.
 * We duplicate here (instead of importing) because the LCA importer module
 * pulls in Supabase admin clients and `XLSX`, and we don't want this CLI to
 * start up those dependencies eagerly.
 */
function normalizeEmployerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(
      /\b(incorporated|inc|llc|l\.l\.c|corp|corporation|ltd|limited|co|company|plc|holdings|group)\b/g,
      ''
    )
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Step 2 — create placeholder companies for candidates that clear the bar
// ---------------------------------------------------------------------------

async function reconcile() {
  console.log('[reconcile] Scanning lca_records + h1b_records for unmatched employers...')

  const candidates = await buildCandidates()
  console.log(`[reconcile] Found ${candidates.size.toLocaleString()} unmatched employer(s) total.`)

  // Pre-load existing companies so we can dedupe by normalised name.
  const { data: companyRows, error: companyError } = await admin
    .from('companies')
    .select('id, name, domain')
  if (companyError) throw new Error(`load companies: ${companyError.message}`)

  const byNormalized = new Map<string, string>()
  for (const c of (companyRows ?? []) as Array<{ id: string; name: string }>) {
    const key = normalizeEmployerName(c.name)
    if (key && !byNormalized.has(key)) byNormalized.set(key, c.id)
  }

  // Rank by footprint and keep the qualified ones.
  const qualified = Array.from(candidates.values())
    .filter((c) => {
      if (byNormalized.has(c.normalized)) return false // already tracked
      return c.lcaFilings >= lcaThreshold || c.uscisApprovals >= uscisThreshold
    })
    .sort(
      (a, b) =>
        b.lcaFilings + b.uscisApprovals * 2 - (a.lcaFilings + a.uscisApprovals * 2)
    )

  const work = limit ? qualified.slice(0, limit) : qualified
  console.log(
    `[reconcile] ${qualified.length.toLocaleString()} qualify (lca >= ${lcaThreshold} OR uscis >= ${uscisThreshold})` +
      `${limit ? `; running on first ${work.length.toLocaleString()}` : ''}.`
  )

  if (!execute) {
    console.log(
      `\n[dry-run] WOULD CREATE ${work.length.toLocaleString()} placeholder companies if --execute were passed.`
    )
    console.log('[dry-run] top 25 candidates (sorted by footprint):')
    for (const c of work.slice(0, 25)) {
      console.log(
        `  • ${c.displayName.padEnd(48)} lca=${c.lcaFilings} uscis=${c.uscisApprovals} sources=[${Array.from(c.sources).join(',')}]`
      )
    }
    console.log(
      '\n[dry-run] tighten with e.g. --lca-threshold=500 --uscis-threshold=200 before --execute,'
    )
    console.log('           or cap the run with --limit=250.')
    return
  }

  let created = 0
  let already = 0
  let failed = 0
  for (const c of work) {
    const source = c.lcaFilings >= c.uscisApprovals ? 'lca' : 'uscis'
    const result = await ensurePlaceholderCompany(admin, {
      displayName: c.displayName,
      normalized: c.normalized,
      source,
      existingByNormalized: byNormalized,
    })
    if (!result) {
      failed++
      continue
    }
    if (result.created) created++
    else already++

    // Back-link raw rows. We match by normalised name (LCA) or exact
    // employer_name (USCIS, since it doesn't store a normalised column).
    const [lcaRes, usRes, statsRes] = await Promise.all([
      admin
        .from('lca_records')
        .update({ company_id: result.companyId })
        .is('company_id', null)
        .eq('employer_name_normalized', c.normalized),
      admin
        .from('h1b_records')
        .update({ company_id: result.companyId })
        .is('company_id', null)
        .eq('employer_name', c.displayName),
      admin
        .from('employer_lca_stats')
        .update({ company_id: result.companyId })
        .is('company_id', null)
        .eq('employer_name_normalized', c.normalized),
    ])
    if (verbose) {
      const lcaErr = (lcaRes as { error?: { message?: string } }).error?.message
      const usErr = (usRes as { error?: { message?: string } }).error?.message
      const statsErr = (statsRes as { error?: { message?: string } }).error?.message
      if (lcaErr || usErr || statsErr) {
        console.log(
          `  ! ${c.displayName}: lca=${lcaErr ?? 'ok'} uscis=${usErr ?? 'ok'} stats=${statsErr ?? 'ok'}`
        )
      }
    }

    if ((created + already) % 100 === 0) {
      console.log(
        `[reconcile] ${created + already}/${work.length}  created=${created}  already=${already}  failed=${failed}`
      )
    }
  }

  console.log(
    `\n[reconcile] done. created=${created} alreadyExisted=${already} failed=${failed} of ${work.length}`
  )
}

reconcile().catch((err) => {
  console.error('reconcile failed', err)
  process.exit(1)
})

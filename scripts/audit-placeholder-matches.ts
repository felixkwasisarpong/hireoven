/**
 * Audit placeholder companies that were previously activated by the
 * enrichment pipeline, flagging matches whose verified domain doesn't
 * plausibly belong to the employer name.
 *
 * The first generation of enrichment used greedy acronym guessing
 * (`guessCandidateDomains`) which happily accepted 2–3 letter domains
 * like `cf.com`, `rm.com`, `dbs.com`. Those domains often host real
 * ATS iframes - but they belong to *other* companies, so the activated
 * placeholder ended up with a wrong logo, wrong careers URL, and a
 * misleading `is_active = true` flag.
 *
 * This script re-runs the same `isDomainPlausible` check that the fixed
 * enricher applies, and for every implausible match:
 *   - flips `is_active` back to false
 *   - clears `ats_type` and resets `careers_url` to the LinkedIn fallback
 *   - marks `raw_ats_config.ats_discovery_status = 'pending'` so the next
 *     `db:enrich-placeholders:retry` run can take another pass with the
 *     better candidate ordering
 *
 * Usage:
 *   npx tsx scripts/audit-placeholder-matches.ts            # dry-run
 *   npx tsx scripts/audit-placeholder-matches.ts --execute  # commit
 */

import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { companyLogoUrlFromDomain } from '../lib/companies/logo-url'

loadEnvConfig(process.cwd())

const execute = process.argv.includes('--execute')

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

const PLACEHOLDER_SOURCES = [
  'lca_import',
  'lca_reconciliation',
  'uscis_reconciliation',
]

const LEGAL_SUFFIXES =
  /\b(incorporated|inc|l\.?l\.?c\.?|llp|llp\.|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|solutions|services|systems|consulting|consultants|partners|us|usa|america|americas|north\s+america|na)\b\.?,?/gi

function isDomainPlausible(companyName: string, verifiedDomain: string | null): boolean {
  if (!verifiedDomain) return false
  const host = verifiedDomain.toLowerCase().replace(/^www\./, '')
  const rootLabel = host.split('.')[0] ?? ''
  if (!rootLabel) return false

  const nameTokens = companyName
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)

  const collapsedName = nameTokens.join('')
  for (const tok of nameTokens) {
    if (tok.length >= 4 && rootLabel.includes(tok)) return true
  }
  if (rootLabel.length >= 4 && collapsedName.includes(rootLabel)) return true
  if (rootLabel.length >= 4 && rootLabel.length <= 6) {
    const acronym = nameTokens.map((w) => w[0]).join('')
    if (acronym === rootLabel) return true
  }
  return false
}

type Row = {
  id: string
  name: string
  domain: string | null
  ats_type: string | null
  careers_url: string | null
  is_active: boolean | null
  raw_ats_config: {
    source?: string
    guessed_domain?: string | null
    ats_discovery_status?: string
    ats_detection?: {
      matchedUrl?: string
      confidence?: string
    }
    [key: string]: unknown
  } | null
}

async function main() {
  console.log(`[audit] mode=${execute ? 'EXECUTE' : 'dry-run'}`)

  // Page through every placeholder currently marked 'checked' (was enriched
  // at some point). PostgREST caps at 1,000 so we page in chunks.
  const pageSize = 1000
  const rows: Row[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await (admin
      .from('companies')
      .select('id, name, domain, ats_type, careers_url, is_active, raw_ats_config')
      .in('raw_ats_config->>source', PLACEHOLDER_SOURCES)
      .filter('raw_ats_config->>ats_discovery_status', 'eq', 'checked')
      .range(offset, offset + pageSize - 1) as unknown as Promise<{
      data: Row[] | null
      error: { message: string } | null
    }>)
    if (error) throw new Error(`load checked placeholders: ${error.message}`)
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }

  console.log(`[audit] scanning ${rows.length.toLocaleString()} previously-enriched placeholders.`)

  let ok = 0
  let bad = 0
  const toRevert: Row[] = []

  for (const row of rows) {
    const matchedUrl = row.raw_ats_config?.ats_detection?.matchedUrl
    const verifiedDomain = (() => {
      if (matchedUrl) {
        try {
          return new URL(matchedUrl).host
        } catch {
          return row.raw_ats_config?.guessed_domain ?? row.domain ?? null
        }
      }
      return row.raw_ats_config?.guessed_domain ?? row.domain ?? null
    })()

    if (isDomainPlausible(row.name, verifiedDomain)) {
      ok++
      continue
    }

    bad++
    toRevert.push(row)
    console.log(
      `  ✗ ${row.name.slice(0, 44).padEnd(44)}  ats=${(row.ats_type ?? '').padEnd(10)} domain=${verifiedDomain ?? '-'}  → implausible`
    )
  }

  console.log(
    `\n[audit] plausible=${ok}  implausible=${bad}  of ${rows.length} previously-enriched rows`
  )

  if (!execute) {
    console.log('\n[audit] dry-run - nothing written. Re-run with --execute to revert the implausible ones.')
    return
  }

  if (bad === 0) {
    console.log('\n[audit] nothing to revert.')
    return
  }

  console.log(`\n[audit] reverting ${bad} rows to pending so next enrich retry can fix them...`)

  for (const row of toRevert) {
    // Reset to pending with cleaned state. Keep the original LinkedIn
    // careers URL fallback so the page still has something to show.
    const slug = row.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
    const fallbackCareers = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(row.name)}`

    const cleanedConfig = {
      ...(row.raw_ats_config ?? {}),
      // Intentionally drop the old bogus guessed_domain - the fresh
      // candidate generator will re-derive it from the name.
      guessed_domain: null,
      domain_verified: false,
      ats_discovery_status: 'pending',
      ats_detection: null,
      audit_reverted_at: new Date().toISOString(),
    }

    await admin
      .from('companies')
      .update({
        ats_type: null,
        is_active: false,
        careers_url: fallbackCareers,
        // Clear logo since the old one was from the wrong domain's favicon.
        logo_url: null as never,
        raw_ats_config: cleanedConfig as never,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', row.id)

    // Avoid unused-var lint for slug if logo generation is skipped.
    void slug
    void companyLogoUrlFromDomain
  }

  console.log(`[audit] done. ${bad} rows reverted.`)
  console.log(
    '[audit] next step: npm run db:enrich-placeholders:retry  (or db:enrich-placeholders:execute)'
  )
}

main().catch((err) => {
  console.error('audit failed', err)
  process.exit(1)
})

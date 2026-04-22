/**
 * Enrich placeholder companies created by the import / reconciliation flow.
 *
 * Placeholder rows are inserted by `scripts/reconcile-companies-from-imports.ts`
 * (and historically by the LCA importer) with:
 *   - `domain = "<slug>.lca-employer" | "<slug>.uscis-employer"` (sentinel)
 *   - `raw_ats_config.source in ('lca_import','lca_reconciliation','uscis_reconciliation')`
 *   - `raw_ats_config.ats_discovery_status = 'pending'`
 *   - `is_active = false`
 *
 * This script drains the pending queue end-to-end, offline from the admin UI,
 * using the same ATS detection code as the `/api/admin/h1b/enrich-placeholders`
 * route. For every placeholder it:
 *
 *   1. Tries the stored `guessed_domain` (e.g. `infosys.com`) plus a re-guess
 *      from the company name as a fallback.
 *   2. Fetches candidate URLs (`/`, `/careers`, `/jobs`, …) with a short
 *      timeout and bounded concurrency, scanning the HTML for ATS signatures
 *      (Greenhouse, Lever, Workday, Ashby, etc.).
 *   3. On hit: stores the real `ats_type`, `careers_url`, a favicon logo
 *      from the verified domain, and flips `is_active = true` for high /
 *      medium confidence detections.
 *   4. On miss: marks `ats_discovery_status = 'failed'` so we don't retry
 *      forever. The row stays inactive but keeps its predictor data.
 *
 * Usage:
 *   npx tsx scripts/enrich-placeholder-companies.ts               # dry run
 *   npx tsx scripts/enrich-placeholder-companies.ts --execute     # commit
 *   npx tsx scripts/enrich-placeholder-companies.ts --limit=100 --execute
 *   npx tsx scripts/enrich-placeholder-companies.ts --concurrency=12 --execute
 *   npx tsx scripts/enrich-placeholder-companies.ts --retry-failed --execute
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { detectAtsFromHtml } from '../lib/companies/ats-signatures'
import { detectAtsFromUrl } from '../lib/companies/detect-ats'
import { companyLogoUrlFromDomain } from '../lib/companies/logo-url'

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
const retryFailed = process.argv.includes('--retry-failed')
const limit = Number(flag('limit')) || undefined
const concurrency = Math.max(1, Math.min(20, Number(flag('concurrency')) || 8))
const fetchTimeoutMs = Math.max(1000, Number(flag('timeout-ms')) || 6000)

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

const PLACEHOLDER_SOURCES = [
  'lca_import',
  'lca_reconciliation',
  'uscis_reconciliation',
]

type PlaceholderRow = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  ats_type: string | null
  logo_url: string | null
  is_active: boolean | null
  raw_ats_config: {
    source?: string
    guessed_domain?: string | null
    ats_discovery_status?: 'pending' | 'checked' | 'failed'
    [key: string]: unknown
  } | null
}

// ---------------------------------------------------------------------------
// Fetch pending placeholders (all of them, paged - PostgREST caps at 1,000
// per request by default, so we page in 1k chunks until exhausted).
// ---------------------------------------------------------------------------

async function loadPending(): Promise<PlaceholderRow[]> {
  const statuses = retryFailed ? ['pending', 'failed'] : ['pending']
  const pageSize = 1000
  const all: PlaceholderRow[] = []
  let offset = 0

  for (;;) {
    const q = (admin
      .from('companies')
      .select('id, name, domain, careers_url, ats_type, logo_url, is_active, raw_ats_config')
      .in('raw_ats_config->>source', PLACEHOLDER_SOURCES)
      .in('raw_ats_config->>ats_discovery_status', statuses)
      .is('ats_type', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1) as unknown) as Promise<{
      data: PlaceholderRow[] | null
      error: { message: string } | null
    }>

    const { data, error } = await q
    if (error) throw new Error(`load placeholders: ${error.message}`)
    const rows = data ?? []
    all.push(...rows)

    if (limit && all.length >= limit) return all.slice(0, limit)
    if (rows.length < pageSize) break
    offset += pageSize
  }

  return all
}

// ---------------------------------------------------------------------------
// Discovery helpers
// ---------------------------------------------------------------------------

const LEGAL_SUFFIXES =
  /\b(incorporated|inc|l\.?l\.?c\.?|llp|llp\.|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|solutions|services|systems|consulting|consultants|partners|us|usa|america|americas|north\s+america|na)\b\.?,?/gi

/**
 * Generate multiple plausible public domains for a raw employer name.
 *
 * The single-guess approach in the original implementation failed badly:
 * legacy placeholders stored noisy guesses like `infosyslimited.com` which
 * don't resolve, and there was no fallback. Here we produce a ranked list
 * of candidates per row - stripped short form first, then progressively
 * less aggressive forms, then alternate TLDs - so even bad stored guesses
 * get superseded by better ones the enricher will actually try.
 *
 * Examples:
 *   "INFOSYS LIMITED"           → infosys.com, infosys.io, infosys.co, infosyslimited.com
 *   "TATA CONSULTANCY SERVICES LIMITED" → tataconsultancy.com, tata.com, tcs.com, ...
 *   "Accenture LLP"             → accenture.com, accenture.io, accenturellp.com
 *   "1 EMC LLC"                 → emc.com, 1emc.com, 1emcllc.com
 */
function guessCandidateDomains(name: string): string[] {
  const raw = name.trim().toLowerCase()
  if (!raw) return []

  const stripped = raw.replace(LEGAL_SUFFIXES, ' ').replace(/\s+/g, ' ').trim()
  const words = stripped
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)

  // Insertion-ordered list - order matters! Earlier candidates are
  // preferred because the first successful ATS detection wins. We put
  // high-specificity (full-name) candidates first and short acronyms last
  // to avoid domain-squatter hits like "cf.com" winning over "chime.com".
  const out: string[] = []
  const seen = new Set<string>()
  const add = (label: string | null, tlds: string[] = ['com']) => {
    if (!label || label.length < 2) return
    for (const tld of tlds) {
      const d = `${label}.${tld}`
      if (!seen.has(d)) {
        seen.add(d)
        out.push(d)
      }
    }
  }

  // 1) Full stripped name joined - most specific form. "infosys".
  add(words.join(''))

  // 2) Hyphenated stripped name - "tata-consultancy-services.com".
  if (words.length > 1) add(words.join('-'))

  // 3) Raw slug including legal suffix - catches literal domains like
  //    "somecompanyllc.com" that some small firms actually own.
  const rawSlug = raw.replace(/[^a-z0-9]+/g, '')
  if (rawSlug && rawSlug !== words.join('')) add(rawSlug)

  // 4) First three words collapsed.
  if (words.length > 3) add(words.slice(0, 3).join(''))

  // 5) First two words collapsed - "jp morgan chase" → "jpmorgan".
  if (words.length > 2) add(words.slice(0, 2).join(''))

  // 6) First word alone - only if it's ≥ 4 chars (avoids picking up
  //    `tata.com` or `adp.com` when those are owned by other orgs).
  if (words.length > 1 && words[0].length >= 4) add(words[0])

  // 7) Acronym - ONLY when ≥ 4 letters. Short 2–3 letter acronyms
  //    (`cf.com`, `sri.com`, `rm.com`, `ml.com`, `dbs.com`) are almost
  //    always owned by a different company and cause catastrophic
  //    false positives. Requiring length ≥ 4 cuts the false-positive
  //    rate without losing many real hits.
  if (words.length >= 2) {
    const acronym = words.map((w) => w[0]).join('')
    if (acronym.length >= 4 && acronym.length <= 6) add(acronym)
  }

  // 8) Alt TLDs on the primary stripped form - tech/saas/ai shops.
  add(words.join(''), ['io', 'co', 'ai'])

  return out.slice(0, 10)
}

/**
 * Is the detected `verifiedDomain` plausibly *this* company's domain?
 *
 * The enricher has no way to tell, on its own, whether it landed on the
 * correct domain or on a squatter with the same ATS. We apply a cheap
 * sanity check: the verified domain's root label must share a meaningful
 * substring (≥ 4 chars) with the company name. Short acronyms pass only
 * if they are ≥ 4 chars AND appear as consecutive word initials in the
 * name.
 *
 * Examples:
 *   ("Chime Financial, Inc.", "chime.com")             → true  (shares "chime")
 *   ("Chime Financial, Inc.", "cf.com")                → false (acronym len 2)
 *   ("Rocket Mortgage, LLC",  "rm.com")                → false (acronym len 2)
 *   ("Deutsche Bank Securities", "dbs.com")            → false (acronym len 3)
 *   ("Tata Consultancy Services", "tcs.com")           → false (acronym len 3)
 *   ("GoDaddy.com, LLC",  "gc.com")                    → false (acronym len 2)
 *   ("INFOSYS LIMITED",   "infosys.com")               → true
 *   ("LEXISNEXIS RISK SOLUTIONS", "lexisnexis.com")    → true
 */
function isDomainPlausible(companyName: string, verifiedDomain: string | null): boolean {
  if (!verifiedDomain) return false
  const host = verifiedDomain.toLowerCase().replace(/^www\./, '')
  const rootLabel = host.split('.')[0] ?? ''
  if (!rootLabel) return false

  const nameTokens = companyName
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3) // tokens shorter than 3 chars are noise

  // Substring match: any token ≥ 4 chars appearing inside the root label,
  // OR the root label appearing inside the collapsed name.
  const collapsedName = nameTokens.join('')
  for (const tok of nameTokens) {
    if (tok.length >= 4 && rootLabel.includes(tok)) return true
  }
  if (rootLabel.length >= 4 && collapsedName.includes(rootLabel)) return true

  // Acronym path: only accept if the root label is itself a 4+ letter
  // acronym formed from the name's word initials.
  if (rootLabel.length >= 4 && rootLabel.length <= 6) {
    const acronym = nameTokens.map((w) => w[0]).join('')
    if (acronym === rootLabel) return true
  }

  return false
}

function buildCandidateUrls(
  row: PlaceholderRow
): { urls: string[]; domains: string[] } {
  const domains: string[] = []
  const seenDomains = new Set<string>()
  const addDomain = (d: string | null | undefined) => {
    if (!d) return
    const clean = d
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .trim()
    if (
      !clean ||
      clean.endsWith('.lca-employer') ||
      clean.endsWith('.uscis-employer') ||
      seenDomains.has(clean)
    )
      return
    seenDomains.add(clean)
    domains.push(clean)
  }

  // First: use any stored guess (legacy rows).
  addDomain(row.raw_ats_config?.guessed_domain ?? null)

  // Then: fresh candidates derived from the name (the reliable source).
  for (const d of guessCandidateDomains(row.name)) addDomain(d)

  // Finally: any careers_url we already have (ignore LinkedIn fallback).
  if (
    row.careers_url &&
    !row.careers_url.includes('linkedin.com')
  ) {
    try {
      const parsed = new URL(row.careers_url)
      addDomain(parsed.host)
    } catch {
      /* ignore */
    }
  }

  // Build URLs for each candidate domain. Order matters: try / first (cheap)
  // then /careers and /jobs which tend to host the ATS iframe.
  const urls: string[] = []
  for (const d of domains) {
    urls.push(`https://${d}`)
    urls.push(`https://${d}/careers`)
    urls.push(`https://${d}/jobs`)
  }
  return { urls, domains }
}

function safeOrigin(urlStr: string | null): URL | null {
  if (!urlStr) return null
  try {
    return new URL(urlStr)
  } catch {
    return null
  }
}

async function fetchHtml(urlStr: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs)
  try {
    const response = await fetch(urlStr, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // A realistic desktop Chrome UA. Many corporate careers pages are
        // fronted by WAFs (Cloudflare, Akamai) that silently 403 anything
        // identifying itself as a bot, even when the UA says `compatible`.
        // Using a normal Chrome UA dramatically reduces fetch-failures.
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    })
    if (!response.ok) return null
    const text = await response.text()
    return text.length > 500_000 ? text.slice(0, 500_000) : text
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number
): Promise<T[]> {
  const results: T[] = []
  let idx = 0
  async function worker() {
    while (idx < tasks.length) {
      const current = idx
      idx += 1
      results.push(await tasks[current]())
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, tasks.length) }).map(() =>
      worker()
    )
  )
  return results
}

// ---------------------------------------------------------------------------
// Per-row enrichment
// ---------------------------------------------------------------------------

/** Check whether an HTML page looks like a real careers/jobs page even
 * without a recognizable ATS iframe. Many Fortune-500 companies, banks,
 * and pharma firms run custom HRIS platforms (Workday in-house, SAP
 * SuccessFactors, Oracle HCM, bespoke ATS) that our signature set doesn't
 * cover, but the page itself is still clearly a hiring page.
 *
 * We look for keyword density rather than a single phrase - one false
 * positive phrase ("we're a career-focused firm") shouldn't flip an
 * unrelated page to "custom careers". */
function looksLikeCareersPage(html: string): boolean {
  const text = html.toLowerCase()
  const hits = [
    /\bcareers?\b/,
    /\bjobs?\b/,
    /\bpositions?\b/,
    /\bopenings?\b/,
    /\bapply\s+now\b/,
    /\bjoin\s+(us|our|the\s+team)\b/,
    /\bwe'?re\s+hiring\b/,
    /\bcurrent\s+(openings|opportunities|vacancies)\b/,
    /\bwork\s+(with|for|at)\s+us\b/,
  ].reduce((count, rx) => count + (rx.test(text) ? 1 : 0), 0)
  return hits >= 3
}

type EnrichOutcome =
  | { kind: 'ats-detected'; atsType: string; confidence: string; domain: string; careersUrl: string }
  | { kind: 'custom-careers'; domain: string; careersUrl: string }
  | { kind: 'domain-only'; domain: string }
  | { kind: 'no-match'; guessed: string | null }
  | { kind: 'fetch-failed'; guessed: string | null }

async function updateCompanyWithDomainHandling(
  rowId: string,
  update: Record<string, unknown>,
  verifiedDomain?: string
): Promise<void> {
  const payload = verifiedDomain ? { ...update, domain: verifiedDomain } : update
  const { error } = await admin.from('companies').update(payload as never).eq('id', rowId)
  if (!error) return

  const isDomainConflict =
    Boolean(verifiedDomain) &&
    (error.message.includes('23505') ||
      /duplicate|unique/i.test(error.message))

  if (!isDomainConflict) {
    throw new Error(`company update failed: ${error.message}`)
  }

  const { data: conflictRow } = await admin
    .from('companies')
    .select('id')
    .eq('domain', verifiedDomain!)
    .maybeSingle()

  const existingRaw = (update.raw_ats_config as Record<string, unknown> | undefined) ?? {}
  const fallback = {
    ...update,
    raw_ats_config: {
      ...existingRaw,
      domain_conflict: {
        domain: verifiedDomain,
        conflict_company_id:
          (conflictRow as { id?: string } | null)?.id ?? null,
        noted_at: new Date().toISOString(),
      },
    } as never,
    updated_at: new Date().toISOString(),
  }

  const { error: fallbackError } = await admin
    .from('companies')
    .update(fallback as never)
    .eq('id', rowId)

  if (fallbackError) {
    throw new Error(`company update fallback failed: ${fallbackError.message}`)
  }
}

async function enrichOne(row: PlaceholderRow): Promise<EnrichOutcome> {
  const { urls, domains } = buildCandidateUrls(row)
  const primaryGuess = domains[0] ?? null
  if (urls.length === 0) return { kind: 'no-match', guessed: primaryGuess }

  // As we walk candidate URLs, we track:
  //   - the first plausible verified domain that responded with HTML
  //   - the first careers-looking URL under that domain
  //   - any ATS signature we find along the way (highest wins)
  // That way, even if we don't find an ATS we can still promote the row
  // as a custom-careers match, which covers Fortune-500 / bank / pharma
  // companies whose ATS we don't recognize.
  let detection: {
    atsType: string
    confidence: string
    reasons: string[]
    matchedUrl: string
  } | null = null
  let verifiedOrigin: URL | null = null
  let verifiedCareersUrl: string | null = null

  const deadDomains = new Set<string>()

  for (const candidate of urls) {
    const candidateDomain = (() => {
      try {
        return new URL(candidate).host
      } catch {
        return ''
      }
    })()
    if (candidateDomain && deadDomains.has(candidateDomain)) continue

    // URL-pattern ATS hit (e.g. candidate IS `jobs.lever.co/acme`).
    const urlHit = detectAtsFromUrl(candidate)
    if (urlHit) {
      detection = {
        atsType: urlHit.atsType,
        confidence: urlHit.confidence,
        reasons: ['ATS pattern matched in candidate URL'],
        matchedUrl: candidate,
      }
      break
    }

    const html = await fetchHtml(candidate)
    if (!html) {
      if (candidate === `https://${candidateDomain}`) {
        deadDomains.add(candidateDomain)
      }
      continue
    }

    // A candidate responded. Only trust it if the host is plausibly the
    // right company - otherwise skip entirely (don't even consider it for
    // custom-careers fallback, to avoid activating a squatter domain).
    if (!isDomainPlausible(row.name, candidateDomain)) {
      deadDomains.add(candidateDomain)
      continue
    }

    if (!verifiedOrigin) {
      try {
        verifiedOrigin = new URL(candidate)
      } catch {
        /* ignore */
      }
    }

    if (!verifiedCareersUrl && looksLikeCareersPage(html)) {
      verifiedCareersUrl = candidate
    }

    const htmlHit = detectAtsFromHtml({ url: candidate, html })
    if (htmlHit) {
      detection = {
        atsType: htmlHit.atsType,
        confidence: htmlHit.confidence,
        reasons: htmlHit.reasons,
        matchedUrl: candidate,
      }
      break
    }
  }

  // ----- Decide outcome -----------------------------------------------

  // Strongest signal: ATS detected AND domain is plausible.
  if (detection) {
    const origin = safeOrigin(detection.matchedUrl) ?? verifiedOrigin
    const verifiedDomain = origin?.host ?? primaryGuess ?? ''
    if (!isDomainPlausible(row.name, verifiedDomain)) {
      return { kind: 'fetch-failed', guessed: primaryGuess }
    }
    const careersUrl =
      detection.matchedUrl ??
      (origin ? `${origin.origin}/careers` : row.careers_url ?? '')

    if (!execute) {
      return {
        kind: 'ats-detected',
        atsType: detection.atsType,
        confidence: detection.confidence,
        domain: verifiedDomain,
        careersUrl,
      }
    }

    const shouldActivate =
      detection.confidence === 'high' || detection.confidence === 'medium'
    await updateCompanyWithDomainHandling(
      row.id,
      {
        ats_type: detection.atsType,
        careers_url: careersUrl,
        is_active: shouldActivate,
        logo_url: verifiedDomain
          ? companyLogoUrlFromDomain(verifiedDomain)
          : row.logo_url,
        raw_ats_config: {
          ...(row.raw_ats_config ?? {}),
          guessed_domain: verifiedDomain,
          domain_verified: Boolean(origin),
          ats_discovery_status: 'checked',
          ats_detection: {
            kind: 'ats',
            confidence: detection.confidence,
            reasons: detection.reasons,
            matchedUrl: detection.matchedUrl,
          },
          last_checked_at: new Date().toISOString(),
        } as never,
        updated_at: new Date().toISOString(),
      },
      verifiedDomain || undefined
    )

    return {
      kind: 'ats-detected',
      atsType: detection.atsType,
      confidence: detection.confidence,
      domain: verifiedDomain,
      careersUrl,
    }
  }

  // Second-strongest: we verified the domain AND found a careers-looking
  // page, just no recognizable ATS. Activate with ats_type='custom'.
  if (verifiedOrigin && verifiedCareersUrl) {
    const verifiedDomain = verifiedOrigin.host

    if (!execute) {
      return {
        kind: 'custom-careers',
        domain: verifiedDomain,
        careersUrl: verifiedCareersUrl,
      }
    }

    await updateCompanyWithDomainHandling(
      row.id,
      {
        ats_type: 'custom',
        careers_url: verifiedCareersUrl,
        is_active: true,
        logo_url: companyLogoUrlFromDomain(verifiedDomain),
        raw_ats_config: {
          ...(row.raw_ats_config ?? {}),
          guessed_domain: verifiedDomain,
          domain_verified: true,
          ats_discovery_status: 'checked',
          ats_detection: {
            kind: 'custom-careers',
            confidence: 'low',
            reasons: ['domain verified + careers keywords in page, no ATS signature'],
            matchedUrl: verifiedCareersUrl,
          },
          last_checked_at: new Date().toISOString(),
        } as never,
        updated_at: new Date().toISOString(),
      },
      verifiedDomain
    )

    return {
      kind: 'custom-careers',
      domain: verifiedDomain,
      careersUrl: verifiedCareersUrl,
    }
  }

  // Third: domain responded but we didn't find a careers page. This
  // happens for small consultancies that have a landing page but no
  // jobs section. Record the verified domain so we can get a real logo,
  // but keep the row inactive.
  if (verifiedOrigin) {
    const verifiedDomain = verifiedOrigin.host

    if (!execute) {
      return { kind: 'domain-only', domain: verifiedDomain }
    }

    await updateCompanyWithDomainHandling(
      row.id,
      {
        logo_url: companyLogoUrlFromDomain(verifiedDomain),
        raw_ats_config: {
          ...(row.raw_ats_config ?? {}),
          guessed_domain: verifiedDomain,
          domain_verified: true,
          ats_discovery_status: 'checked',
          ats_detection: {
            kind: 'domain-only',
            confidence: 'none',
            reasons: ['domain resolved but no careers page found'],
            matchedUrl: verifiedOrigin.origin,
          },
          last_checked_at: new Date().toISOString(),
        } as never,
        updated_at: new Date().toISOString(),
      },
      verifiedDomain
    )

    return { kind: 'domain-only', domain: verifiedDomain }
  }

  // Fell through every candidate without verifying a plausible domain.
  return { kind: 'fetch-failed', guessed: primaryGuess }
}

async function markFailed(row: PlaceholderRow): Promise<void> {
  if (!execute) return
  await admin
    .from('companies')
    .update({
      raw_ats_config: {
        ...(row.raw_ats_config ?? {}),
        ats_discovery_status: 'failed',
        last_checked_at: new Date().toISOString(),
      } as never,
    } as never)
    .eq('id', row.id)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    `[enrich] mode=${execute ? 'EXECUTE' : 'dry-run'}  concurrency=${concurrency}  timeout=${fetchTimeoutMs}ms  retryFailed=${retryFailed}${limit ? `  limit=${limit}` : ''}`
  )
  const pending = await loadPending()
  console.log(`[enrich] ${pending.length.toLocaleString()} placeholder(s) to process.\n`)

  if (pending.length === 0) {
    console.log('[enrich] nothing to do. Done.')
    return
  }

  const counters = {
    checked: 0,
    atsDetected: 0,
    customCareers: 0,
    domainOnly: 0,
    noMatch: 0,
    fetchFailed: 0,
    activated: 0,
  }
  const startedAt = Date.now()

  const tasks = pending.map((row) => async () => {
    const outcome = await enrichOne(row)
    counters.checked++

    if (outcome.kind === 'ats-detected') {
      counters.atsDetected++
      if (outcome.confidence === 'high' || outcome.confidence === 'medium') {
        counters.activated++
      }
      console.log(
        `  ✓ ${row.name.slice(0, 44).padEnd(44)}  ats=${outcome.atsType.padEnd(10)} conf=${outcome.confidence.padEnd(6)} ${outcome.domain}`
      )
    } else if (outcome.kind === 'custom-careers') {
      counters.customCareers++
      counters.activated++ // custom-careers always activates
      console.log(
        `  ✓ ${row.name.slice(0, 44).padEnd(44)}  ats=custom     conf=low    ${outcome.domain}`
      )
    } else if (outcome.kind === 'domain-only') {
      counters.domainOnly++
      console.log(
        `  · ${row.name.slice(0, 44).padEnd(44)}  domain-only             ${outcome.domain}`
      )
    } else if (outcome.kind === 'no-match') {
      counters.noMatch++
      await markFailed(row)
    } else {
      counters.fetchFailed++
      await markFailed(row)
    }

    if (counters.checked % 25 === 0) {
      const rate = counters.checked / ((Date.now() - startedAt) / 1000)
      console.log(
        `\n[enrich] ${counters.checked}/${pending.length}  ats=${counters.atsDetected}  custom=${counters.customCareers}  domain=${counters.domainOnly}  activated=${counters.activated}  failed=${counters.fetchFailed}  (~${rate.toFixed(1)} rows/s)\n`
      )
    }
  })

  await runWithConcurrency(tasks, concurrency)

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1)
  console.log('\n[enrich] done.')
  console.log(`[enrich]   processed       = ${counters.checked}`)
  console.log(`[enrich]   ATS detected    = ${counters.atsDetected}`)
  console.log(`[enrich]   custom careers  = ${counters.customCareers}`)
  console.log(`[enrich]   domain only     = ${counters.domainOnly}  (verified but no careers page)`)
  console.log(`[enrich]   activated total = ${counters.activated}`)
  console.log(`[enrich]   no-match        = ${counters.noMatch}`)
  console.log(`[enrich]   fetch-failed    = ${counters.fetchFailed}`)
  console.log(`[enrich]   elapsed         = ${elapsedMin} min`)
  if (!execute) {
    console.log('\n[enrich] dry-run - nothing written. Re-run with --execute to commit.')
  }
}

main().catch((err) => {
  console.error('enrich failed', err)
  process.exit(1)
})

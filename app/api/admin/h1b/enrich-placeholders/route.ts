/**
 * Post-LCA-import placeholder enrichment.
 *
 * LCA-sourced placeholder companies are created with a sentinel domain
 * (`<slug>.lca-employer`), a guessed public domain in
 * `raw_ats_config.guessed_domain`, and `raw_ats_config.ats_discovery_status
 * = 'pending'`. This endpoint walks the pending queue in small batches and
 * tries to discover a real ATS type + careers URL by fetching the guessed
 * domain, re-using the exact detection logic from
 * `scripts/discover-company-ats-live.ts`.
 *
 * Designed to be called repeatedly from the admin UI (e.g. "Discover ATS
 * for next 25 placeholders"). Each call is bounded by `limit` (default 25,
 * max 100) so the request finishes well within Next's serverless timeout.
 *
 * Keeps `is_active = false` when no ATS is discovered - promotion to active
 * is an explicit admin decision. When an ATS is found, the endpoint:
 *   - Sets `ats_type` and updates `careers_url` to the live origin.
 *   - Flips `is_active` to `true` only when confidence is "high" or "medium".
 *   - Marks `raw_ats_config.ats_discovery_status = 'checked'` (or `'failed'`).
 *   - Leaves a `raw_ats_config.last_checked_at` timestamp.
 */

import { NextRequest, NextResponse } from 'next/server'
import { assertAdminAccess } from '@/lib/admin/auth'
import { getPostgresPool } from '@/lib/postgres/server'
import { detectAtsFromHtml } from '@/lib/companies/ats-signatures'
import { detectAtsFromUrl } from '@/lib/companies/detect-ats'
import { companyLogoUrlFromDomain } from '@/lib/companies/logo-url'
import type { Pool } from 'pg'

export const runtime = 'nodejs'
export const maxDuration = 300

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
const FETCH_TIMEOUT_MS = 6000
const CONCURRENCY = 6

const PLACEHOLDER_SOURCES = ['lca_import', 'lca_reconciliation', 'uscis_reconciliation']

type PlaceholderRow = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  ats_type: string | null
  logo_url: string | null
  raw_ats_config: {
    source?: string
    guessed_domain?: string | null
    ats_discovery_status?: 'pending' | 'checked' | 'failed'
    [key: string]: unknown
  } | null
}

type EnrichSummary = {
  checked: number
  discovered: number
  promoted: number
  stillPending: number
  failed: number
  remaining: number
  sample: Array<{
    id: string
    name: string
    atsType: string | null
    confidence: string | null
    guessedDomain: string | null
    status: 'discovered' | 'no-match' | 'fetch-failed'
  }>
}

export async function POST(request: NextRequest) {
  const serviceKey = request.headers.get('x-service-role-key')
  if (serviceKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const access = await assertAdminAccess()
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
  }

  const body = (await request.json().catch(() => ({}))) as {
    limit?: number
    dryRun?: boolean
  }
  const rawLimit = Number(body.limit ?? DEFAULT_LIMIT)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT))
  const dryRun = Boolean(body.dryRun)

  const pool = getPostgresPool()

  const { rows: pending } = await pool.query<PlaceholderRow>(
    `SELECT id, name, domain, careers_url, ats_type, logo_url, raw_ats_config
     FROM companies
     WHERE raw_ats_config->>'source' = ANY($1::text[])
       AND raw_ats_config->>'ats_discovery_status' = 'pending'
       AND ats_type IS NULL
     ORDER BY created_at ASC
     LIMIT $2`,
    [PLACEHOLDER_SOURCES, limit]
  )

  const summary: EnrichSummary = {
    checked: 0,
    discovered: 0,
    promoted: 0,
    stillPending: 0,
    failed: 0,
    remaining: 0,
    sample: [],
  }

  if (pending.length === 0) {
    summary.remaining = await countRemaining(pool)
    return NextResponse.json({ ok: true, dryRun, limit, ...summary })
  }

  const tasks = pending.map((row) => () => enrichOne(row, pool, dryRun, summary))
  await runWithConcurrency(tasks, CONCURRENCY)

  summary.remaining = await countRemaining(pool)
  return NextResponse.json({ ok: true, dryRun, limit, ...summary })
}

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const pool = getPostgresPool()
  const remaining = await countRemaining(pool)
  return NextResponse.json({ remaining })
}

// ---------------------------------------------------------------------------

async function updateCompanyWithDomainHandling(
  pool: Pool,
  rowId: string,
  update: {
    ats_type?: string
    careers_url?: string | null
    is_active?: boolean
    logo_url?: string | null
    raw_ats_config?: Record<string, unknown>
    updated_at?: string
  },
  verifiedDomain?: string
): Promise<void> {
  const payload = verifiedDomain ? { ...update, domain: verifiedDomain } : update
  const cols = Object.keys(payload) as Array<keyof typeof payload>
  const vals = cols.map((k) => {
    const v = payload[k]
    return k === 'raw_ats_config' ? JSON.stringify(v) : v
  })
  const setClauses = cols.map((k, i) =>
    k === 'raw_ats_config' ? `raw_ats_config = $${i + 1}::jsonb` : `${k} = $${i + 1}`
  )
  vals.push(rowId)

  try {
    await pool.query(
      `UPDATE companies SET ${setClauses.join(', ')} WHERE id = $${vals.length}`,
      vals
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isDomainConflict =
      Boolean(verifiedDomain) && /23505|duplicate|unique/i.test(msg)

    if (!isDomainConflict) throw new Error(`enrich update failed: ${msg}`)

    const conflictResult = await pool.query<{ id: string }>(
      `SELECT id FROM companies WHERE domain = $1 LIMIT 1`,
      [verifiedDomain]
    )
    const existingRaw = (update.raw_ats_config as Record<string, unknown> | undefined) ?? {}
    const fallbackConfig = {
      ...existingRaw,
      domain_conflict: {
        domain: verifiedDomain,
        conflict_company_id: conflictResult.rows[0]?.id ?? null,
        noted_at: new Date().toISOString(),
      },
    }
    await pool.query(
      `UPDATE companies
       SET raw_ats_config = $1::jsonb,
           updated_at = $2
       WHERE id = $3`,
      [JSON.stringify(fallbackConfig), new Date().toISOString(), rowId]
    )
  }
}

// ---------------------------------------------------------------------------

async function enrichOne(
  row: PlaceholderRow,
  pool: Pool,
  dryRun: boolean,
  summary: EnrichSummary
): Promise<void> {
  summary.checked++
  const guessed =
    row.raw_ats_config?.guessed_domain ??
    guessFromName(row.name) ??
    null

  const candidateUrls = buildCandidateUrls(guessed, row.careers_url)
  let detection: {
    atsType: string
    confidence: string
    reasons: string[]
    matchedUrl: string | null
  } | null = null

  for (const url of candidateUrls) {
    const urlHit = detectAtsFromUrl(url)
    if (urlHit) {
      detection = {
        atsType: urlHit.atsType,
        confidence: urlHit.confidence,
        reasons: ['ATS pattern matched in candidate URL'],
        matchedUrl: url,
      }
      break
    }
    const html = await fetchHtml(url)
    if (!html) continue
    const htmlHit = detectAtsFromHtml({ url, html })
    if (htmlHit) {
      detection = {
        atsType: htmlHit.atsType,
        confidence: htmlHit.confidence,
        reasons: htmlHit.reasons,
        matchedUrl: url,
      }
      break
    }
  }

  if (!detection) {
    summary.failed++
    summary.sample.push({
      id: row.id,
      name: row.name,
      atsType: null,
      confidence: null,
      guessedDomain: guessed,
      status: candidateUrls.length === 0 ? 'no-match' : 'fetch-failed',
    })
    if (!dryRun) {
      await pool.query(
        `UPDATE companies
         SET raw_ats_config = raw_ats_config || $1::jsonb
         WHERE id = $2`,
        [
          JSON.stringify({
            ats_discovery_status: 'failed',
            last_checked_at: new Date().toISOString(),
          }),
          row.id,
        ]
      )
    }
    return
  }

  summary.discovered++
  const shouldActivate = detection.confidence === 'high' || detection.confidence === 'medium'
  if (shouldActivate) summary.promoted++
  else summary.stillPending++

  const matchedOrigin = safeOrigin(detection.matchedUrl)
  const verifiedDomain = matchedOrigin?.host ?? guessed
  const careersUrl =
    detection.matchedUrl ??
    (matchedOrigin ? `${matchedOrigin.origin}/careers` : row.careers_url)

  summary.sample.push({
    id: row.id,
    name: row.name,
    atsType: detection.atsType,
    confidence: detection.confidence,
    guessedDomain: verifiedDomain,
    status: 'discovered',
  })

  if (dryRun) return

  await updateCompanyWithDomainHandling(
    pool,
    row.id,
    {
      ats_type: detection.atsType,
      careers_url: careersUrl,
      is_active: shouldActivate,
      logo_url: verifiedDomain ? companyLogoUrlFromDomain(verifiedDomain) : row.logo_url,
      raw_ats_config: {
        ...(row.raw_ats_config ?? {}),
        guessed_domain: verifiedDomain,
        domain_verified: Boolean(matchedOrigin),
        ats_discovery_status: 'checked',
        ats_detection: {
          confidence: detection.confidence,
          reasons: detection.reasons,
          matchedUrl: detection.matchedUrl,
        },
        last_checked_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    },
    verifiedDomain ?? undefined
  )
}

async function countRemaining(pool: Pool): Promise<number> {
  const result = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM companies
     WHERE raw_ats_config->>'source' = ANY($1::text[])
       AND raw_ats_config->>'ats_discovery_status' = 'pending'`,
    [PLACEHOLDER_SOURCES]
  )
  return Number(result.rows[0]?.c ?? 0)
}

// ---------------------------------------------------------------------------
// HTTP / discovery helpers
// ---------------------------------------------------------------------------

function buildCandidateUrls(
  guessedDomain: string | null,
  existingCareersUrl: string | null
): string[] {
  const out = new Set<string>()
  if (guessedDomain && !guessedDomain.endsWith('.lca-employer')) {
    const base = `https://${guessedDomain.replace(/^https?:\/\//, '')}`
    out.add(base)
    out.add(`${base}/careers`)
    out.add(`${base}/jobs`)
    out.add(`${base}/careers/`)
  }
  if (existingCareersUrl && !existingCareersUrl.includes('linkedin.com')) {
    try {
      const parsed = new URL(existingCareersUrl)
      out.add(existingCareersUrl)
      out.add(parsed.origin)
      out.add(`${parsed.origin}/careers`)
      out.add(`${parsed.origin}/jobs`)
    } catch {
      // ignore malformed URL
    }
  }
  return [...out]
}

function safeOrigin(url: string | null): URL | null {
  if (!url) return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; HireovenAtsDiscovery/1.0; +https://hireoven.com)',
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
    Array.from({ length: Math.min(maxConcurrency, tasks.length) }).map(() => worker())
  )
  return results
}

function guessFromName(name: string): string | null {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\b(inc|llc|corp|corporation|ltd|limited|co|company|plc|holdings|group)\b\.?,?/g, '')
    .replace(/[^a-z0-9]+/g, '')
  if (!slug || slug.length < 2) return null
  return `${slug}.com`
}

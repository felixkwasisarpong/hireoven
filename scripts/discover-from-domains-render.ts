/**
 * Phase-2 of discover-from-domains: a BROWSER-RENDER ATS resolver.
 *
 * The plain-fetch cron (/api/cron/discover-from-domains) resolves ~8% of
 * real-domain unmatched companies; the rest mostly have JS-rendered careers
 * pages where the ATS link is injected client-side and never appears in static
 * HTML. This script renders those pages with Playwright (so it must run on the
 * harvester box, where Chromium is installed) and feeds the rendered HTML to the
 * same resolver via its `renderHtml` hook.
 *
 * Same enroll rules as the cron: domain → careers page → ATS detect → live-job
 * gate (>=1) → enroll IN PLACE. Uses its own cursor (render_resolve_attempted_at)
 * so repeat runs don't re-render the same misses.
 *
 *   npx tsx scripts/discover-from-domains-render.ts                 # dry run, 200
 *   npx tsx scripts/discover-from-domains-render.ts --apply --limit=400
 *   npx tsx scripts/discover-from-domains-render.ts --random        # unbiased sample
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { discoverCareersUrl, type DiscoveryProbe } from "@/lib/companies/careers-url-discovery"
import { resolveDirectAtsUrl, type RenderHtml } from "@/lib/companies/ats-url-resolver"
import { nameTokens } from "@/lib/companies/domain-resolution"
import type { BrowserContext, Page } from "playwright"

// Node 20.11's undici can throw an uncatchable ERR_INVALID_STATE in a microtask
// on some aborted bodies; benign and patched in newer Node. Swallow it.
process.on("uncaughtException", (e: unknown) => {
  if ((e as { code?: string })?.code === "ERR_INVALID_STATE") return
  throw e
})

const APPLY = process.argv.includes("--apply")
const RANDOM = process.argv.includes("--random")
const intArg = (name: string, dflt: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  const n = a ? Number.parseInt(a.split("=")[1] ?? "", 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : dflt
}
const BATCH = intArg("limit", 200)
const CONCURRENCY = intArg("concurrency", 3)
const NAV_TIMEOUT_MS = 25_000
const UA = "Mozilla/5.0 (compatible; hireoven-discovery/1.0; +https://hireoven.com)"

async function plainFetchHtml(url: string, timeoutMs = 5_000) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), timeoutMs)
  try {
    const res = await fetch(url, { redirect: "follow", signal: c.signal, headers: { "user-agent": UA, accept: "text/html" } })
    const ct = res.headers.get("content-type") ?? ""
    if (!res.ok || !/text\/html|xml/i.test(ct)) {
      try { await res.body?.cancel() } catch { /* ignore */ }
      return { ok: false, status: res.status, html: null }
    }
    return { ok: true, status: res.status, html: (await res.text()).slice(0, 1_500_000) }
  } catch {
    return { ok: false, status: null, html: null }
  } finally {
    clearTimeout(t)
  }
}

async function withPage<T>(context: BrowserContext, fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await context.newPage()
  try {
    return await fn(page)
  } finally {
    try { await page.close() } catch { /* ignore */ }
  }
}

type Company = { id: string; name: string; domain: string }
type MissReason = "no_page" | "no_ats_detected" | "unsupported_ats" | "ats_already_known" | "no_live_jobs" | "name_mismatch" | "error"

async function resolveOne(
  pool: ReturnType<typeof getPostgresPool>,
  context: BrowserContext,
  co: Company,
  counts: { rendered: number; ats: number; jobs: number; enrolled: number; miss: Record<MissReason, number> },
  hits: string[]
): Promise<void> {
  const renderHtml: RenderHtml = (url) =>
    withPage(context, async (page) => {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
        try { await page.waitForLoadState("networkidle", { timeout: 3_000 }) } catch { /* keep going */ }
        await page.waitForTimeout(600)
        return await page.content()
      } catch {
        return null
      }
    })

  try {
    // 1. find a careers page cheaply (plain fetch); fall back to the homepage so
    //    the render step still has something to scan.
    const probe: DiscoveryProbe = ({ url }) => plainFetchHtml(url)
    const careers = await discoverCareersUrl({ domain: co.domain, probe, maxAttempts: 5 })
    const targetUrl = careers.confidence !== "none" && careers.url ? careers.url : `https://${co.domain}`

    // 2. resolve WITH render — this is the phase-2 advantage over the cron
    const resolved = await resolveDirectAtsUrl(targetUrl, { companyName: co.name, renderHtml })
    if (!resolved) { counts.miss.no_ats_detected += 1; return }
    counts.rendered += 1

    const det = detectAdapter(resolved.directUrl)
    if (!det) { counts.miss.unsupported_ats += 1; return }
    counts.ats += 1
    const ats = det.adapter.name
    const slug = det.slug
    const careersUrl = canonicalCareersUrl(ats, slug) ?? resolved.directUrl

    // 2b. STRICT name-match gate. The render pass over-resolves: a name-slug probe
    // or a stray link can land on a DIFFERENT company's board (e.g. "Skylight" →
    // Velux's Workday), which would enroll someone else's jobs under this company.
    // Require a company-name token (>=3 chars) to appear in the ATS slug or its
    // host before we trust the match. Intentionally strict — we'd rather skip a
    // real board than enrol a mis-attributed one.
    const atsHost = (() => { try { return new URL(resolved.directUrl).hostname } catch { return "" } })()
    const toks = nameTokens(co.name).filter((t) => t.length >= 3)
    const hay = `${slug} ${atsHost}`.toLowerCase()
    if (!(toks.length > 0 && toks.some((t) => hay.includes(t)))) {
      counts.miss.name_mismatch += 1
      return
    }

    // 3. dedup against a board another company already owns
    const dup = await pool.query<{ id: string }>(
      `SELECT id FROM companies WHERE ats_type=$1 AND lower(ats_identifier)=lower($2) AND id<>$3 LIMIT 1`,
      [ats, slug, co.id]
    )
    if (dup.rows[0]) {
      counts.miss.ats_already_known += 1
      if (APPLY) {
        await pool.query(
          `UPDATE companies SET duplicate_of_company_id=$2, updated_at=now() WHERE id=$1 AND duplicate_of_company_id IS NULL`,
          [co.id, dup.rows[0].id]
        ).catch(() => {})
      }
      return
    }

    // 4. job-presence gate
    let jobCount = 0
    try {
      jobCount = (await det.adapter.fetchJobs({ slug, ctx: { etag: null, lastModified: null, timeoutMs: 8_000 } })).jobs.length
    } catch { jobCount = 0 }
    if (jobCount === 0) { counts.miss.no_live_jobs += 1; return }
    counts.jobs += 1
    hits.push(`  ${co.name.slice(0, 26).padEnd(26)} ${ats.padEnd(14)} ${jobCount} jobs  (${co.domain})`)

    // 5. enroll in place
    if (!APPLY) return
    const rawConfig = JSON.stringify({
      resolved_via: "domain_render",
      resolved_source: resolved.source,
      discovered_job_count: jobCount,
      resolved_at: new Date().toISOString(),
    })
    const r = await pool.query(
      `UPDATE companies
          SET ats_type=$2, ats_identifier=$3, careers_url=$4, direct_ats_url=$5,
              direct_ats_provider=$6, direct_ats_identifier=$7,
              is_active=true, status='active',
              freshness_tier=COALESCE(freshness_tier,'tier_2'),
              next_harvest_at=now(),
              raw_ats_config=COALESCE(raw_ats_config,'{}'::jsonb) || $8::jsonb,
              updated_at=now()
        WHERE id=$1 AND ats_type IS NULL`,
      [co.id, ats, slug, careersUrl, resolved.directUrl, resolved.provider, resolved.identifier, rawConfig]
    )
    if (r.rowCount && r.rowCount > 0) counts.enrolled += 1
  } catch {
    counts.miss.error += 1
  }
}

async function main() {
  const pool = getPostgresPool()
  const predicate = `
       ats_type IS NULL
       AND render_resolve_attempted_at IS NULL
       AND duplicate_of_company_id IS NULL
       AND domain LIKE '%.%' AND domain NOT ILIKE '%.placeholder'
       AND domain NOT ILIKE 'adzuna-%' AND domain NOT ILIKE 'dice-%'
       AND domain NOT ILIKE '%.invalid' AND domain !~* '-discovered$'
       AND domain !~* '\\.(builtin|glassdoor)-discovery$'`
  const orderBy = RANDOM ? "random()" : "job_count DESC NULLS LAST"

  // --apply claims the batch atomically: a single-column CTE feeds the UPDATE
  // (Postgres rejects `id IN (SELECT id, name, domain …)`), and FOR UPDATE SKIP
  // LOCKED lets parallel runs claim disjoint rows. Dry-run just reads.
  const { rows: batch } = APPLY
    ? await pool.query<Company>(
        `WITH claimed AS (
           SELECT id FROM companies
            WHERE ${predicate}
            ORDER BY ${orderBy}
            LIMIT $1
            FOR UPDATE SKIP LOCKED
         )
         UPDATE companies c SET render_resolve_attempted_at = now()
           FROM claimed
          WHERE c.id = claimed.id
          RETURNING c.id, c.name, c.domain`,
        [BATCH]
      )
    : await pool.query<Company>(
        `SELECT id, name, domain FROM companies
          WHERE ${predicate}
          ORDER BY ${orderBy}
          LIMIT $1`,
        [BATCH]
      )

  console.log(`${APPLY ? "claimed" : "sample"}: ${batch.length} real-domain unmatched companies  (render resolver, concurrency ${CONCURRENCY})\n`)
  if (batch.length === 0) { await pool.end(); return }

  const { chromium } = await import("playwright")
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ userAgent: UA, locale: "en-US", viewport: { width: 1440, height: 900 } })
  // Skip heavy assets — we only need the DOM/HTML for ATS-link detection.
  await context.route("**/*", (route) => {
    const t = route.request().resourceType()
    return t === "image" || t === "font" || t === "media" ? route.abort() : route.continue()
  })

  const counts = { rendered: 0, ats: 0, jobs: 0, enrolled: 0, miss: { no_page: 0, no_ats_detected: 0, unsupported_ats: 0, ats_already_known: 0, no_live_jobs: 0, name_mismatch: 0, error: 0 } as Record<MissReason, number> }
  const hits: string[] = []
  const limit = pLimit(CONCURRENCY)

  try {
    await Promise.all(batch.map((co) => limit(() => resolveOne(pool, context, co, counts, hits))))
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  const pct = (n: number) => `${((n / batch.length) * 100).toFixed(0)}%`
  console.log(`ATS detected (via render): ${counts.ats}/${batch.length}  (${pct(counts.ats)})`)
  console.log(`>=1 live job             : ${counts.jobs}/${batch.length}  (${pct(counts.jobs)})  <- enrollable`)
  console.log(`enrolled                 : ${APPLY ? counts.enrolled : "(dry run)"}`)
  console.log(`dedup (board already known): ${counts.miss.ats_already_known}`)
  if (hits.length) {
    console.log(`\n${APPLY ? "enrolled" : "would-enroll"} sample:`)
    for (const h of hits.slice(0, 30)) console.log(h)
  }
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })

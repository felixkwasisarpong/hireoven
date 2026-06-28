/**
 * Read-only: sizes the "custom careers site" opportunity (companies with a real
 * domain but no third-party ATS). For each sampled company it renders the
 * careers page once and buckets it:
 *   ats     - a supported ATS is detectable (already covered by phase-1/2)
 *   jsonld  - no ATS, but the page carries schema.org JobPosting JSON-LD
 *             (high-yield, structured — the realistic custom-crawl path)
 *   neither - careers page exists but no ATS and no JSON-LD (generic scrape only)
 *   no_page - couldn't even find/render a careers page
 *
 *   npx tsx scripts/measure-custom-careers-yield.ts --random --n=40
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"
import { discoverCareersUrl, type DiscoveryProbe } from "@/lib/companies/careers-url-discovery"
import { resolveDirectAtsUrl } from "@/lib/companies/ats-url-resolver"
import { extractJsonLdBlocks, mapJsonLdToHarvestedJobs } from "@/lib/harvester/adapters/_json-ld"
import type { BrowserContext, Page } from "playwright"

process.on("uncaughtException", (e: unknown) => {
  if ((e as { code?: string })?.code === "ERR_INVALID_STATE") return
  throw e
})

const RANDOM = process.argv.includes("--random")
const N = (() => {
  const a = process.argv.find((x) => x.startsWith("--n="))
  const n = a ? Number.parseInt(a.split("=")[1] ?? "", 10) : 40
  return Number.isFinite(n) && n > 0 ? n : 40
})()
const UA = "Mozilla/5.0 (compatible; hireoven-discovery/1.0; +https://hireoven.com)"

async function plainFetchHtml(url: string, timeoutMs = 5_000) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), timeoutMs)
  try {
    const res = await fetch(url, { redirect: "follow", signal: c.signal, headers: { "user-agent": UA, accept: "text/html" } })
    const ct = res.headers.get("content-type") ?? ""
    if (!res.ok || !/text\/html|xml/i.test(ct)) { try { await res.body?.cancel() } catch {} ; return { ok: false, status: res.status, html: null } }
    return { ok: true, status: res.status, html: (await res.text()).slice(0, 2_000_000) }
  } catch { return { ok: false, status: null, html: null } } finally { clearTimeout(t) }
}

async function withPage<T>(ctx: BrowserContext, fn: (p: Page) => Promise<T>): Promise<T> {
  const page = await ctx.newPage()
  try { return await fn(page) } finally { try { await page.close() } catch {} }
}

async function renderPage(ctx: BrowserContext, url: string): Promise<string | null> {
  return withPage(ctx, async (page) => {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 })
      try { await page.waitForLoadState("networkidle", { timeout: 3_000 }) } catch {}
      await page.waitForTimeout(600)
      return await page.content()
    } catch { return null }
  })
}

async function main() {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ id: string; name: string; domain: string }>(
    `SELECT id, name, domain FROM companies
      WHERE ats_type IS NULL AND duplicate_of_company_id IS NULL
        AND domain LIKE '%.%' AND domain NOT ILIKE '%.placeholder'
        AND domain NOT ILIKE 'adzuna-%' AND domain NOT ILIKE 'dice-%'
        AND domain NOT ILIKE '%.invalid' AND domain !~* '-discovered$'
        AND domain !~* '\\.(builtin|glassdoor)-discovery$'
      ORDER BY ${RANDOM ? "random()" : "job_count DESC NULLS LAST"} LIMIT $1`,
    [N]
  )
  console.log(`sample: ${rows.length} real-domain unmatched companies\n`)

  const { chromium } = await import("playwright")
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ userAgent: UA, locale: "en-US", viewport: { width: 1440, height: 900 } })
  await ctx.route("**/*", (r) => { const t = r.request().resourceType(); return t === "image" || t === "font" || t === "media" ? r.abort() : r.continue() })

  const buckets = { ats: 0, jsonld: 0, neither: 0, no_page: 0 }
  const jsonldHits: string[] = []
  const limit = pLimit(3)

  await Promise.all(rows.map((co) => limit(async () => {
    try {
      const probe: DiscoveryProbe = ({ url }) => plainFetchHtml(url)
      const careers = await discoverCareersUrl({ domain: co.domain, probe, maxAttempts: 5 })
      const targetUrl = careers.confidence !== "none" && careers.url ? careers.url : `https://${co.domain}`
      const html = await renderPage(ctx, targetUrl)
      if (!html) { buckets.no_page += 1; return }

      // ATS? (reuse the single render via a renderHtml closure)
      const resolved = await resolveDirectAtsUrl(targetUrl, { companyName: co.name, renderHtml: async () => html })
      if (resolved && detectAdapter(resolved.directUrl)) { buckets.ats += 1; return }

      // JSON-LD JobPosting on the careers page?
      const jobs = mapJsonLdToHarvestedJobs(extractJsonLdBlocks(html), { sourceAts: "jsonld", fallbackUrl: targetUrl })
      if (jobs.length > 0) {
        buckets.jsonld += 1
        jsonldHits.push(`  ${co.name.slice(0, 26).padEnd(26)} ${jobs.length} JobPosting(s)  (${co.domain})`)
        return
      }
      buckets.neither += 1
    } catch { buckets.no_page += 1 }
  })))

  await ctx.close().catch(() => {}); await browser.close().catch(() => {})

  const pct = (n: number) => `${((n / rows.length) * 100).toFixed(0)}%`
  console.log(`ats     : ${buckets.ats}/${rows.length}  (${pct(buckets.ats)})   already covered by phase-1/2`)
  console.log(`jsonld  : ${buckets.jsonld}/${rows.length}  (${pct(buckets.jsonld)})   <- custom-crawl unlock (structured)`)
  console.log(`neither : ${buckets.neither}/${rows.length}  (${pct(buckets.neither)})   generic scrape only`)
  console.log(`no_page : ${buckets.no_page}/${rows.length}  (${pct(buckets.no_page)})`)
  if (jsonldHits.length) { console.log("\njson-ld sample:"); for (const h of jsonldHits.slice(0, 25)) console.log(h) }
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })

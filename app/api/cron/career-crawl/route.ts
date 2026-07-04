import { NextRequest, NextResponse } from "next/server"
import pLimit from "p-limit"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { resolveDirectAtsUrl, type RenderHtml } from "@/lib/companies/ats-url-resolver"
import { crawlCareersPage, type CrawlTarget } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"

export const runtime = "nodejs"

const SUPPORTED_FOR_CRAWL = new Set(["greenhouse", "lever", "ashby", "smartrecruiters", "workday", "icims"])
const FULL_CRAWL_CONCURRENCY = Math.max(1, Number.parseInt(process.env.CRAWLER_COMPANY_CONCURRENCY ?? "4", 10))
const CRAWL_ALLOWED_SQL = "COALESCE((raw_ats_config->>'crawl_allowed')::boolean, true) = true"

type Mode = "crawl" | "resolve" | "deep" | "full"

async function loadPlaywrightRenderer(): Promise<{ render: RenderHtml; close: () => Promise<void> } | null> {
  try {
    const { chromium } = await import("playwright")
    const browser = await chromium.launch({ headless: true })
    const render: RenderHtml = async (url) => {
      let context, page
      try {
        context = await browser.newContext({
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          locale: "en-US",
          viewport: { width: 1280, height: 900 },
        })
        page = await context.newPage()
        await page.route("**/*", (route) => {
          const t = route.request().resourceType()
          if (t === "image" || t === "media" || t === "font") return route.abort()
          return route.continue()
        })
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 18_000 })
        try { await page.waitForLoadState("networkidle", { timeout: 4000 }) } catch {}
        return await page.content()
      } catch {
        return null
      } finally {
        try { await page?.close() } catch {}
        try { await context?.close() } catch {}
      }
    }
    return { render, close: async () => { try { await browser.close() } catch {} } }
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const mode = (url.searchParams.get("mode") ?? "crawl") as Mode
  const limit = Math.max(10, Number(url.searchParams.get("limit") ?? "500"))
  const companyId = url.searchParams.get("companyId")

  const pool = getPostgresPool()
  const started = Date.now()
  const stats = { resolved: 0, jobs: 0, companies: 0, errors: 0 }

  if (mode === "crawl" || mode === "resolve" || mode === "deep") {
    // Pick companies whose direct_ats_url is missing OR stale (>7 days for direct, immediately for crawl-only).
    const staleCutoff = mode === "crawl" ? "1 hour" : "7 days"
    const needsResolve = mode !== "crawl"

    if (needsResolve) {
      const { rows } = await pool.query<{ id: string; name: string; ats_type: string; careers_url: string }>(
        `SELECT id, name, ats_type, careers_url
         FROM companies
         WHERE ats_type IN ('greenhouse','lever','ashby','smartrecruiters','workday')
           AND ${CRAWL_ALLOWED_SQL}
           AND (direct_ats_url IS NULL OR direct_ats_url_resolved_at < NOW() - INTERVAL '${staleCutoff}')
         ORDER BY direct_ats_url_resolved_at NULLS FIRST
         LIMIT $1`,
        [limit]
      )

      const renderer = mode === "deep" ? await loadPlaywrightRenderer() : null
      try {
        for (const c of rows) {
          try {
            const result = await resolveDirectAtsUrl(c.careers_url, {
              atsType: c.ats_type,
              companyName: c.name,
              renderHtml: renderer?.render ?? null,
            })
            if (result) {
              stats.resolved++
              await pool.query(
                `UPDATE companies SET direct_ats_url = $1, direct_ats_url_resolved_at = NOW(),
                                       direct_ats_provider = $2, direct_ats_identifier = $3
                 WHERE id = $4`,
                [result.directUrl, result.provider, result.identifier, c.id]
              )
            } else {
              await pool.query(
                `UPDATE companies SET direct_ats_url_resolved_at = NOW() WHERE id = $1`,
                [c.id]
              )
            }
          } catch {
            stats.errors++
          }
        }
      } finally {
        await renderer?.close()
      }
    }

    // Crawl: pull jobs from cached direct URLs
    const crawlParams: Array<unknown> = [[...SUPPORTED_FOR_CRAWL], limit]
    let crawlWhere = `WHERE direct_ats_url IS NOT NULL
         AND direct_ats_provider = ANY($1)
         AND ${CRAWL_ALLOWED_SQL}
         AND (last_crawled_at IS NULL OR last_crawled_at < NOW() - INTERVAL '6 hours')`
    if (companyId) {
      crawlWhere += ` AND id = $3`
      crawlParams.push(companyId)
    }
    const { rows: crawlRows } = await pool.query<{
      id: string
      name: string
      direct_ats_url: string
      direct_ats_provider: string
      direct_ats_identifier: string | null
      domain: string | null
      last_crawled_at: Date | null
    }>(
      `SELECT id, name, direct_ats_url, direct_ats_provider, direct_ats_identifier, domain, last_crawled_at
       FROM companies
       ${crawlWhere}
       ORDER BY last_crawled_at NULLS FIRST
       LIMIT $2`,
      crawlParams
    )

    for (const c of crawlRows) {
      try {
        const result = await crawlCareersPage({
          id: c.id,
          companyName: c.name,
          atsType: c.direct_ats_provider,
          atsIdentifier: c.direct_ats_identifier,
          careersUrl: c.direct_ats_url,
          domain: c.domain,
          lastCrawledAt: c.last_crawled_at,
        })
        await persistCrawlJobs({
          companyId: c.id,
          crawledAt: result.crawledAt,
          jobs: result.jobs,
          sourceUrl: result.url,
          normalizedUrl: result.normalizedUrl,
          diagnostics: result.diagnostics,
        })
        stats.companies++
        stats.jobs += result.jobs.length
        await pool.query(`UPDATE companies SET last_crawled_at = NOW() WHERE id = $1`, [c.id])
      } catch {
        stats.errors++
      }
    }
  }

  // ── Full crawl: all active companies, deactivate persistent failures ──────
  const errored: { id: string; name: string; reason: string }[] = []

  if (mode === "full") {
    const { rows: allCompanies } = await pool.query<{
      id: string
      name: string
      careers_url: string
      ats_type: string | null
      ats_identifier: string | null
      domain: string | null
      last_crawled_at: Date | null
    }>(
      `SELECT id, name, careers_url, ats_type, ats_identifier, domain, last_crawled_at
       FROM companies
       WHERE is_active = true
         AND ${CRAWL_ALLOWED_SQL}${companyId ? " AND id = $1" : ""}
       ORDER BY last_crawled_at NULLS FIRST`,
      companyId ? [companyId] : []
    )

    const limit = pLimit(FULL_CRAWL_CONCURRENCY)

    await Promise.all(
      allCompanies.map((company) =>
        limit(async () => {
          const target: CrawlTarget = {
            id: company.id,
            companyName: company.name,
            careersUrl: company.careers_url,
            lastCrawledAt: company.last_crawled_at ? new Date(company.last_crawled_at) : null,
            atsType: company.ats_type ?? null,
            atsIdentifier: company.ats_identifier ?? null,
          }

          try {
            const result = await crawlCareersPage(target)
            await persistCrawlJobs({
              companyId: company.id,
              crawledAt: result.crawledAt,
              jobs: result.jobs,
              sourceUrl: result.url,
              normalizedUrl: result.normalizedUrl,
              diagnostics: result.diagnostics,
            })
            await pool.query(`UPDATE companies SET last_crawled_at = NOW() WHERE id = $1`, [company.id])
            stats.companies++
            stats.jobs += result.jobs.length
          } catch (err) {
            stats.errors++
            const reason = err instanceof Error ? err.message : String(err)
            // Do NOT deactivate on a careers-page crawl error. This is a
            // SECONDARY crawl of the branded careers site, which fails
            // transiently all the time (timeout / WAF / rate-limit / network
            // blip). These companies are harvested from their ATS API by the
            // main harvester, which — together with purge-dead-crawled (needs
            // repeated empty crawls + zero jobs) — is the sole owner of
            // liveness. Killing a company here on one flaky fetch dark-holed
            // ~2k boards that were live the whole time. Just record + move on.
            await pool.query(`UPDATE companies SET last_crawled_at = NOW() WHERE id = $1`, [company.id])
            errored.push({ id: company.id, name: company.name, reason: reason.slice(0, 200) })
          }
        })
      )
    )
  }

  return NextResponse.json({
    ok: true,
    mode,
    durationMs: Date.now() - started,
    ...stats,
    errored: errored.length > 0 ? errored : undefined,
    message: mode === "full"
      ? `[full] crawled ${stats.companies} companies → ${stats.jobs} jobs, errored ${errored.length} (not deactivated)`
      : `[${mode}] resolved ${stats.resolved}, crawled ${stats.companies} companies → ${stats.jobs} jobs`,
  })
}

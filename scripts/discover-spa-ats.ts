/**
 * Playwright-based ATS detection for JS-rendered careers pages.
 *
 * Many enterprise career sites (7-Eleven, Spectrum, Veeva, Disney, Citi, HP)
 * are React/SPA pages — the actual ATS URL is only present in the DOM after
 * client-side hydration. Static-HTML scrapers (discover-company-ats-live,
 * backfill-workday-ats-identifier --resolve-missing) all miss these.
 *
 *   npx tsx scripts/discover-spa-ats.ts                    # dry-run, top 30 by job count
 *   npx tsx scripts/discover-spa-ats.ts --execute
 *   npx tsx scripts/discover-spa-ats.ts --execute --limit=100 --concurrency=2
 *   npx tsx scripts/discover-spa-ats.ts --execute --include-typed   # also re-check companies with existing ats_type
 *
 * Per company:
 *   1. Skip LinkedIn search URLs (no real careers page) and ats_identifier
 *      already set (unless --include-typed).
 *   2. Open careers_url in Chromium, wait for network idle.
 *   3. Run detectAdapter() against the final URL AND every URL in the rendered
 *      DOM; pick the first match.
 *   4. If adapter matched, update companies.ats_type / ats_identifier /
 *      careers_url (canonical form). Otherwise log and skip.
 */

import { loadEnvConfig } from "@next/env"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright"
import pLimit from "p-limit"
import { detectAdapter, type AtsName } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")
const includeTyped = args.includes("--include-typed")
const headful = args.includes("--headful")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "30", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "2", 10))
const pageTimeoutMs = Math.max(5_000, Number.parseInt(getArg("--page-timeout-ms=") ?? "25000", 10))

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

type CompanyRow = {
  id: string
  name: string
  careers_url: string
  ats_type: string | null
  ats_identifier: string | null
}

async function loadCandidates(): Promise<CompanyRow[]> {
  const pool = getPostgresPool()
  const where = includeTyped
    ? "(c.ats_identifier IS NULL OR c.ats_type IS NULL)"
    : "c.ats_type IS NULL AND c.ats_identifier IS NULL"
  const { rows } = await pool.query<CompanyRow & { job_count: number }>(
    `SELECT c.id, c.name, c.careers_url, c.ats_type, c.ats_identifier,
            COALESCE(jc.cnt, 0) AS job_count
       FROM companies c
       LEFT JOIN (
         SELECT company_id, COUNT(*)::int AS cnt
           FROM jobs
          WHERE is_active = true AND source_ats IS NULL
          GROUP BY company_id
       ) jc ON jc.company_id = c.id
      WHERE ${where}
        AND c.status = 'active'
        AND c.duplicate_of_company_id IS NULL
        AND c.careers_url IS NOT NULL
        AND c.careers_url NOT ILIKE '%linkedin.com%'
        AND c.careers_url NOT ILIKE 'https://www.linkedin.com%'
      ORDER BY job_count DESC NULLS LAST, c.updated_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  )
  return rows
}

type Detection = {
  atsType: AtsName
  slug: string
  canonical: string
  source: "final-url" | "dom-url"
}

// Generic slugs that are almost always vendor-internal links (account, signin,
// help pages) rather than real customer boards. ATS detectors are happy to
// accept these because they're syntactically valid slugs, but they're never
// real careers boards.
const SUSPICIOUS_SLUGS = new Set([
  "my", "me", "us", "go", "app", "api", "www", "jobs", "job", "careers",
  "career", "account", "login", "signin", "help", "support", "embed",
  "search", "home", "test", "demo", "info", "about", "blog", "status",
])

function isLikelyRealCustomerSlug(atsType: AtsName, slug: string): boolean {
  const head = slug.split(":")[0].toLowerCase()
  if (head.length < 3) return false
  if (SUSPICIOUS_SLUGS.has(head)) return false
  return true
}

async function detectFromPage(page: Page, careersUrl: string): Promise<Detection | null> {
  try {
    await page.goto(careersUrl, {
      waitUntil: "domcontentloaded",
      timeout: pageTimeoutMs,
    })
  } catch (err) {
    // Try once more with a softer wait condition.
    try {
      await page.goto(careersUrl, { waitUntil: "load", timeout: pageTimeoutMs })
    } catch {
      return null
    }
  }

  // Give the SPA time to hydrate and any client-side redirects to fire.
  try {
    await page.waitForLoadState("networkidle", { timeout: 8_000 })
  } catch {
    // Many enterprise sites never reach networkidle — fall through with what loaded.
  }

  const finalUrl = page.url()
  const directHit = detectAdapter(finalUrl)
  if (directHit) {
    const atsType = directHit.adapter.name as AtsName
    if (isLikelyRealCustomerSlug(atsType, directHit.slug)) {
      const canonical = canonicalCareersUrl(atsType, directHit.slug)
      if (canonical) {
        return { atsType, slug: directHit.slug, canonical, source: "final-url" }
      }
    }
  }

  // Collect every URL referenced in the rendered DOM — anchors, scripts, iframes,
  // and the raw HTML (catches inline JS configs).
  const urls = await page.evaluate(() => {
    const out = new Set<string>()
    document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      const v = a.getAttribute("href")
      if (v) out.add(v)
    })
    document.querySelectorAll<HTMLIFrameElement>("iframe[src]").forEach((f) => {
      const v = f.getAttribute("src")
      if (v) out.add(v)
    })
    document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => {
      const v = s.getAttribute("src")
      if (v) out.add(v)
    })
    // Inline script content may contain a hard-coded ATS URL
    document.querySelectorAll("script:not([src])").forEach((s) => {
      const txt = s.textContent ?? ""
      const matches = txt.match(/https?:\/\/[^\s"'<>]+/g)
      if (matches) for (const m of matches) out.add(m)
    })
    return [...out]
  })

  const html = await page.content()
  const htmlUrls = html.match(/https?:\/\/[^\s"'<>(){}\\^`]+/g) ?? []
  const allUrls = [...new Set([...urls, ...htmlUrls])]

  for (const raw of allUrls) {
    const url = raw.replace(/[.,;:!?)\]}>'"]+$/, "")
    const hit = detectAdapter(url)
    if (!hit) continue
    const atsType = hit.adapter.name as AtsName
    if (!isLikelyRealCustomerSlug(atsType, hit.slug)) continue
    const canonical = canonicalCareersUrl(atsType, hit.slug)
    if (!canonical) continue
    return { atsType, slug: hit.slug, canonical, source: "dom-url" }
  }

  return null
}

async function applyUpdate(
  companyId: string,
  detection: Detection,
  scheduleNow: boolean
): Promise<void> {
  const pool = getPostgresPool()
  const scheduleSql = scheduleNow ? ", next_harvest_at = now()" : ""
  await pool.query(
    `UPDATE companies
        SET ats_type = $1,
            ats_identifier = $2,
            careers_url = $3,
            updated_at = now()
            ${scheduleSql}
      WHERE id = $4`,
    [detection.atsType, detection.slug, detection.canonical, companyId]
  )
}

async function main() {
  console.log(
    `[discover-spa-ats] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} concurrency=${concurrency} includeTyped=${includeTyped} headful=${headful}`
  )

  const candidates = await loadCandidates()
  console.log(`[discover-spa-ats] loaded ${candidates.length} candidates`)
  if (candidates.length === 0) {
    await getPostgresPool().end()
    return
  }

  const browser: Browser = await chromium.launch({ headless: !headful })
  const context: BrowserContext = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  })

  let detected = 0
  let missed = 0
  let updated = 0
  const byAts = new Map<string, number>()

  const limiter = pLimit(concurrency)
  await Promise.all(
    candidates.map((company) =>
      limiter(async () => {
        const page = await context.newPage()
        // Block heavy assets to speed things up — we only care about scripts/HTML.
        await page.route("**/*", (route) => {
          const t = route.request().resourceType()
          if (t === "image" || t === "media" || t === "font") return route.abort()
          return route.continue()
        })
        try {
          const detection = await detectFromPage(page, company.careers_url)
          if (detection) {
            detected += 1
            byAts.set(detection.atsType, (byAts.get(detection.atsType) ?? 0) + 1)
            console.log(
              `[discover-spa-ats] HIT  ${company.name} -> ${detection.atsType}:${detection.slug} (${detection.source})`
            )
            if (!dryRun) {
              await applyUpdate(company.id, detection, true)
              updated += 1
            }
          } else {
            missed += 1
            console.log(`[discover-spa-ats] miss ${company.name} (${company.careers_url})`)
          }
        } catch (err) {
          missed += 1
          console.warn(
            `[discover-spa-ats] err  ${company.name}: ${err instanceof Error ? err.message : String(err)}`
          )
        } finally {
          await page.close().catch(() => {})
        }
      })
    )
  )

  await context.close()
  await browser.close()

  console.log(
    `[discover-spa-ats] detected=${detected} missed=${missed} updates ${dryRun ? "would apply" : "applied"}: ${dryRun ? detected : updated}`
  )
  console.log(`[discover-spa-ats] by ATS:`, Object.fromEntries(byAts))

  await getPostgresPool().end()
}

main().catch((err) => {
  console.error("[discover-spa-ats] fatal:", err)
  process.exit(1)
})

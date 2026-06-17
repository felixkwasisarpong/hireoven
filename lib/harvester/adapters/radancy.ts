/**
 * Radancy / TalentBrew adapter.
 *
 * Radancy (formerly TMP Worldwide) powers career sites for many large
 * employers (L3Harris, Northrop Grumman, Raytheon, etc.). The platform
 * exposes a JSON search API that returns paginated HTML fragments; each
 * fragment contains structured job cards with title, location, and a
 * deep-link URL. Individual job pages embed schema.org JobPosting JSON-LD
 * which we fetch for descriptions, with a per-run cap to avoid hammering.
 *
 * Configuration (companies table):
 *   ats_type    = 'radancy'
 *   careers_url = the company's Radancy careers base URL
 *                 (e.g. 'https://careers.l3harris.com')
 *   ats_identifier = optional override base URL (falls back to careers_url)
 *
 * Environment tunables:
 *   HARVESTER_RADANCY_MAX_PAGES         (default 50; 100 jobs/page)
 *   HARVESTER_RADANCY_PAGE_DELAY_MS     (default 400)
 *   HARVESTER_RADANCY_DETAIL_BUDGET     (default 60; detail fetches per run)
 *   HARVESTER_RADANCY_DETAIL_DELAY_MS   (default 200)
 */

import {
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import {
  fetchHtmlConditional,
  extractJsonLdBlocks,
  mapJsonLdToHarvestedJobs,
} from "@/lib/harvester/adapters/_json-ld"
import { harvesterFetch } from "@/lib/harvester/http-agent"

// ── Env tunables ─────────────────────────────────────────────────────────────

function intEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}

const MAX_PAGES      = intEnv("HARVESTER_RADANCY_MAX_PAGES", 50, 1)
const PAGE_DELAY_MS  = intEnv("HARVESTER_RADANCY_PAGE_DELAY_MS", 400, 0)
const DETAIL_BUDGET  = intEnv("HARVESTER_RADANCY_DETAIL_BUDGET", 60, 0)
const DETAIL_DELAY_MS = intEnv("HARVESTER_RADANCY_DETAIL_DELAY_MS", 200, 0)

// ── Types ─────────────────────────────────────────────────────────────────────

type ListingJob = {
  jobId: string
  title: string
  location: string | undefined
  applyPath: string // relative, e.g. /en/job/city/slug/4832/12345
}

// ── HTML parsers ──────────────────────────────────────────────────────────────

const TOTAL_PAGES_RE = /data-total-pages="(\d+)"/
// Match each job card: captures the <li> block containing href, job-id, title, and location
const LI_RE      = /<li>[\s\S]*?<\/li>/gi
const HREF_RE    = /href="(\/en\/job\/[^"]+)"/
const JOBID_RE   = /data-job-id="(\d+)"/
const TITLE_RE   = /<h2>([^<]+)<\/h2>/
const LOC_RE     = /<span\b[^>]*\bjob-location\b[^>]*>([^<]+)<\/span>/

function parseListingHtml(html: string): { jobs: ListingJob[]; totalPages: number } {
  const totalPagesMatch = TOTAL_PAGES_RE.exec(html)
  const totalPages = totalPagesMatch ? Number.parseInt(totalPagesMatch[1], 10) : 1

  const jobs: ListingJob[] = []
  LI_RE.lastIndex = 0
  let li: RegExpExecArray | null
  while ((li = LI_RE.exec(html)) !== null) {
    const block = li[0]
    const hrefM   = HREF_RE.exec(block)
    const jobIdM  = JOBID_RE.exec(block)
    const titleM  = TITLE_RE.exec(block)
    const locM    = LOC_RE.exec(block)
    const applyPath = hrefM?.[1]
    const jobId     = jobIdM?.[1]
    const title     = titleM?.[1]?.trim()
    if (!applyPath || !jobId || !title) continue
    jobs.push({
      jobId,
      title,
      location: locM?.[1]?.trim() || undefined,
      applyPath,
    })
  }
  return { jobs, totalPages }
}

// ── Search API ────────────────────────────────────────────────────────────────

type SearchResponse = {
  results?: string
  hasJobs?: boolean
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function fetchPage(
  base: string,
  page: number,
  ctx: HarvestCtx
): Promise<{ jobs: ListingJob[]; totalPages: number } | null> {
  const params = new URLSearchParams({
    ActiveFacetID: "0",
    CurrentPage: String(page),
    RecordsPerPage: "100",
    Distance: "50",
    RadiusUnitType: "0",
    Keywords: "",
    Location: "",
    ShowRadius: "False",
    IsPagination: page > 1 ? "True" : "False",
    CustomFacetName: "",
    FacetTerm: "",
    FacetType: "0",
    SearchResultsModuleName: "Search Results",
    SearchFiltersModuleName: "Search Filters",
    SortCriteria: "0",
    SortDirection: "2",
    SearchType: "5",
    PostalCode: "",
    ResultsType: "0",
    fc: "0", fl: "0", fcf: "0", afc: "0", afl: "0", afcf: "0",
  })

  const url = `${base}/en/search-jobs/results/?${params.toString()}`
  const doFetch = ctx.fetchImpl ?? harvesterFetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? 20_000)

  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: {
        "accept": "application/json, text/javascript, */*",
        "x-requested-with": "XMLHttpRequest",
        "referer": `${base}/en/search-jobs`,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 hireoven-harvester/1.0",
      },
      signal: controller.signal,
      redirect: "follow",
    })
    if (!res.ok) return null
    const data = (await res.json()) as SearchResponse
    if (!data.hasJobs && page === 1) return { jobs: [], totalPages: 1 }
    const html = data.results ?? ""
    return parseListingHtml(html)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Detail fetch ──────────────────────────────────────────────────────────────

async function fetchDetail(
  base: string,
  applyPath: string,
  ctx: HarvestCtx
): Promise<{ description?: string } | null> {
  const url = `${base}${applyPath}`
  const res = await fetchHtmlConditional(url, { ...ctx, etag: null, lastModified: null }, { maxAttempts: 2 })
  if (res.kind !== "ok") return null
  const blocks = extractJsonLdBlocks(res.html)
  const jobs = mapJsonLdToHarvestedJobs(blocks, { sourceAts: "radancy", fallbackUrl: url })
  return jobs.length > 0 ? { description: jobs[0].description } : null
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const radancyAdapter: AtsAdapter = {
  name: "radancy",

  detectFromUrl(_url) {
    // Enrolled explicitly via ats_type — no URL-pattern detection.
    return null
  },

  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    // slug = base URL of the company's Radancy careers site
    const base = slug.replace(/\/+$/, "")
    const fetchedAt = new Date()
    const allListings: ListingJob[] = []
    let totalPages = 1

    for (let page = 1; page <= Math.min(MAX_PAGES, totalPages); page++) {
      if (page > 1 && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)
      const result = await fetchPage(base, page, ctx)
      if (!result) break
      if (page === 1) totalPages = result.totalPages
      allListings.push(...result.jobs)
      if (result.jobs.length === 0) break
    }

    // Deduplicate by job ID
    const seen = new Set<string>()
    const unique: ListingJob[] = []
    for (const job of allListings) {
      if (seen.has(job.jobId)) continue
      seen.add(job.jobId)
      unique.push(job)
    }

    // Detail-fetch budget: skip jobs that already have a description in the DB
    const alreadyDescribed = ctx.alreadyDescribedIds ?? new Set<string>()
    let detailsLeft = DETAIL_BUDGET
    const jobs: HarvestedJob[] = []

    for (const listing of unique) {
      const externalId = `radancy:${listing.jobId}`
      const applyUrl = `${base}${listing.applyPath}`
      let description: string | undefined

      if (detailsLeft > 0 && !alreadyDescribed.has(externalId)) {
        if (DETAIL_DELAY_MS > 0) await sleep(DETAIL_DELAY_MS)
        const detail = await fetchDetail(base, listing.applyPath, ctx)
        description = detail?.description
        detailsLeft--
      }

      jobs.push({
        externalId,
        title: listing.title,
        applyUrl,
        location: listing.location,
        description,
        contentHash: hashContent([
          listing.title,
          applyUrl,
          listing.location,
          description?.slice(0, 4_000),
        ]),
      })
    }

    return {
      jobs,
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "radancy",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: 0,
    }
  },
}

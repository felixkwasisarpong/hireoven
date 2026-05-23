/**
 * Infosys (digitalcareers.infosys.com) HTML adapter.
 *
 * Infosys uses a custom Laravel-backed careers site, not a known ATS. The
 * page is server-rendered HTML with predictable markup:
 *
 *   <a href=".../company-job/description/reqid/{REQID}">
 *     <div class="job-title" data-title="...">...</div>
 *     <div class="job-location"> <div class="location-inline">City, State</div>
 *                                <div class="location-inline">USA</div> </div>
 *     <div class="job-description js-job-reqid">
 *       <div class="location-inline">{REQID}</div>
 *     </div>
 *     <div class="job-description js-job-description hide">
 *       <div class="location-inline">{short description}</div>
 *     </div>
 *   </a>
 *
 * Pagination: `?page=N&per_page=25&job_type=experienced&location=USA`.
 * We bump per_page to 50 (the max accepted) and iterate until a page
 * returns no new req-ids. Single-tenant adapter; `slug` is always
 * "infosys".
 *
 * Description preview is truncated at ~200 chars on the list page; a
 * follow-on per-job detail fetch (phase-2 enrichment) can populate the
 * full JD — kept out of v1 to keep the harvest tick fast.
 */

import { harvesterFetch } from "@/lib/harvester/http-agent"
import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

const INFOSYS_HOST_RE = /^https?:\/\/digitalcareers\.infosys\.com\//i
const BASE_URL = "https://digitalcareers.infosys.com/infosys/global-careers"
const PER_PAGE = 50
const MAX_PAGES = 30 // 30 × 50 = 1500 max jobs per harvest
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_UA =
  "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)"

const JOB_BLOCK_RE =
  /<a[^>]*href="(https:\/\/digitalcareers\.infosys\.com\/global-careers\/company-job\/description\/reqid\/([^"]+))"[^>]*>([\s\S]*?)<\/a>/g
const TITLE_RE = /<div\s+class="job-title[^"]*"[^>]*data-title="([^"]+)"/i
const LOCATION_BLOCK_RE =
  /<div\s+class="job-location[^"]*">([\s\S]*?)<\/div>\s*<div\s+class="job-description/i
const LOCATION_INLINE_RE = /<div\s+class="location-inline[^"]*"[^>]*>([^<]+)<\/div>/g
const DESC_RE =
  /<div\s+class="job-description\s+js-job-description\s+hide">[\s\S]*?<div\s+class="location-inline[^"]*"[^>]*>([^<]+)</i

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseLocation(block: string): string | undefined {
  const seen = new Set<string>()
  const parts: string[] = []
  LOCATION_INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LOCATION_INLINE_RE.exec(block)) !== null) {
    const text = decodeEntities(m[1]).replace(/^-+\s*/, "").replace(/\s*-+$/, "").trim()
    if (!text || text === "-" || seen.has(text)) continue
    seen.add(text)
    parts.push(text)
  }
  return parts.length > 0 ? parts.join(", ") : undefined
}

export function parseInfosysJobs(html: string): HarvestedJob[] {
  const jobs: HarvestedJob[] = []
  JOB_BLOCK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = JOB_BLOCK_RE.exec(html)) !== null) {
    const applyUrl = m[1]
    const externalId = m[2].trim()
    const body = m[3]
    const titleMatch = TITLE_RE.exec(body)
    const title = titleMatch ? decodeEntities(titleMatch[1]) : ""
    if (!title || !externalId) continue
    const locMatch = LOCATION_BLOCK_RE.exec(body)
    const location = locMatch ? parseLocation(locMatch[1]) : undefined
    const descMatch = DESC_RE.exec(body)
    const description = descMatch ? decodeEntities(descMatch[1]).slice(0, 4_000) : undefined
    jobs.push({
      externalId,
      title,
      applyUrl,
      description,
      location,
      contentHash: hashContent([title, applyUrl, location, description?.slice(0, 200)]),
    })
  }
  return jobs
}

async function fetchListingPage(
  page: number,
  ctx: HarvestCtx
): Promise<{ status: number; html: string; latencyMs: number } | { status: number; latencyMs: number; html: null }> {
  const url = `${BASE_URL}?page=${page}&per_page=${PER_PAGE}&job_type=experienced&location=USA`
  const doFetch = ctx.fetchImpl ?? harvesterFetch
  const timeoutMs = Math.max(1_000, ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await doFetch(url, {
      method: "GET",
      headers: {
        "user-agent": ctx.userAgent ?? DEFAULT_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    })
    const latencyMs = Date.now() - startedAt
    if (!response.ok) return { status: response.status, latencyMs, html: null }
    const html = await response.text()
    return { status: response.status, latencyMs, html }
  } finally {
    clearTimeout(timer)
  }
}

export const infosysAdapter: AtsAdapter = {
  name: "infosys",
  concurrency: envConcurrency("infosys", 1), // single-tenant, be polite
  detectFromUrl(url) {
    if (!INFOSYS_HOST_RE.test(url)) return null
    return { slug: "infosys" }
  },
  async fetchJobs({ ctx }): Promise<HarvestResult> {
    const seen = new Set<string>()
    const collected: HarvestedJob[] = []
    let totalLatencyMs = 0
    let fetchedAt = new Date()

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await fetchListingPage(page, ctx)
      totalLatencyMs += result.latencyMs
      if (result.html === null) {
        if (page === 1) {
          throw new Error(`infosys fetch failed: HTTP ${result.status}`)
        }
        break
      }
      const pageJobs = parseInfosysJobs(result.html)
      let newOnPage = 0
      for (const job of pageJobs) {
        if (seen.has(job.externalId)) continue
        seen.add(job.externalId)
        collected.push(job)
        newOnPage += 1
      }
      fetchedAt = new Date()
      // No new req-ids on this page → we've walked off the end.
      if (newOnPage === 0) break
    }

    return {
      jobs: collected,
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "infosys",
      sourceAtsSlug: "infosys",
      fetchedAt,
      upstreamLatencyMs: totalLatencyMs,
    }
  },
}

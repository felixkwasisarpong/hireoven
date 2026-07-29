/**
 * Radancy "Jobs2Web" (j2w) adapter.
 *
 * A DIFFERENT Radancy product line than lib/harvester/adapters/radancy.ts
 * (TalentBrew — `/en/search-jobs/results/`). Jobs2Web tenants (confirmed:
 * Capgemini) serve their static assets from `/platform/.../j2w/...` paths
 * and expose a clean, unauthenticated JSON search API — no CAPTCHA, unlike
 * Accenture's Radancy instance which gates search behind reCAPTCHA (that one
 * isn't a fit for a polite unauthenticated scraper and is deliberately not
 * supported here).
 *
 *   POST {base}/services/jobs/search/
 *   { page, keywords, locationsearch, sortby, sortdir, sortfield,
 *     recordsperpage, startrow }
 *   -> { jobList: [{ id, title, urltitle, city, state, country,
 *                     referencedate, shifttype, ... }] }
 *
 * Description text isn't in the list response — the detail page IS
 * server-rendered HTML with the description in an `itemprop="description"`
 * span, ending right before the first `joblayouttoken` sidebar block (the
 * Location/Brand/Professional Community metadata column).
 *
 * Configuration (companies table):
 *   ats_type    = 'jobs2web'
 *   careers_url = the company's Jobs2Web careers base URL
 *                 (e.g. 'https://careers.capgemini.com')
 *   ats_identifier = optional override base URL (falls back to careers_url)
 *
 * Enrolled explicitly via ats_type, like radancy.ts — no URL-pattern
 * detection, since Jobs2Web doesn't brand its pages distinctively enough to
 * auto-detect without risking false positives on unrelated custom sites.
 *
 * Tunables:
 *   HARVESTER_JOBS2WEB_MAX_PAGES          (default 60 -> 1500 jobs)
 *   HARVESTER_JOBS2WEB_PAGE_DELAY_MS       (default 200)
 *   HARVESTER_JOBS2WEB_DETAIL_MAX_JOBS     (default 150 per cycle)
 *   HARVESTER_JOBS2WEB_DETAIL_CONCURRENCY  (default 4)
 *   HARVESTER_JOBS2WEB_LOCATION            (default "usa")
 */

import pLimit from "p-limit"
import {
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { fetchHtmlConditional } from "@/lib/harvester/adapters/_json-ld"

const RECORDS_PER_PAGE = 25

function intEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}
const MAX_PAGES = intEnv("HARVESTER_JOBS2WEB_MAX_PAGES", 60, 1)
const PAGE_DELAY_MS = intEnv("HARVESTER_JOBS2WEB_PAGE_DELAY_MS", 200, 0)
const DETAIL_MAX_JOBS = intEnv("HARVESTER_JOBS2WEB_DETAIL_MAX_JOBS", 150, 0)
const DETAIL_CONCURRENCY = intEnv("HARVESTER_JOBS2WEB_DETAIL_CONCURRENCY", 4, 1)
// Jobs2Web tenants seen so far span dozens of countries; scope to the US by
// default since that's this platform's job feed focus.
const LOCATION_FILTER = process.env.HARVESTER_JOBS2WEB_LOCATION ?? "usa"

type Jobs2WebListing = {
  id?: number | string
  title?: string
  urltitle?: string
  city?: string
  state?: string
  country?: string
  location?: string
  referencedate?: string
  internalstartdate?: string
  shifttype?: string
}

type Jobs2WebSearchResponse = {
  jobList?: Jobs2WebListing[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function searchBody(page: number): string {
  return JSON.stringify({
    page,
    keywords: "",
    locationsearch: LOCATION_FILTER,
    sortby: "referencedate",
    sortdir: "desc",
    sortfield: "title",
    recordsperpage: RECORDS_PER_PAGE,
    startrow: page * RECORDS_PER_PAGE,
  })
}

function detailUrl(base: string, listing: Jobs2WebListing): string | null {
  if (!listing.urltitle || listing.id == null) return null
  return `${base}/job/${listing.urltitle}/${listing.id}/`
}

// Same line-preserving conversion used by pinpoint.ts/rippling.ts — a naive
// `\s+` collapse would merge every heading/bullet in the description into
// one run-on line, silently dropping structure (and, for long enough lists,
// entire content past whatever length filter runs downstream).
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

function extractDescription(html: string): string | undefined {
  const markerIdx = html.indexOf('itemprop="description"')
  if (markerIdx === -1) return undefined
  // `itemprop="description"` is one attribute among several on the
  // enclosing <span ...>; slicing from here would leak the rest of that
  // tag's attribute string as literal text. Skip to the ">" that closes
  // the tag so the slice starts at the actual content.
  const contentStart = html.indexOf(">", markerIdx)
  if (contentStart === -1) return undefined
  const start = contentStart + 1
  // The description column ends right where the sidebar metadata column
  // (Location/Brand/Professional Community/...) begins.
  const end = html.indexOf("joblayouttoken", start)
  const raw = end === -1 ? html.slice(start, start + 20_000) : html.slice(start, end)
  const text = stripHtml(raw)
  return text ? text.slice(0, 12_000) : undefined
}

function parsePosted(value: string | undefined): string | undefined {
  if (!value) return undefined
  // "2026-07-01T02:01:00Z[UTC]" — strip the trailing IANA zone annotation.
  const cleaned = value.replace(/\[[^\]]*\]$/, "")
  const date = new Date(cleaned)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function mapEmployment(shifttype: string | undefined): HarvestedJob["employmentType"] {
  const norm = shifttype?.trim().toLowerCase()
  if (!norm) return undefined
  if (norm.includes("intern")) return "internship"
  if (norm.includes("part")) return "parttime"
  if (norm.includes("contract") || norm.includes("temp")) return "contract"
  if (norm.includes("permanent") || norm.includes("full")) return "fulltime"
  return undefined
}

function listingLocation(listing: Jobs2WebListing): string | undefined {
  if (listing.location?.trim()) return listing.location.trim()
  const parts = [listing.city, listing.state].filter(Boolean)
  return parts.length ? parts.join(", ") : undefined
}

async function fetchAllListings(base: string, ctx: HarvestCtx): Promise<Jobs2WebListing[]> {
  const endpoint = `${base}/services/jobs/search/`
  const listings: Jobs2WebListing[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (page > 0 && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)
    const res = await conditionalFetchJson<Jobs2WebSearchResponse>(endpoint, ctx, {
      method: "POST",
      body: searchBody(page),
      maxAttempts: 3,
    })
    if (res.kind !== "ok") break
    const batch = res.data.jobList ?? []
    if (batch.length === 0) break
    listings.push(...batch)
    if (batch.length < RECORDS_PER_PAGE) break
  }
  return listings
}

async function fetchDescription(base: string, listing: Jobs2WebListing, ctx: HarvestCtx): Promise<string | undefined> {
  const url = detailUrl(base, listing)
  if (!url) return undefined
  const res = await fetchHtmlConditional(url, ctx, { maxAttempts: 2 })
  if (res.kind !== "ok") return undefined
  return extractDescription(res.html)
}

function mapListing(base: string, listing: Jobs2WebListing, description: string | undefined): HarvestedJob | null {
  const id = listing.id != null ? String(listing.id) : ""
  const title = listing.title?.trim() ?? ""
  const applyUrl = detailUrl(base, listing)
  if (!id || !title || !applyUrl) return null

  const location = listingLocation(listing)
  const postedAt = parsePosted(listing.referencedate ?? listing.internalstartdate)
  const employmentType = mapEmployment(listing.shifttype)

  return {
    externalId: `jobs2web:${id}`,
    title,
    applyUrl,
    location,
    description,
    postedAt,
    employmentType,
    contentHash: hashContent([title, applyUrl, location, postedAt, (description ?? "").slice(0, 4_000)]),
  }
}

export const jobs2webAdapter: AtsAdapter = {
  name: "jobs2web",

  detectFromUrl(_url) {
    // Enrolled explicitly via ats_type, like radancy.ts — no URL-pattern
    // detection.
    return null
  },

  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    // slug = base URL of the company's Jobs2Web careers site.
    const base = slug.replace(/\/+$/, "")
    const startedAt = Date.now()
    const listCtx: HarvestCtx = { ...ctx, etag: null, lastModified: null }
    const listings = await fetchAllListings(base, listCtx)

    const alreadyDescribed = ctx.alreadyDescribedIds
    const needingDetail = alreadyDescribed
      ? listings.filter((l) => !alreadyDescribed.has(`jobs2web:${l.id}`))
      : listings
    const targets = needingDetail.slice(0, DETAIL_MAX_JOBS)

    const descriptions = new Map<string, string | undefined>()
    const limit = pLimit(Math.min(DETAIL_CONCURRENCY, Math.max(1, targets.length)))
    await Promise.all(
      targets.map((listing) =>
        limit(async () => {
          const key = String(listing.id)
          descriptions.set(key, await fetchDescription(base, listing, { ...ctx, etag: null, lastModified: null }))
        })
      )
    )

    const jobs = listings
      .map((listing) => mapListing(base, listing, descriptions.get(String(listing.id))))
      .filter((j): j is HarvestedJob => j !== null)

    return {
      jobs,
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "jobs2web",
      sourceAtsSlug: slug,
      fetchedAt: new Date(),
      upstreamLatencyMs: Date.now() - startedAt,
    }
  },
}

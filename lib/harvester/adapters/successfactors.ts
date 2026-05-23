import pLimit from "p-limit"
import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import {
  extractJsonLdBlocks,
  fetchHtmlConditional,
  mapJsonLdToHarvestedJobs,
} from "@/lib/harvester/adapters/_json-ld"

/**
 * SAP SuccessFactors hosted career sites.
 *   https://career{N}.successfactors.{com,eu}/career?company={id}
 *   https://career{N}.successfactors.{com,eu}/careers?company={id}
 *
 * SuccessFactors has no universal unauthenticated JSON API. Tenants run on
 * one of several numbered shards (career1..career12) across two TLDs (.com
 * for AMER/global, .eu for EMEA-resident tenants). The classic Career Site
 * Page (CSP) is still the workhorse for most enterprise customers: it ships
 * server-rendered HTML listings with anchor hrefs that carry
 * `career_job_req_id={jobReqId}`. The modern Career Site Builder (CSB) is
 * JS-rendered on the search page but its job-detail pages still embed
 * schema.org `JobPosting` JSON-LD for SEO.
 *
 * Strategy:
 *   1. Page through the SSR job listing for `company={id}` on the resolved
 *      shard. Extract `career_job_req_id` values from anchor hrefs.
 *   2. Fetch a bounded subset of detail pages and parse JSON-LD JobPosting
 *      blocks for description / location / postedAt.
 *   3. Fall back to anchor text + cleanSlug for jobs whose detail page is
 *      JS-only.
 *
 * Slug format: `{shard}:{companyId}` (e.g. `career4:novartis`). Keeping the
 * shard means we don't have to probe every host on each fetch.
 */

const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_SUCCESSFACTORS_MAX_PAGES ?? "20", 10)
)
const DETAIL_MAX_JOBS = Math.max(
  0,
  Number.parseInt(process.env.HARVESTER_SUCCESSFACTORS_DETAIL_MAX_JOBS ?? "40", 10)
)
const DETAIL_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_SUCCESSFACTORS_DETAIL_CONCURRENCY ?? "3", 10)
)

type SFShard = {
  /** Subdomain prefix e.g. "career4". */
  prefix: string
  /** "com" | "eu". */
  tld: string
}

type SFJobLink = {
  jobReqId: string
  title: string
  url: string
  location?: string
}

const SHARD_HOST_RE = /^(career(?:1[0-2]?|[2-9]))\.successfactors\.(com|eu)$/i

function parseShardFromHost(host: string): SFShard | null {
  const m = host.toLowerCase().match(SHARD_HOST_RE)
  if (!m) return null
  return { prefix: m[1].toLowerCase(), tld: m[2].toLowerCase() }
}

function cleanCompanyId(value: string | undefined | null): string | null {
  if (!value) return null
  const v = value.trim()
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(v)) return null
  // Many SF companyIDs are short tokens (1–32 chars). Reject pathological
  // outliers to avoid catching unrelated query params that happen to be
  // named `company`.
  if (v.length > 64) return null
  return v
}

function encodeSlug(shard: SFShard, companyId: string): string {
  return `${shard.prefix}.${shard.tld}:${companyId}`
}

function decodeSlug(slug: string): { shard: SFShard; companyId: string } | null {
  const [hostPart, companyId] = slug.split(":")
  if (!hostPart || !companyId) return null
  const cleanedCompany = cleanCompanyId(companyId)
  if (!cleanedCompany) return null
  // hostPart looks like `career4.com`.
  const m = hostPart.match(/^(career(?:1[0-2]?|[2-9]))\.(com|eu)$/)
  if (!m) return null
  return { shard: { prefix: m[1], tld: m[2] }, companyId: cleanedCompany }
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const shard = parseShardFromHost(parsed.hostname)
  if (!shard) return null
  // `company` is the only stable identifier — sometimes lowercase, sometimes
  // CamelCase. SAP SF treats it case-insensitively.
  const companyId = cleanCompanyId(parsed.searchParams.get("company"))
  if (!companyId) return null
  return { slug: encodeSlug(shard, companyId) }
}

function originFor(shard: SFShard): string {
  return `https://${shard.prefix}.successfactors.${shard.tld}`
}

function listingUrl(shard: SFShard, companyId: string, page: number): string {
  // career_ns=job_listing_search drives the SSR job grid; iCurrentPage is
  // 0-indexed in SAP SF's URL scheme even though the UI labels are 1-indexed.
  const params = new URLSearchParams({
    company: companyId,
    career_ns: "job_listing_search",
    navBarLevel: "JOB_SEARCH",
    rcm_site_locale: "en_US",
    _s_crb: "",
    iCurrentPage: String(page),
  })
  return `${originFor(shard)}/career?${params.toString()}`
}

function detailUrl(shard: SFShard, companyId: string, jobReqId: string): string {
  const params = new URLSearchParams({
    company: companyId,
    career_ns: "job_application",
    career_job_req_id: jobReqId,
    selected_lang: "en_US",
  })
  return `${originFor(shard)}/career?${params.toString()}`
}

function applyUrlFor(shard: SFShard, companyId: string, jobReqId: string): string {
  // Detail page URL is also the apply landing page on SAP SF — Apply button is
  // an anchor on the same page that opens the candidate application form.
  return detailUrl(shard, companyId, jobReqId)
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const ANCHOR_RE = /<a\s+([^>]+?)>([\s\S]*?)<\/a>/gi

function attr(tagAttrs: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i")
  const m = tagAttrs.match(re)
  return m ? m[1] : null
}

/**
 * Pull `career_job_req_id` from any anchor whose href references it. SAP SF's
 * SSR listing renders rows like:
 *   <a href="career?career_ns=job_application&career_job_req_id=12345&...">
 *     Senior Engineer
 *   </a>
 * but the same hrefs can also appear in JS-injected portions of the page; we
 * collect every unique req id regardless of where it appears.
 */
export function extractJobLinks(html: string, shard: SFShard, companyId: string): SFJobLink[] {
  const out = new Map<string, SFJobLink>()
  const origin = originFor(shard)
  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = attr(match[1], "href")
    if (!href) continue
    const decoded = decodeHtmlEntities(href)
    let absolute: URL
    try {
      absolute = new URL(decoded, `${origin}/`)
    } catch {
      continue
    }
    if (absolute.hostname.toLowerCase() !== `${shard.prefix}.successfactors.${shard.tld}`) continue
    const jobReqId = absolute.searchParams.get("career_job_req_id")
    if (!jobReqId || !/^[0-9]+$/.test(jobReqId)) continue
    // Only keep anchors whose company param matches (or is absent — some
    // hrefs omit it and inherit from the page query).
    const linkCompany = absolute.searchParams.get("company")
    if (linkCompany && linkCompany.toLowerCase() !== companyId.toLowerCase()) continue
    const title = stripTags(match[2] || attr(match[1], "title") || attr(match[1], "aria-label") || "")
    if (!title) continue
    if (out.has(jobReqId)) continue
    out.set(jobReqId, {
      jobReqId,
      title,
      url: applyUrlFor(shard, companyId, jobReqId),
    })
  }
  return Array.from(out.values())
}

/**
 * SAP SF's SSR listing emits a stable total at the top of the page
 * ("123 jobs found"). When we can't read it we cap at MAX_PAGES and stop on
 * an empty page.
 */
export function extractTotalCount(html: string): number | null {
  // Match patterns like "12,345 jobs", "1 job found", etc.
  const m = html.match(/([0-9][0-9,]*)\s+jobs?\s+(?:found|matching|available)/i)
  if (!m) return null
  const n = Number.parseInt(m[1].replace(/,/g, ""), 10)
  return Number.isFinite(n) ? n : null
}

async function fetchListingPage(
  url: string,
  ctx: HarvestCtx
): Promise<{ html: string; etag: string | null; lastModified: string | null; latencyMs: number } | null> {
  const result = await fetchHtmlConditional(url, {
    ...ctx,
    etag: null,
    lastModified: null,
  })
  if (result.kind !== "ok") return null
  return {
    html: result.html,
    etag: result.etag,
    lastModified: result.lastModified,
    latencyMs: result.upstreamLatencyMs,
  }
}

async function fetchAllJobLinks(
  shard: SFShard,
  companyId: string,
  ctx: HarvestCtx
): Promise<{
  links: SFJobLink[]
  latencyMs: number
  etag: string | null
  lastModified: string | null
}> {
  const links = new Map<string, SFJobLink>()
  let latencyMs = 0
  let etag: string | null = null
  let lastModified: string | null = null
  let successfulPages = 0

  for (let page = 0; page < MAX_PAGES; page++) {
    const pageUrl = listingUrl(shard, companyId, page)
    const result = await fetchListingPage(pageUrl, ctx)
    if (!result) {
      // If the very first page fails surface an error so the worker marks the
      // company as failed; mid-stream failures just stop pagination.
      if (page === 0) {
        const err = new Error(`successfactors fetch failed: listing page 0 unreachable for ${shard.prefix}/${companyId}`)
        ;(err as Error & { status?: number | null }).status = null
        throw err
      }
      break
    }
    successfulPages += 1
    latencyMs += result.latencyMs
    etag ??= result.etag
    lastModified ??= result.lastModified

    const pageLinks = extractJobLinks(result.html, shard, companyId)
    let added = 0
    for (const link of pageLinks) {
      if (links.has(link.jobReqId)) continue
      links.set(link.jobReqId, link)
      added += 1
    }
    // Stop when a page introduces no new jobs (typical end-of-pagination).
    if (added === 0) break
  }

  if (successfulPages === 0) {
    const err = new Error("successfactors fetch failed: no reachable listing pages")
    ;(err as Error & { status?: number | null }).status = null
    throw err
  }

  return { links: Array.from(links.values()), latencyMs, etag, lastModified }
}

async function fetchJobDetail(
  link: SFJobLink,
  shard: SFShard,
  companyId: string,
  ctx: HarvestCtx
): Promise<HarvestedJob | null> {
  const detail = detailUrl(shard, companyId, link.jobReqId)
  const result = await fetchHtmlConditional(detail, {
    ...ctx,
    etag: null,
    lastModified: null,
  })
  if (result.kind !== "ok") return null
  const mapped = mapJsonLdToHarvestedJobs(extractJsonLdBlocks(result.html), {
    sourceAts: "successfactors",
    fallbackUrl: link.url,
  })
  const first = mapped.find((job) => job.title) ?? null
  const title = first?.title || link.title
  const location = first?.location ?? link.location
  return {
    externalId: `successfactors:${shard.prefix}.${shard.tld}:${companyId}:${link.jobReqId}`,
    title,
    applyUrl: link.url,
    description: first?.description,
    location,
    postedAt: first?.postedAt,
    workMode: first?.workMode,
    employmentType: first?.employmentType,
    salaryMin: first?.salaryMin,
    salaryMax: first?.salaryMax,
    salaryCurrency: first?.salaryCurrency,
    contentHash: hashContent([
      title,
      link.url,
      location,
      first?.postedAt,
      first?.workMode,
      first?.employmentType,
      first?.salaryMin,
      first?.salaryMax,
      first?.salaryCurrency,
      first?.description?.slice(0, 4_000),
    ]),
  }
}

function shallowJob(link: SFJobLink, shard: SFShard, companyId: string): HarvestedJob {
  return {
    externalId: `successfactors:${shard.prefix}.${shard.tld}:${companyId}:${link.jobReqId}`,
    title: link.title,
    applyUrl: link.url,
    location: link.location,
    contentHash: hashContent([link.title, link.url, link.location]),
  }
}

async function enrichWithDetails(
  links: SFJobLink[],
  shard: SFShard,
  companyId: string,
  ctx: HarvestCtx
): Promise<HarvestedJob[]> {
  if (DETAIL_MAX_JOBS === 0) return links.map((link) => shallowJob(link, shard, companyId))
  // Skip links whose externalId already has a real description in the DB.
  // External ID shape is `successfactors:{shard}.{tld}:{companyId}:{jobReqId}`.
  const alreadyDescribed = ctx.alreadyDescribedIds
  const linksNeedingDetail = alreadyDescribed
    ? links.filter(
        (link) =>
          !alreadyDescribed.has(
            `successfactors:${shard.prefix}.${shard.tld}:${companyId}:${link.jobReqId}`
          )
      )
    : links
  const limiter = pLimit(DETAIL_CONCURRENCY)
  const enriched = new Map<string, HarvestedJob>()
  await Promise.all(
    linksNeedingDetail.slice(0, DETAIL_MAX_JOBS).map((link) =>
      limiter(async () => {
        const detail = await fetchJobDetail(link, shard, companyId, ctx)
        if (detail) enriched.set(link.jobReqId, detail)
      })
    )
  )
  return links.map((link) => enriched.get(link.jobReqId) ?? shallowJob(link, shard, companyId))
}

export const successfactorsAdapter: AtsAdapter = {
  name: "successfactors",
  // SAP SF tenants share a small pool of shard hosts and respond slowly under
  // load; keep concurrency conservative so two tenants on the same shard
  // don't gridlock each other.
  concurrency: envConcurrency("successfactors", 3),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    const decoded = decodeSlug(slug)
    if (!decoded) throw new Error(`successfactors malformed slug: ${slug}`)
    const { shard, companyId } = decoded

    const listing = await fetchAllJobLinks(shard, companyId, ctx)
    const jobs = listing.links.length
      ? await enrichWithDetails(listing.links, shard, companyId, ctx)
      : []

    return {
      jobs,
      notModified: false,
      etag: listing.etag,
      lastModified: listing.lastModified,
      sourceAts: "successfactors",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(listing.latencyMs, Date.now() - startedAt),
    }
  },
}

export { decodeSlug, encodeSlug, parseShardFromHost, fetchJobDetail, fetchAllJobLinks }

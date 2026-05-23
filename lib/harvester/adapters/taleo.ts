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
 * Oracle Taleo Enterprise Edition (TEE) hosted career sites.
 *   https://{tenant}.taleo.net/careersection/{section}/jobsearch.ftl
 *
 * Taleo has no public JSON list endpoint, but every customer's "career
 * section" exposes:
 *   - A server-rendered job search page with anchor hrefs of the form
 *       jobdetail.ftl?job={jobId}
 *     paginated via `?lang=en&pageNo={N}` (1-indexed).
 *   - Detail pages at `jobdetail.ftl?job={jobId}` that frequently embed
 *     schema.org `JobPosting` JSON-LD for SEO. When JSON-LD is missing we
 *     fall back to anchor metadata captured during listing.
 *
 * Slug format: `{tenant}:{section}` (e.g. `marriott:2`). We keep the section
 * because a single tenant can run multiple isolated portals (executive,
 * hourly, corporate) and the section code is required to address each.
 */

const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_TALEO_MAX_PAGES ?? "25", 10)
)
const DETAIL_MAX_JOBS = Math.max(
  0,
  Number.parseInt(process.env.HARVESTER_TALEO_DETAIL_MAX_JOBS ?? "40", 10)
)
const DETAIL_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_TALEO_DETAIL_CONCURRENCY ?? "3", 10)
)

type TaleoJobLink = {
  jobId: string
  title: string
  url: string
  location?: string
}

const TENANT_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.taleo\.net$/i
// Section codes are typically short tokens like "2" / "ex" / "external_career_section".
const SECTION_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

function parseTenant(host: string): string | null {
  const m = host.toLowerCase().match(TENANT_HOST_RE)
  if (!m) return null
  // The `taleocloud` / `tbe.taleo` style hosts aren't a customer tenant.
  const tenant = m[1]
  if (tenant === "www" || tenant === "tbe" || tenant === "taleocloud") return null
  return tenant
}

function cleanSection(value: string | undefined | null): string | null {
  if (!value) return null
  const v = value.trim()
  return SECTION_RE.test(v) ? v : null
}

function encodeSlug(tenant: string, section: string): string {
  return `${tenant}:${section}`
}

function decodeSlug(slug: string): { tenant: string; section: string } | null {
  const [tenant, section] = slug.split(":")
  if (!tenant || !section) return null
  if (!parseTenant(`${tenant}.taleo.net`)) return null
  const cleanedSection = cleanSection(section)
  if (!cleanedSection) return null
  return { tenant, section: cleanedSection }
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const tenant = parseTenant(parsed.hostname)
  if (!tenant) return null
  // Path looks like /careersection/{section}/{page.ftl?...}
  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parts[0]?.toLowerCase() !== "careersection") return null
  const section = cleanSection(parts[1])
  if (!section) return null
  return { slug: encodeSlug(tenant, section) }
}

function originFor(tenant: string): string {
  return `https://${tenant}.taleo.net`
}

function listingUrl(tenant: string, section: string, page: number): string {
  const params = new URLSearchParams({
    lang: "en",
    portal: "",
    pageNo: String(page),
  })
  return `${originFor(tenant)}/careersection/${encodeURIComponent(section)}/jobsearch.ftl?${params.toString()}`
}

function detailUrl(tenant: string, section: string, jobId: string): string {
  return `${originFor(tenant)}/careersection/${encodeURIComponent(section)}/jobdetail.ftl?job=${encodeURIComponent(jobId)}&lang=en`
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
 * Extract jobdetail.ftl?job={jobId} links from a search-results page.
 * Tenants emit anchors with the title as inner text; sometimes the location
 * sits in a sibling cell, but more often it's rendered as `<a title="Title -
 * City, ST">`.
 */
export function extractJobLinks(html: string, tenant: string, section: string): TaleoJobLink[] {
  const out = new Map<string, TaleoJobLink>()
  const origin = originFor(tenant)
  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = attr(match[1], "href")
    if (!href) continue
    const decoded = decodeHtmlEntities(href)
    let absolute: URL
    try {
      absolute = new URL(decoded, `${origin}/careersection/${section}/`)
    } catch {
      continue
    }
    if (absolute.hostname.toLowerCase() !== `${tenant}.taleo.net`) continue
    if (!/\/careersection\/[^/]+\/jobdetail\.ftl$/i.test(absolute.pathname)) continue
    const jobId = absolute.searchParams.get("job")
    if (!jobId || !/^[0-9A-Z_-]+$/i.test(jobId)) continue
    const innerText = stripTags(match[2])
    const titleAttr = attr(match[1], "title")
    const title = innerText || (titleAttr ? stripTags(titleAttr) : "")
    if (!title) continue
    if (out.has(jobId)) continue
    out.set(jobId, {
      jobId,
      title,
      url: detailUrl(tenant, section, jobId),
    })
  }
  return Array.from(out.values())
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
  tenant: string,
  section: string,
  ctx: HarvestCtx
): Promise<{ links: TaleoJobLink[]; latencyMs: number; etag: string | null; lastModified: string | null }> {
  const links = new Map<string, TaleoJobLink>()
  let latencyMs = 0
  let etag: string | null = null
  let lastModified: string | null = null
  let successfulPages = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = listingUrl(tenant, section, page)
    const result = await fetchListingPage(url, ctx)
    if (!result) {
      if (page === 1) {
        const err = new Error(`taleo fetch failed: search page 1 unreachable for ${tenant}/${section}`)
        ;(err as Error & { status?: number | null }).status = null
        throw err
      }
      break
    }
    successfulPages += 1
    latencyMs += result.latencyMs
    etag ??= result.etag
    lastModified ??= result.lastModified

    const pageLinks = extractJobLinks(result.html, tenant, section)
    let added = 0
    for (const link of pageLinks) {
      if (links.has(link.jobId)) continue
      links.set(link.jobId, link)
      added += 1
    }
    // Taleo's search page repeats prior results when you walk off the last
    // real page, so "no new jobs added" is the strongest end-of-pagination
    // signal we have.
    if (added === 0) break
  }

  if (successfulPages === 0) {
    const err = new Error("taleo fetch failed: no reachable listing pages")
    ;(err as Error & { status?: number | null }).status = null
    throw err
  }

  return { links: Array.from(links.values()), latencyMs, etag, lastModified }
}

async function fetchJobDetail(
  link: TaleoJobLink,
  tenant: string,
  section: string,
  ctx: HarvestCtx
): Promise<HarvestedJob | null> {
  const result = await fetchHtmlConditional(link.url, {
    ...ctx,
    etag: null,
    lastModified: null,
  })
  if (result.kind !== "ok") return null
  const mapped = mapJsonLdToHarvestedJobs(extractJsonLdBlocks(result.html), {
    sourceAts: "taleo",
    fallbackUrl: link.url,
  })
  const first = mapped.find((j) => j.title) ?? null
  const title = first?.title || link.title
  const location = first?.location ?? link.location
  return {
    externalId: `taleo:${tenant}:${section}:${link.jobId}`,
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

function shallowJob(link: TaleoJobLink, tenant: string, section: string): HarvestedJob {
  return {
    externalId: `taleo:${tenant}:${section}:${link.jobId}`,
    title: link.title,
    applyUrl: link.url,
    location: link.location,
    contentHash: hashContent([link.title, link.url, link.location]),
  }
}

async function enrichWithDetails(
  links: TaleoJobLink[],
  tenant: string,
  section: string,
  ctx: HarvestCtx
): Promise<HarvestedJob[]> {
  if (DETAIL_MAX_JOBS === 0) return links.map((link) => shallowJob(link, tenant, section))
  // Skip links whose externalId already has a real description in the DB.
  // External ID shape is `taleo:{tenant}:{section}:{jobId}` (see shallowJob).
  const alreadyDescribed = ctx.alreadyDescribedIds
  const linksNeedingDetail = alreadyDescribed
    ? links.filter(
        (link) => !alreadyDescribed.has(`taleo:${tenant}:${section}:${link.jobId}`)
      )
    : links
  const limiter = pLimit(DETAIL_CONCURRENCY)
  const enriched = new Map<string, HarvestedJob>()
  await Promise.all(
    linksNeedingDetail.slice(0, DETAIL_MAX_JOBS).map((link) =>
      limiter(async () => {
        const detail = await fetchJobDetail(link, tenant, section, ctx)
        if (detail) enriched.set(link.jobId, detail)
      })
    )
  )
  return links.map((link) => enriched.get(link.jobId) ?? shallowJob(link, tenant, section))
}

export const taleoAdapter: AtsAdapter = {
  name: "taleo",
  // Taleo's legacy SSR is slow; one customer tenant easily takes 10+ seconds
  // for a single page. Keep concurrency low to avoid head-of-line blocking.
  concurrency: envConcurrency("taleo", 2),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    const decoded = decodeSlug(slug)
    if (!decoded) throw new Error(`taleo malformed slug: ${slug}`)
    const { tenant, section } = decoded

    const listing = await fetchAllJobLinks(tenant, section, ctx)
    const jobs = listing.links.length
      ? await enrichWithDetails(listing.links, tenant, section, ctx)
      : []

    return {
      jobs,
      notModified: false,
      etag: listing.etag,
      lastModified: listing.lastModified,
      sourceAts: "taleo",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(listing.latencyMs, Date.now() - startedAt),
    }
  },
}

export { decodeSlug, encodeSlug, parseTenant, fetchAllJobLinks, fetchJobDetail }

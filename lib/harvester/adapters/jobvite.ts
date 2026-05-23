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
 * Jobvite hosted career sites.
 *   https://jobs.jobvite.com/{slug}
 *   https://jobs.jobvite.com/{slug}/jobs
 *   https://jobs.jobvite.com/{slug}/jobs/all
 *   https://jobs.jobvite.com/{slug}/search
 *
 * There is no universal unauthenticated JSON API for Jobvite. Hosted pages
 * render server-side job-list anchors plus JSON-LD on each detail page.
 */

const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_JOBVITE_MAX_PAGES ?? "25", 10)
)
// Bumped 60 → 200. Jobvite detail pages are HTML + JSON-LD (slower than
// SR's JSON), but at concurrency 4 with ~600ms per page that's still ~30s
// of detail time per tick — within the 240s lease. Previous 60-job cap
// left 78% of Jobvite rows description-less.
const DETAIL_MAX_JOBS = Math.max(
  0,
  Number.parseInt(process.env.HARVESTER_JOBVITE_DETAIL_MAX_JOBS ?? "200", 10)
)
const DETAIL_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_JOBVITE_DETAIL_CONCURRENCY ?? "4", 10)
)

type JobviteLink = {
  jobId: string
  title: string
  url: string
  location?: string
}

function endpointFor(slug: string): string {
  return `https://jobs.jobvite.com/${encodeURIComponent(slug)}/jobs`
}

function seedUrls(slug: string): string[] {
  const safe = encodeURIComponent(slug)
  return [
    `https://jobs.jobvite.com/${safe}/jobs/all`,
    `https://jobs.jobvite.com/${safe}/search`,
    endpointFor(slug),
    `https://jobs.jobvite.com/${safe}`,
  ]
}

function cleanSlug(value: string | undefined): string | null {
  if (!value) return null
  const cleaned = value.trim()
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(cleaned)) return null
  return cleaned
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname.toLowerCase() !== "jobs.jobvite.com") return null
  const slug = cleanSlug(parsed.pathname.split("/").filter(Boolean)[0])
  if (!slug) return null
  return { slug }
}

function attr(tagAttrs: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i")
  const m = tagAttrs.match(re)
  return m ? m[1] : null
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

function classText(html: string, className: string): string | undefined {
  const re = new RegExp(
    `<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "i"
  )
  const m = html.match(re)
  const text = m ? stripTags(m[1]) : ""
  return text || undefined
}

const ANCHOR_RE = /<a\s+([^>]+?)>([\s\S]*?)<\/a>/gi

function resolveJobviteUrl(rawHref: string, baseUrl: string): URL | null {
  try {
    return new URL(decodeHtmlEntities(rawHref), baseUrl)
  } catch {
    return null
  }
}

export function extractJobLinks(html: string, slug: string, baseUrl = endpointFor(slug)): JobviteLink[] {
  const out = new Map<string, JobviteLink>()
  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = attr(match[1], "href")
    if (!href) continue
    const absolute = resolveJobviteUrl(href, baseUrl)
    if (!absolute || absolute.hostname.toLowerCase() !== "jobs.jobvite.com") continue

    const pathParts = absolute.pathname.split("/").filter(Boolean)
    if (pathParts[0]?.toLowerCase() !== slug.toLowerCase()) continue
    if (pathParts[1] !== "job" || !pathParts[2]) continue

    const jobId = pathParts[2]
    const title =
      classText(match[2], "jv-job-list-name") ??
      stripTags(attr(match[1], "aria-label") ?? attr(match[1], "title") ?? match[2])
    if (!title) continue

    absolute.search = ""
    absolute.hash = ""
    const key = `${slug.toLowerCase()}:${jobId}`
    if (out.has(key)) continue
    out.set(key, {
      jobId,
      title,
      url: absolute.toString(),
      location: classText(match[2], "jv-job-list-location"),
    })
  }
  return Array.from(out.values())
}

export function extractPaginationUrls(html: string, slug: string, baseUrl: string): string[] {
  const out = new Set<string>()
  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = attr(match[1], "href")
    if (!href) continue
    const absolute = resolveJobviteUrl(href, baseUrl)
    if (!absolute || absolute.hostname.toLowerCase() !== "jobs.jobvite.com") continue
    const pathParts = absolute.pathname.split("/").filter(Boolean)
    if (pathParts[0]?.toLowerCase() !== slug.toLowerCase()) continue
    if (pathParts[1] !== "search" && !(pathParts[1] === "jobs" && pathParts[2] === "all")) continue
    const page = Number.parseInt(absolute.searchParams.get("p") ?? "", 10)
    if (!Number.isFinite(page) || page < 0 || page >= MAX_PAGES) continue
    absolute.hash = ""
    out.add(absolute.toString())
  }
  return Array.from(out.values())
}

async function fetchPage(
  url: string,
  ctx: HarvestCtx
): Promise<{ html: string; latencyMs: number; etag: string | null; lastModified: string | null } | null> {
  const result = await fetchHtmlConditional(url, {
    ...ctx,
    etag: null,
    lastModified: null,
  })
  if (result.kind !== "ok") return null
  return {
    html: result.html,
    latencyMs: result.upstreamLatencyMs,
    etag: result.etag,
    lastModified: result.lastModified,
  }
}

async function fetchAllJobLinks(
  slug: string,
  ctx: HarvestCtx
): Promise<{ links: JobviteLink[]; latencyMs: number; etag: string | null; lastModified: string | null }> {
  const queue = [...seedUrls(slug)]
  const seenPages = new Set<string>()
  const links = new Map<string, JobviteLink>()
  let pagesFetched = 0
  let successfulPages = 0
  let upstreamLatencyMs = 0
  let etag: string | null = null
  let lastModified: string | null = null

  while (queue.length > 0 && pagesFetched < MAX_PAGES) {
    const url = queue.shift()!
    if (seenPages.has(url)) continue
    seenPages.add(url)

    const page = await fetchPage(url, ctx)
    if (!page) continue
    pagesFetched += 1
    successfulPages += 1
    upstreamLatencyMs += page.latencyMs
    etag ??= page.etag
    lastModified ??= page.lastModified

    for (const link of extractJobLinks(page.html, slug, url)) {
      links.set(`${slug.toLowerCase()}:${link.jobId}`, link)
    }
    for (const nextUrl of extractPaginationUrls(page.html, slug, url)) {
      if (!seenPages.has(nextUrl)) queue.unshift(nextUrl)
    }
  }

  if (successfulPages === 0) {
    const err = new Error("jobvite fetch failed: no reachable listing pages")
    ;(err as Error & { status?: number | null }).status = null
    throw err
  }

  return {
    links: Array.from(links.values()),
    latencyMs: upstreamLatencyMs,
    etag,
    lastModified,
  }
}

async function fetchJobDetail(link: JobviteLink, slug: string, ctx: HarvestCtx): Promise<HarvestedJob | null> {
  const result = await fetchHtmlConditional(link.url, {
    ...ctx,
    etag: null,
    lastModified: null,
  })
  if (result.kind !== "ok") return null
  const mapped = mapJsonLdToHarvestedJobs(extractJsonLdBlocks(result.html), {
    sourceAts: "jobvite",
    fallbackUrl: link.url,
  })
  const first = mapped.find((job) => job.title) ?? null
  if (!first) return null
  return {
    ...first,
    externalId: `jobvite:${slug}:${link.jobId}`,
    title: first.title || link.title,
    applyUrl: link.url,
    location: first.location ?? link.location,
    contentHash: hashContent([
      first.title || link.title,
      link.url,
      first.location ?? link.location,
      first.postedAt,
      first.workMode,
      first.employmentType,
      first.salaryMin,
      first.salaryMax,
      first.salaryCurrency,
      first.description?.slice(0, 4_000),
    ]),
  }
}

function shallowJob(link: JobviteLink, slug: string): HarvestedJob {
  return {
    externalId: `jobvite:${slug}:${link.jobId}`,
    title: link.title,
    applyUrl: link.url,
    location: link.location,
    contentHash: hashContent([link.title, link.url, link.location]),
  }
}

async function enrichWithDetails(links: JobviteLink[], slug: string, ctx: HarvestCtx): Promise<HarvestedJob[]> {
  if (DETAIL_MAX_JOBS === 0) return links.map((link) => shallowJob(link, slug))
  // Skip links whose externalId already has a real description in the DB.
  // External ID shape is `jobvite:{slug}:{jobId}` (see shallowJob/fetchJobDetail).
  const alreadyDescribed = ctx.alreadyDescribedIds
  const linksNeedingDetail = alreadyDescribed
    ? links.filter((link) => !alreadyDescribed.has(`jobvite:${slug}:${link.jobId}`))
    : links
  const limiter = pLimit(DETAIL_CONCURRENCY)
  const enriched = new Map<string, HarvestedJob>()
  await Promise.all(
    linksNeedingDetail.slice(0, DETAIL_MAX_JOBS).map((link) =>
      limiter(async () => {
        const detail = await fetchJobDetail(link, slug, ctx)
        if (detail) enriched.set(link.jobId, detail)
      })
    )
  )
  return links.map((link) => enriched.get(link.jobId) ?? shallowJob(link, slug))
}

export const jobviteAdapter: AtsAdapter = {
  name: "jobvite",
  // Hosted HTML pages are server-rendered and detail pages are per-job.
  concurrency: envConcurrency("jobvite", 4),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    const normalizedSlug = cleanSlug(slug)
    if (!normalizedSlug) throw new Error(`jobvite malformed slug: ${slug}`)

    const listing = await fetchAllJobLinks(normalizedSlug, ctx)
    const jobs = listing.links.length
      ? await enrichWithDetails(listing.links, normalizedSlug, ctx)
      : []

    return {
      jobs,
      notModified: false,
      etag: listing.etag,
      lastModified: listing.lastModified,
      sourceAts: "jobvite",
      sourceAtsSlug: normalizedSlug,
      fetchedAt,
      upstreamLatencyMs: Math.max(listing.latencyMs, Date.now() - startedAt),
    }
  },
}

export { fetchAllJobLinks, fetchJobDetail }

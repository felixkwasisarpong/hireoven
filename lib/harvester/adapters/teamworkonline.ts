import pLimit from "p-limit"
import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { harvesterFetch } from "@/lib/harvester/http-agent"

/**
 * TeamWork Online — the dominant ATS for pro & college sports organizations
 * (NBA/NFL/NHL/MLB teams, venues, leagues). Each org has a public portal at:
 *   https://www.teamworkonline.com/{sport}-jobs/{org}-jobs/{org}
 *
 * The portal is server-rendered HTML: each opening is an
 * `organization-portal__job-container` block carrying title, org, location,
 * career level, and a detail link ending in a numeric job id
 * (e.g. /.../front-end-engineer-2176451).
 *
 * Each detail page embeds a full schema.org JobPosting JSON-LD block
 * (description HTML, datePosted, employmentType), which we use for enrichment.
 *
 * ats_identifier (slug) = the portal path without leading slash, e.g.
 *   "basketball-jobs/houston-rockets-jobs/houston-rockets"
 */

const HOST = "https://www.teamworkonline.com"

function intEnv(name: string, dflt: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

const MAX_PAGES = intEnv("HARVESTER_TEAMWORKONLINE_MAX_PAGES", 10)
const DETAIL_MAX_JOBS = intEnv("HARVESTER_TEAMWORKONLINE_DETAIL_MAX_JOBS", 80)
const DETAIL_CONCURRENCY = intEnv("HARVESTER_TEAMWORKONLINE_DETAIL_CONCURRENCY", 4)

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

const JOB_CONTAINER = "organization-portal__job-container"

type ListItem = {
  jobId: string
  title: string
  applyUrl: string
  location?: string
  careerLevel?: string
}

type JobPostingLd = {
  "@type"?: string | string[]
  title?: string
  description?: string
  datePosted?: string
  employmentType?: string | string[]
  identifier?: { value?: string | number }
  jobLocation?: unknown
}

function cleanSlug(value: string | undefined | null): string | null {
  if (!value) return null
  const v = value.trim().replace(/^\/+|\/+$/g, "").toLowerCase()
  // Portal paths are kebab segments separated by "/". Reject anything with
  // query strings, protocol, or obviously bad chars.
  if (!/^[a-z0-9][a-z0-9/-]{2,120}$/.test(v)) return null
  return v
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!/(^|\.)teamworkonline\.com$/i.test(parsed.hostname)) return null
  const parts = parsed.pathname.split("/").filter(Boolean)
  // A portal path is at least {sport}-jobs/{org}-jobs/{org}; a 4th segment is
  // an individual job detail page — trim it so we always land on the portal.
  if (parts.length < 3) return null
  const portalParts = parts.slice(0, 3)
  return cleanSlug(portalParts.join("/")) ? { slug: portalParts.join("/") } : null
}

function portalUrl(slug: string, page: number): string {
  const base = `${HOST}/${slug}`
  return page > 1 ? `${base}?page=${page}` : base
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&middot;/gi, "·")
    .replace(/&nbsp;/gi, " ")
    .trim()
}

function firstMatch(chunk: string, re: RegExp): string | undefined {
  const m = chunk.match(re)
  return m ? decodeEntities(m[1]) : undefined
}

/** Parse one portal page's HTML into listing items. */
export function parseListing(html: string): ListItem[] {
  const items: ListItem[] = []
  const chunks = html.split(JOB_CONTAINER)
  // chunks[0] is the pre-first-container preamble — skip it.
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i]
    const href = firstMatch(chunk, /href="(\/[^"]*?-(\d+))"/)
    if (!href) continue
    const idMatch = href.match(/-(\d+)(?:[/?#]|$)/)
    const jobId = idMatch?.[1]
    if (!jobId) continue
    const title =
      firstMatch(chunk, /job-title"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/) ??
      firstMatch(chunk, /job-title"[^>]*>([^<]+)</)
    if (!title) continue
    const location = firstMatch(chunk, /job-location"[^>]*>([^<]+)</)
    const careerLevel = firstMatch(chunk, /job__career-level"[^>]*>([^<]+)</)
    items.push({
      jobId,
      title,
      applyUrl: href.startsWith("http") ? href : `${HOST}${href}`,
      location: location ? location.replace(/\s*·\s*/g, ", ") : undefined,
      careerLevel,
    })
  }
  return items
}

function mapEmploymentType(et: string | string[] | undefined): string | undefined {
  if (!et) return undefined
  const raw = (Array.isArray(et) ? et[0] : et)?.toString().toLowerCase()
  if (!raw) return undefined
  if (raw.includes("intern")) return "internship"
  if (raw.includes("full")) return "full-time"
  if (raw.includes("part")) return "part-time"
  if (raw.includes("contract") || raw.includes("temporary")) return "contract"
  return undefined
}

function stripHtml(html: string | undefined | null): string | undefined {
  if (!html) return undefined
  return (
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|br|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || undefined
  )
}

function extractJobPostingLd(html: string): JobPostingLd | null {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1])
      const candidates = Array.isArray(parsed) ? parsed : [parsed]
      for (const c of candidates) {
        const t = c?.["@type"]
        const isJobPosting = Array.isArray(t)
          ? t.includes("JobPosting")
          : t === "JobPosting"
        if (isJobPosting) return c as JobPostingLd
      }
    } catch {
      /* skip malformed block */
    }
  }
  return null
}

function mapItem(item: ListItem): HarvestedJob {
  return {
    externalId: `teamworkonline:${item.jobId}`,
    title: item.title,
    applyUrl: item.applyUrl,
    location: item.location,
    contentHash: hashContent([item.title, item.applyUrl, item.location, item.careerLevel]),
  }
}

async function fetchText(url: string, ctx: HarvestCtx): Promise<string | null> {
  const doFetch = ctx.fetchImpl ?? harvesterFetch
  try {
    const resp = await doFetch(url, {
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    })
    if (!resp.ok) return null
    return await resp.text()
  } catch {
    return null
  }
}

export const teamworkOnlineAdapter: AtsAdapter = {
  name: "teamworkonline",
  concurrency: envConcurrency("teamworkonline", 3),
  detectFromUrl,

  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    const cleanedSlug = cleanSlug(slug)
    if (!cleanedSlug) throw new Error(`teamworkonline: invalid slug "${slug}"`)

    const byId = new Map<string, ListItem>()
    let pagesFetched = 0

    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await fetchText(portalUrl(cleanedSlug, page), ctx)
      if (!html) {
        if (page === 1) {
          const err = new Error(`teamworkonline: portal unreachable for ${cleanedSlug}`)
          ;(err as Error & { status?: number | null }).status = null
          throw err
        }
        break
      }
      pagesFetched += 1
      const items = parseListing(html)
      if (items.length === 0) break
      let added = 0
      for (const item of items) {
        if (!byId.has(item.jobId)) {
          byId.set(item.jobId, item)
          added += 1
        }
      }
      if (added === 0) break
    }

    if (pagesFetched === 0) {
      const err = new Error(`teamworkonline: no reachable pages for ${cleanedSlug}`)
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    const listItems = Array.from(byId.values())
    const jobs = new Map<string, HarvestedJob>()
    for (const item of listItems) jobs.set(`teamworkonline:${item.jobId}`, mapItem(item))

    // Enrich with JSON-LD descriptions from detail pages (bounded per cycle).
    const needDetail = ctx.alreadyDescribedIds
      ? listItems.filter((i) => !ctx.alreadyDescribedIds!.has(`teamworkonline:${i.jobId}`))
      : listItems

    if (DETAIL_MAX_JOBS > 0 && needDetail.length > 0) {
      const limiter = pLimit(DETAIL_CONCURRENCY)
      await Promise.all(
        needDetail.slice(0, DETAIL_MAX_JOBS).map((item) =>
          limiter(async () => {
            const html = await fetchText(item.applyUrl, ctx)
            if (!html) return
            const ld = extractJobPostingLd(html)
            if (!ld) return
            const description = stripHtml(ld.description)
            const employmentType = mapEmploymentType(ld.employmentType)
            const postedAt = ld.datePosted
              ? new Date(ld.datePosted).toISOString()
              : undefined
            const externalId = `teamworkonline:${item.jobId}`
            const base = jobs.get(externalId)!
            jobs.set(externalId, {
              ...base,
              description: description ?? base.description,
              employmentType: employmentType ?? base.employmentType,
              postedAt: postedAt ?? base.postedAt,
              contentHash: hashContent([
                base.title,
                base.applyUrl,
                base.location,
                employmentType,
                postedAt,
                description?.slice(0, 2_000),
              ]),
            })
          })
        )
      )
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "teamworkonline",
      sourceAtsSlug: cleanedSlug,
      fetchedAt,
      upstreamLatencyMs: Date.now() - startedAt,
    }
  },
}

export { detectFromUrl }

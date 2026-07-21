import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { fetchHtmlConditional } from "@/lib/harvester/adapters/_json-ld"

/**
 * Avature adapter (enterprise CRM-style ATS).
 *
 * Avature powers branded enterprise career portals. Each customer gets a
 * dedicated subdomain on avature.net; the tenant slug is the subdomain label,
 * e.g. https://acme.avature.net/careers/SearchJobs
 *
 * Avature serves the public job list as SERVER-RENDERED HTML (verified live:
 * `…/careers/SearchJobs` returns `200 text/html`, NOT JSON — the previous
 * JSON-API implementation failed on every tenant). We scrape the JobDetail
 * anchors and paginate with `?jobOffset=N`.
 *
 *   List page : GET {slug}.avature.net/careers/SearchJobs[?jobOffset=N]
 *               (locale tenants 302-redirect to /en_XX/careers/SearchJobs;
 *                fetchHtmlConditional follows redirects)
 *   Job link  : <host>/[locale/]careers/JobDetail/<Title-Slug>/<numericId>
 *   Paging    : jobOffset = number of jobs already collected (page size varies
 *               per tenant — 10/12/… — so tracking the running count matches
 *               each tenant's own pagination hrefs).
 *
 * Some tenants point their public career site at a branded custom domain
 * instead of the default <slug>.avature.net (e.g. Lenovo serves from
 * jobs.lenovo.com, not lenovo.avature.net — the latter is their internal
 * recruiter login portal and returns no public postings). CUSTOM_TENANTS
 * maps those domains to the tenant's slug + real listing path.
 */

const AVATURE_HOST_RE = /(^|\.)avature\.net$/
// Company token: letters / digits / dash, 2–64 chars.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/
// JobDetail anchor: capture the href and the anchor's inner HTML (the title).
const JOB_ANCHOR_RE = /<a\b[^>]*\bhref="([^"]*\/careers\/JobDetail\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
const JOB_PATH_RE = /\/careers\/JobDetail\/([^/?#]+)\/(\d+)/

const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_AVATURE_MAX_PAGES ?? "40", 10)
)

const CUSTOM_TENANTS: Array<{ host: string; slug: string; listPath: string }> = [
  { host: "jobs.lenovo.com", slug: "lenovo", listPath: "/en_US/careers/SearchJobs" },
]

function findCustomTenantByHost(host: string) {
  return CUSTOM_TENANTS.find((t) => t.host === host)
}

function findCustomTenantBySlug(slug: string) {
  return CUSTOM_TENANTS.find((t) => t.slug === slug)
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const custom = findCustomTenantByHost(host)
  if (custom) return { slug: custom.slug }
  if (!AVATURE_HOST_RE.test(host)) return null
  // <company>.avature.net — first subdomain label is the company token.
  const label = host.split(".")[0]
  if (label && label !== "www" && host !== "avature.net") {
    return SLUG_RE.test(label) ? { slug: label } : null
  }
  return null
}

function buildSearchUrl(slug: string, offset = 0): string {
  const custom = findCustomTenantBySlug(slug)
  const base = custom
    ? `https://${custom.host}${custom.listPath}`
    : `https://${encodeURIComponent(slug)}.avature.net/careers/SearchJobs`
  return offset > 0 ? `${base}?jobOffset=${offset}` : base
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&rsquo;|&#8217;/g, "'")
    .replace(/&nbsp;/g, " ")
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

function deslug(slug: string): string {
  let s = slug
  try {
    s = decodeURIComponent(slug)
  } catch {
    /* leave raw */
  }
  return s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

type AvatureLink = { jobId: string; title: string; url: string }

export function extractJobs(html: string, tenantHost: string): AvatureLink[] {
  const out = new Map<string, AvatureLink>()
  for (const m of html.matchAll(JOB_ANCHOR_RE)) {
    let absolute: URL
    try {
      absolute = new URL(decodeEntities(m[1]), `https://${tenantHost}/`)
    } catch {
      continue
    }
    const linkHost = absolute.hostname.toLowerCase()
    if (!AVATURE_HOST_RE.test(linkHost) && linkHost !== tenantHost.toLowerCase()) continue
    const pathMatch = absolute.pathname.match(JOB_PATH_RE)
    if (!pathMatch) continue
    const jobId = pathMatch[2]
    if (out.has(jobId)) continue
    const title = stripTags(m[2]) || deslug(pathMatch[1])
    if (!title) continue
    absolute.hash = ""
    absolute.search = ""
    out.set(jobId, { jobId, title, url: absolute.toString() })
  }
  return Array.from(out.values())
}

export function mapLinkToJob(slug: string, link: AvatureLink): HarvestedJob {
  return {
    externalId: `avature:${slug}:${link.jobId}`,
    title: link.title,
    applyUrl: link.url,
    contentHash: hashContent([link.title, link.url]),
  }
}

export const avatureAdapter: AtsAdapter = {
  name: "avature",
  concurrency: envConcurrency("avature", 4),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    if (!SLUG_RE.test(slug)) throw new Error(`avature malformed slug: ${slug}`)

    const custom = findCustomTenantBySlug(slug)
    const host = custom ? custom.host : `${slug.toLowerCase()}.avature.net`
    const jobs = new Map<string, HarvestedJob>()
    let latencyMs = 0
    let pagesFetched = 0
    let offset = 0
    let etag: string | null = ctx.etag ?? null
    let lastModified: string | null = ctx.lastModified ?? null

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await fetchHtmlConditional(buildSearchUrl(slug, offset), ctx)

      if (result.kind === "not_modified") {
        // First page unchanged since last harvest — skip the whole board.
        if (page === 0) {
          return {
            jobs: [],
            notModified: true,
            etag: result.etag,
            lastModified: result.lastModified,
            sourceAts: "avature",
            sourceAtsSlug: slug,
            fetchedAt,
            upstreamLatencyMs: result.upstreamLatencyMs,
          }
        }
        break
      }

      if (result.kind === "error") {
        if (page === 0) {
          const err = new Error(`avature fetch failed: ${result.reason}`)
          ;(err as Error & { status?: number | null }).status = result.status
          throw err
        }
        break
      }

      pagesFetched += 1
      latencyMs += result.upstreamLatencyMs
      if (page === 0) {
        etag = result.etag
        lastModified = result.lastModified
      }

      const links = extractJobs(result.html, host)
      if (links.length === 0) break
      let added = 0
      for (const link of links) {
        const job = mapLinkToJob(slug, link)
        if (jobs.has(job.externalId)) continue
        jobs.set(job.externalId, job)
        added += 1
      }
      // No new jobs on this page → either the end, or a tenant that ignores
      // jobOffset and re-serves page 1. Either way, stop.
      if (added === 0) break
      offset += links.length
    }

    if (pagesFetched === 0) {
      const err = new Error("avature fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag,
      lastModified,
      sourceAts: "avature",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(latencyMs, Date.now() - startedAt),
    }
  },
}

export { buildSearchUrl, detectFromUrl }

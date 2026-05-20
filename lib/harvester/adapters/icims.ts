import {
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
 * iCIMS public career portal. Slug is the full host
 *   careers-{tenant}.icims.com
 *   uscareers-{tenant}.icims.com
 *   careersat-{tenant}.icims.com
 *   {tenant}.icims.com
 *
 * iCIMS has no public JSON list endpoint. We page through
 *   /jobs/search?pr=N&in_iframe=1
 * extracting jobs from `<a class="iCIMS_Anchor" title="<jobId> - <title>">`
 * anchors. The job-detail page (`/jobs/<id>/<slug>/job?in_iframe=1`) embeds
 * a schema.org JobPosting JSON-LD block; we batch-fetch a bounded subset to
 * fill description / location / datePosted.
 *
 * Without `&in_iframe=1` many customers wrap iCIMS in a custom Next.js shell
 * that only iframe-injects the real content client-side — so the wire param
 * is required.
 */

const MAX_PAGES = 20
// Bumped 40 → 150. iCIMS detail pages need `&in_iframe=1` and are slow
// (~800-1500ms each customer); at concurrency 4 that's still ~30-60s of
// detail time, within the 240s lease. Previous cap left 36% of iCIMS
// rows description-less.
const DETAIL_MAX_JOBS = 150
const DETAIL_CONCURRENCY = 4

type JobLink = { jobId: string; title: string; url: string; host: string }

function endpointFor(host: string, pr = 0): string {
  return `https://${host}/jobs/search?pr=${pr}&in_iframe=1`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (!host.endsWith(".icims.com") && host !== "icims.com") return null
  // Reject asset / marketing / API hosts that aren't a customer portal.
  if (
    /^(cdn\d*|www|api|developer|images?|cookie-policy-scripts|community|partners|trust|legal)\.icims\.com$/.test(
      host
    )
  )
    return null
  // Reject internal/employee/region-scoped portals (auth required).
  const sub = host.replace(/\.icims\.com$/, "")
  if (
    /^(internal|faculty|facultycareers|alumni|retiree|login|signin)-/.test(sub)
  )
    return null
  if (/employee/.test(sub)) return null
  if (host === "icims.com") return null
  return { slug: host }
}

// Match any <a ...> opening tag. We then inspect attributes ourselves to
// avoid relying on attribute order (iCIMS varies: sometimes href→class→title,
// sometimes class→href→title).
const ANCHOR_TAG_RE = /<a\s+([^>]+?)>/gi

function attr(tagAttrs: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i")
  const m = tagAttrs.match(re)
  return m ? m[1] : null
}

function decodeHtmlEntitiesInUrl(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, "")
    .replace(/&#39;/g, "")
}

function parseAnchorTitle(raw: string): { jobId?: string; title: string } {
  // Anchor titles render as "<jobId> - <Title>"; defensively handle missing id.
  const trimmed = raw.replace(/\s+/g, " ").trim()
  const m = trimmed.match(/^(\d+)\s*[-–—]\s*(.+)$/)
  if (m) return { jobId: m[1], title: m[2].trim() }
  return { title: trimmed }
}

function extractJobLinks(html: string, host: string): JobLink[] {
  const out = new Map<string, JobLink>()

  for (const tagMatch of html.matchAll(ANCHOR_TAG_RE)) {
    const attrs = tagMatch[1]
    const cls = attr(attrs, "class")
    if (!cls || !/\biCIMS_Anchor\b/.test(cls)) continue
    const href = attr(attrs, "href")
    const titleAttr = attr(attrs, "title")
    if (!href || !titleAttr) continue

    let absolute: URL
    try {
      absolute = new URL(decodeHtmlEntitiesInUrl(href), `https://${host}/`)
    } catch {
      continue
    }
    const linkHost = absolute.hostname.toLowerCase()
    // Hub portals (careersat-*, etc.) federate jobs from a sibling portal
    // (externalcareers-*) on the same iCIMS namespace, so accept any
    // *.icims.com host rather than insisting on a host match.
    if (!linkHost.endsWith(".icims.com")) continue
    const pathMatch = absolute.pathname.match(/^\/jobs\/(\d+)\/[^/]+\/job\/?$/)
    if (!pathMatch) continue
    const jobIdFromUrl = pathMatch[1]
    const { jobId, title } = parseAnchorTitle(titleAttr)
    const resolvedId = jobId ?? jobIdFromUrl
    if (!title) continue
    // Use the job URL's host in the dedup key so the same job federated
    // through multiple hubs collapses to one entry.
    const dedupKey = `${linkHost}:${resolvedId}`
    if (out.has(dedupKey)) continue
    absolute.searchParams.delete("in_iframe")
    absolute.searchParams.delete("hub")
    out.set(dedupKey, {
      jobId: resolvedId,
      title,
      url: absolute.toString(),
      host: linkHost,
    })
  }

  return Array.from(out.values())
}

async function fetchAllJobLinks(host: string, ctx: HarvestCtx): Promise<JobLink[]> {
  const all = new Map<string, JobLink>()
  for (let pr = 0; pr < MAX_PAGES; pr++) {
    const result = await fetchHtmlConditional(endpointFor(host, pr), ctx)
    if (result.kind !== "ok") {
      if (pr === 0) {
        const err = new Error(`icims fetch failed: ${(result as { reason?: string }).reason ?? "unknown"}`)
        ;(err as Error & { status?: number | null }).status =
          (result as { status?: number | null }).status ?? null
        throw err
      }
      break
    }
    const pageLinks = extractJobLinks(result.html, host)
    if (pageLinks.length === 0) break
    let added = 0
    for (const link of pageLinks) {
      const key = `${link.host}:${link.jobId}`
      if (!all.has(key)) {
        all.set(key, link)
        added += 1
      }
    }
    // Stop when a page yields no NEW jobs (overlap with prior pages).
    if (added === 0) break
  }
  return Array.from(all.values())
}

async function fetchJobDetail(link: JobLink, ctx: HarvestCtx): Promise<HarvestedJob | null> {
  // Detail URLs require &in_iframe=1 just like the search page.
  const detailUrl = new URL(link.url)
  detailUrl.searchParams.set("in_iframe", "1")
  const result = await fetchHtmlConditional(detailUrl.toString(), ctx)
  if (result.kind !== "ok") return null
  const blocks = extractJsonLdBlocks(result.html)
  const mapped = mapJsonLdToHarvestedJobs(blocks, {
    sourceAts: "icims",
    fallbackUrl: link.url,
  })
  const first = mapped.find((j) => j.title) ?? null
  if (!first) return null
  return {
    ...first,
    externalId: `icims:${link.host}:${link.jobId}`,
    title: link.title || first.title,
    applyUrl: link.url,
  }
}

function shallowJob(link: JobLink): HarvestedJob {
  return {
    externalId: `icims:${link.host}:${link.jobId}`,
    title: link.title,
    applyUrl: link.url,
    contentHash: hashContent([link.title, link.url]),
  }
}

async function enrichWithDetails(links: JobLink[], ctx: HarvestCtx): Promise<HarvestedJob[]> {
  const enriched = new Map<string, HarvestedJob>()
  // Skip links whose externalId already has a real description in the DB.
  // External ID shape is `icims:{host}:{jobId}` (see shallowJob/fetchJobDetail).
  const alreadyDescribed = ctx.alreadyDescribedIds
  const linksNeedingDetail = alreadyDescribed
    ? links.filter((link) => !alreadyDescribed.has(`icims:${link.host}:${link.jobId}`))
    : links
  const targets = linksNeedingDetail.slice(0, DETAIL_MAX_JOBS)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(DETAIL_CONCURRENCY, targets.length) }, async () => {
      while (true) {
        const idx = cursor++
        if (idx >= targets.length) return
        const link = targets[idx]
        const detail = await fetchJobDetail(link, ctx)
        if (detail) enriched.set(`${link.host}:${link.jobId}`, detail)
      }
    })
  )
  return links.map((link) => enriched.get(`${link.host}:${link.jobId}`) ?? shallowJob(link))
}

export const icimsAdapter: AtsAdapter = {
  name: "icims",
  // iCIMS sites are slow + customer-isolated; keep concurrency low.
  // Per-process limit; with N replicas the cluster total is N×this. Lowered
  // from 3 → 2 so 2 workers stay near the original cluster budget.
  concurrency: 2,
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const host = slug.toLowerCase()
    const startedAt = Date.now()

    const links = await fetchAllJobLinks(host, ctx)
    const jobs = links.length === 0 ? [] : await enrichWithDetails(links, ctx)

    return {
      jobs,
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "icims",
      sourceAtsSlug: host,
      fetchedAt,
      upstreamLatencyMs: Date.now() - startedAt,
    }
  },
}

// Exported for one-shot description backfills / scripts.
export { fetchAllJobLinks, fetchJobDetail, extractJobLinks }

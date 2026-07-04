import {
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

/**
 * Sitemap-driven JSON-LD adapter.
 *
 * For big custom/enterprise career sites (Phenom "Canvas", Radancy, in-house)
 * whose listing pages are JS-rendered (so the generic `jsonld` adapter can't
 * scrape the index) BUT which:
 *   1. publish an XML **sitemap** of individual job-detail URLs, and
 *   2. embed a schema.org **JobPosting** JSON-LD block on each detail page.
 *
 * e.g. UPS (careers on Phenom Canvas): /us/en/sitemap_index.xml → ~600 job
 * URLs → each `/us/en/job/{id}/{slug}` page has a full JobPosting block.
 *
 * Enroll by setting ats_type='sitemapjsonld' and ats_identifier (or careers_url)
 * to the sitemap (index or urlset) URL. We enumerate the sitemap (one level of
 * index nesting), fetch each job page (bounded concurrency), and reuse the
 * shared JSON-LD mapper. The detail URL from the sitemap is authoritative, so we
 * drop any generic `url` on the JobPosting and use the sitemap URL as applyUrl.
 *
 * Tunables:
 *   HARVESTER_SITEMAPJSONLD_MAX_JOBS      (default 2500)
 *   HARVESTER_SITEMAPJSONLD_CONCURRENCY   (default 4)
 *   HARVESTER_SITEMAPJSONLD_JOB_URL_RE    (default "/job/i" — job-detail path;
 *       matches UPS/McDonald's/Kaiser `…/job/…` while excluding `/category/…-jobs/`)
 * Gated by the sitemapjsonld per-company timeout (worker.ts).
 */

function intEnv(name: string, dflt: number, min = 1): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}

const MAX_JOBS = intEnv("HARVESTER_SITEMAPJSONLD_MAX_JOBS", 2500)
const CONCURRENCY = intEnv("HARVESTER_SITEMAPJSONLD_CONCURRENCY", 4)
const MAX_SUBMAPS = 30
const JOB_URL_RE = (() => {
  const raw = process.env.HARVESTER_SITEMAPJSONLD_JOB_URL_RE?.trim()
  try {
    return raw ? new RegExp(raw, "i") : /\/job\//i
  } catch {
    return /\/job\//i
  }
})()
const XML_RE = /\.xml($|\?)/i

function parseLocs(xml: string): string[] {
  const out: string[] = []
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    out.push(
      m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim()
    )
  }
  return out
}

// Enumerate a sitemap (index or urlset, one level of nesting) → deduped job URLs.
async function collectJobUrls(
  sitemapUrl: string,
  ctx: HarvestCtx
): Promise<
  | { kind: "not_modified"; etag: string | null; lastModified: string | null; upstreamLatencyMs: number }
  | { kind: "error"; reason: string; status: number | null; upstreamLatencyMs: number }
  | { kind: "ok"; urls: string[]; etag: string | null; lastModified: string | null; upstreamLatencyMs: number }
> {
  const first = await fetchHtmlConditional(sitemapUrl, ctx, { maxAttempts: 3 })
  if (first.kind === "not_modified") return { kind: "not_modified", etag: first.etag, lastModified: first.lastModified, upstreamLatencyMs: first.upstreamLatencyMs }
  if (first.kind === "error") return { kind: "error", reason: first.reason, status: first.status, upstreamLatencyMs: first.upstreamLatencyMs }

  let latency = first.upstreamLatencyMs
  const locs = parseLocs(first.html)
  const subMaps = locs.filter((u) => XML_RE.test(u)).slice(0, MAX_SUBMAPS)
  const pageUrls = locs.filter((u) => !XML_RE.test(u))

  const subCtx: HarvestCtx = { ...ctx, etag: null, lastModified: null }
  for (const sub of subMaps) {
    const r = await fetchHtmlConditional(sub, subCtx, { maxAttempts: 2 })
    if (r.kind === "ok") {
      latency += r.upstreamLatencyMs
      pageUrls.push(...parseLocs(r.html))
    }
  }

  const seen = new Set<string>()
  const jobUrls: string[] = []
  for (const u of pageUrls) {
    if (!JOB_URL_RE.test(u) || seen.has(u)) continue
    seen.add(u)
    jobUrls.push(u)
    if (jobUrls.length >= MAX_JOBS) break
  }
  return { kind: "ok", urls: jobUrls, etag: first.etag, lastModified: first.lastModified, upstreamLatencyMs: latency }
}

export const sitemapJsonLdAdapter: AtsAdapter = {
  name: "sitemapjsonld",
  concurrency: 1, // one company at a time; page fetches parallelize inside fetchJobs
  detectFromUrl() {
    // Enrolled explicitly via ats_type (the sitemap URL can't be pattern-detected).
    return null
  },
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()

    const idx = await collectJobUrls(slug, ctx)
    if (idx.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: idx.etag,
        lastModified: idx.lastModified,
        sourceAts: "sitemapjsonld",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: idx.upstreamLatencyMs,
      }
    }
    if (idx.kind === "error") {
      const err = new Error(`sitemapjsonld sitemap fetch failed: ${idx.reason}`)
      ;(err as Error & { status?: number | null }).status = idx.status
      throw err
    }
    if (idx.urls.length === 0) {
      const err = new Error("sitemapjsonld: sitemap had no job URLs")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    const jobUrls = idx.urls
    const jobs = new Map<string, HarvestedJob>()
    const pageCtx: HarvestCtx = {
      ...ctx,
      etag: null,
      lastModified: null,
      timeoutMs: Math.max(ctx.timeoutMs ?? 0, 12_000),
    }
    let latencyMs = idx.upstreamLatencyMs
    let cursor = 0

    async function worker(): Promise<void> {
      while (cursor < jobUrls.length) {
        const url = jobUrls[cursor++]
        const res = await fetchHtmlConditional(url, pageCtx, { maxAttempts: 2 })
        if (res.kind !== "ok") continue
        latencyMs += res.upstreamLatencyMs
        const blocks = extractJsonLdBlocks(res.html)
        // The sitemap URL is the authoritative job page — drop any generic `url`
        // on the JobPosting so applyUrl resolves to this page, not a site root.
        for (const b of blocks) {
          if (b && typeof b === "object") delete (b as { url?: unknown }).url
        }
        const mapped = mapJsonLdToHarvestedJobs(blocks, {
          sourceAts: "sitemapjsonld",
          fallbackUrl: url,
        })
        for (const j of mapped) if (!jobs.has(j.externalId)) jobs.set(j.externalId, j)
      }
    }

    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(CONCURRENCY, jobUrls.length)) }, () => worker())
    )

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: idx.etag,
      lastModified: idx.lastModified,
      sourceAts: "sitemapjsonld",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: latencyMs || Date.now() - startedAt,
    }
  },
}

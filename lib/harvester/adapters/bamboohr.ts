import {
  type AtsAdapter,
  type HarvestResult,
} from "@/lib/harvester/adapters/_base"
import {
  extractJsonLdBlocks,
  fetchHtmlConditional,
  mapJsonLdToHarvestedJobs,
} from "@/lib/harvester/adapters/_json-ld"

/**
 * BambooHR public careers page.
 *   https://{slug}.bamboohr.com/careers
 *
 * BambooHR doesn't expose a clean public JSON board — but every published
 * career page renders schema.org JobPosting blocks via JSON-LD. We extract
 * those rather than scraping the rendered job list.
 */

function endpointFor(slug: string): string {
  return `https://${encodeURIComponent(slug)}.bamboohr.com/careers`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const m = host.match(/^([a-z0-9-]+)\.bamboohr\.com$/)
  if (!m) return null
  const slug = m[1]
  if (slug === "www" || slug === "app" || slug === "api") return null
  return { slug }
}

export const bamboohrAdapter: AtsAdapter = {
  name: "bamboohr",
  // HTML + JSON-LD; per-customer host so contention is naturally low.
  concurrency: 6,
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const url = endpointFor(slug)
    const result = await fetchHtmlConditional(url, ctx)

    if (result.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: result.etag,
        lastModified: result.lastModified,
        sourceAts: "bamboohr",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }
    if (result.kind === "error") {
      const err = new Error(`bamboohr fetch failed: ${result.reason}`)
      ;(err as Error & { status?: number | null }).status = result.status
      throw err
    }

    const blocks = extractJsonLdBlocks(result.html)
    const jobs = mapJsonLdToHarvestedJobs(blocks, {
      sourceAts: "bamboohr",
      fallbackUrl: url,
    })

    return {
      jobs,
      notModified: false,
      etag: result.etag,
      lastModified: result.lastModified,
      sourceAts: "bamboohr",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}

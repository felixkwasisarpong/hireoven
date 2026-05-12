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
 * JazzHR (now Employ Inc, hosted at applytojob.com) public board.
 *   https://{slug}.applytojob.com
 *
 * Like BambooHR, JazzHR career pages render schema.org JobPosting JSON-LD
 * blocks. No dedicated JSON list endpoint is reliable across customers.
 */

function endpointFor(slug: string): string {
  return `https://${encodeURIComponent(slug)}.applytojob.com/`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const m = host.match(/^([a-z0-9-]+)\.applytojob\.com$/)
  if (!m) return null
  const slug = m[1]
  if (slug === "www" || slug === "app" || slug === "api") return null
  return { slug }
}

export const jazzhrAdapter: AtsAdapter = {
  name: "jazzhr",
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
        sourceAts: "jazzhr",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }
    if (result.kind === "error") {
      const err = new Error(`jazzhr fetch failed: ${result.reason}`)
      ;(err as Error & { status?: number | null }).status = result.status
      throw err
    }

    const blocks = extractJsonLdBlocks(result.html)
    const jobs = mapJsonLdToHarvestedJobs(blocks, {
      sourceAts: "jazzhr",
      fallbackUrl: url,
    })

    return {
      jobs,
      notModified: false,
      etag: result.etag,
      lastModified: result.lastModified,
      sourceAts: "jazzhr",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}

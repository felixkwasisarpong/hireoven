import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { fetchHtmlConditional } from "@/lib/harvester/adapters/_json-ld"

/**
 * JazzHR (Employ Inc, hosted at applytojob.com) public board.
 *   https://{slug}.applytojob.com/
 *
 * JazzHR pages only carry an Organization JSON-LD block — there is NO JobPosting
 * markup anywhere (not even on detail pages) — so JSON-LD scraping yields zero
 * jobs. The board HTML server-renders one link per opening as
 * /apply/{code}/{Title-Slug}; we parse those. Titles come from the URL slug;
 * descriptions are left to the description-enrichment pass (applytojob detail
 * pages are plain, fetchable HTML, not bot-walled).
 */

// Job links look like /apply/4ajHWUFtxf/Sales-Account-Executive — a ~10-char
// alphanumeric code followed by a title slug. The {8,} code length excludes
// /apply/confirm/, /apply/jobs.js, /apply/submit-resume.js, etc.
const JOB_PATH_RE = /\/apply\/([A-Za-z0-9]{8,})\/([A-Za-z0-9][^"'\\\s?#]*)/g

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

function titleFromSlug(titleSlug: string): string {
  let decoded = titleSlug
  try {
    decoded = decodeURIComponent(titleSlug)
  } catch {
    /* keep raw on malformed escapes */
  }
  return decoded
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function extractJobs(slug: string, html: string): HarvestedJob[] {
  const seen = new Set<string>()
  const jobs: HarvestedJob[] = []
  for (const m of html.matchAll(JOB_PATH_RE)) {
    const code = m[1]
    const titleSlug = m[2]
    // Skip static assets that happen to live under /apply/.
    if (/\.(js|css|json|png|jpe?g|svg|gif|ico|map)$/i.test(titleSlug)) continue
    if (seen.has(code)) continue
    seen.add(code)
    const title = titleFromSlug(titleSlug)
    if (!title) continue
    const applyUrl = `https://${slug}.applytojob.com/apply/${code}/${titleSlug}`
    jobs.push({
      externalId: `jazzhr:${slug}:${code}`,
      title,
      applyUrl,
      contentHash: hashContent([title, applyUrl]),
    })
  }
  return jobs
}

export const jazzhrAdapter: AtsAdapter = {
  name: "jazzhr",
  concurrency: envConcurrency("jazzhr", 6),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const result = await fetchHtmlConditional(endpointFor(slug), ctx)

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

    const jobs = extractJobs(slug, result.html)

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

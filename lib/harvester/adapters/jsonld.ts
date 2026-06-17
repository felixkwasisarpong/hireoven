/**
 * Generic JSON-LD adapter.
 *
 * Targets companies that post structured schema.org/JobPosting data on their
 * own careers page but don't use a standard ATS platform. Set a company's
 * ats_type to "jsonld" and careers_url to the page that contains the job
 * listings; the adapter fetches that page, extracts every <script
 * type="application/ld+json"> JobPosting block, and returns them as harvested
 * jobs.
 *
 * Slug (passed by detectCompanyAdapter): the URL to fetch. Prefer
 * ats_identifier when set (allows pointing to a more specific listing page),
 * otherwise falls back to careers_url.
 *
 * Limitations: only works for pages that already embed JSON-LD — JS-rendered
 * SPA pages that hydrate job data after the initial HTML load won't work here
 * (use a custom adapter like apple.ts for those).
 */

import {
  hashContent,
  type AtsAdapter,
  type HarvestResult,
} from "@/lib/harvester/adapters/_base"
import {
  fetchHtmlConditional,
  extractJsonLdBlocks,
  mapJsonLdToHarvestedJobs,
} from "@/lib/harvester/adapters/_json-ld"

export const jsonldAdapter: AtsAdapter = {
  name: "jsonld",

  detectFromUrl(_url) {
    // No URL-pattern detection — companies are enrolled explicitly via ats_type.
    return null
  },

  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const url = slug // slug is the careers_url / ats_identifier for this adapter
    const fetchedAt = new Date()

    const res = await fetchHtmlConditional(url, ctx, { maxAttempts: 3 })

    if (res.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: res.etag,
        lastModified: res.lastModified,
        sourceAts: "jsonld",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: res.upstreamLatencyMs,
      }
    }

    if (res.kind === "error") {
      throw new Error(`jsonld fetch failed: ${res.reason} (status=${res.status ?? "none"})`)
    }

    const blocks = extractJsonLdBlocks(res.html)
    const jobs = mapJsonLdToHarvestedJobs(blocks, {
      sourceAts: "jsonld",
      fallbackUrl: url,
    })

    return {
      jobs,
      notModified: false,
      etag: res.etag,
      lastModified: res.lastModified,
      sourceAts: "jsonld",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: res.upstreamLatencyMs,
    }
  },
}

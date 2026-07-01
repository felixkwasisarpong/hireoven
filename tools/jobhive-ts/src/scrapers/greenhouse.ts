/**
 * Greenhouse — TS port of jobhive.scrapers.greenhouse.
 *
 * Public board API (no auth): boards-api.greenhouse.io/v1/boards/{slug}/jobs
 * `?content=true` inlines the full HTML description so we avoid per-job detail
 * fetches. `first_published` is the stable posted-at.
 */

import { BaseScraper, register } from "../base.js"
import { fetchJson, cleanHtml, parseIso } from "../http.js"
import { CompanyNotFoundError, ScraperError, type ReplicaJob } from "../types.js"

type GhJob = {
  id: number
  title?: string
  absolute_url?: string
  content?: string
  location?: { name?: string }
  first_published?: string
  updated_at?: string
  metadata?: unknown
}

class GreenhouseScraper extends BaseScraper {
  readonly ats = "greenhouse"

  async fetch(slug: string): Promise<ReplicaJob[]> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`
    const res = await fetchJson<{ jobs?: GhJob[] }>(url, { timeoutMs: 30_000 })
    if (!res.ok) {
      if (res.status === 404) throw new CompanyNotFoundError(`Greenhouse board not found: ${slug}`)
      throw new ScraperError(`Greenhouse ${slug} → ${res.reason}`)
    }
    return (res.data.jobs ?? []).map((j) => this.parse(j))
  }

  private parse(item: GhJob): ReplicaJob {
    return {
      externalId: `greenhouse:${item.id}`,
      title: item.title ?? "Untitled",
      applyUrl: item.absolute_url ?? "",
      description: cleanHtml(item.content),
      location: item.location?.name,
      postedAt: parseIso(item.first_published) ?? parseIso(item.updated_at),
    }
  }
}

register(new GreenhouseScraper())

/**
 * BaseScraper + registry — TS port of jobhive.scrapers.base.
 *
 * Each scraper is registered by its ATS name and implements `fetch(slug)`
 * returning a ScrapeResult. The registry is the only lookup mechanism.
 */

import type { ReplicaJob, ScrapeResult } from "./types.js"

export abstract class BaseScraper {
  abstract readonly ats: string
  /** Fetch all active jobs for one company slug. */
  abstract fetch(slug: string, signal?: AbortSignal): Promise<ReplicaJob[]>

  /** Wrap fetch() with timing + uniform error handling → ScrapeResult. */
  async run(slug: string, signal?: AbortSignal): Promise<ScrapeResult> {
    const start = Date.now()
    try {
      const jobs = await this.fetch(slug, signal)
      return { ats: this.ats, slug, jobs, latencyMs: Date.now() - start }
    } catch (err) {
      const e = err as Error
      const notFound = e.name === "CompanyNotFoundError"
      return {
        ats: this.ats,
        slug,
        jobs: [],
        latencyMs: Date.now() - start,
        error: e.message || String(err),
        notFound,
      }
    }
  }
}

const registry = new Map<string, BaseScraper>()

export function register(scraper: BaseScraper): void {
  registry.set(scraper.ats, scraper)
}

export function getScraper(ats: string): BaseScraper | undefined {
  return registry.get(ats)
}

export function registeredAts(): string[] {
  return [...registry.keys()].sort()
}

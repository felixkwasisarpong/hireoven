export interface CrawlTarget {
  id: string
  companyName: string
  careersUrl: string
  lastCrawledAt: Date | null
}

export interface RawJob {
  title: string
  url: string
  location?: string
  postedAt?: string
}

export interface CrawlResult {
  url: string
  jobs: RawJob[]
  crawledAt: Date
}

export async function crawlCareersPage(
  target: CrawlTarget
): Promise<CrawlResult> {
  // TODO: implement crawler logic
  return {
    url: target.careersUrl,
    jobs: [],
    crawledAt: new Date(),
  }
}

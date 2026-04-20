export interface CrawlTarget {
  id: string
  companyName: string
  careersUrl: string
  lastCrawledAt: Date | null
}

export interface RawJob {
  externalId?: string
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

function parseGreenhouseBoard(url: URL) {
  if (url.hostname === "boards.greenhouse.io") {
    const slug = url.pathname.split("/").filter(Boolean)[0]
    return slug ?? null
  }
  if (url.hostname.endsWith(".greenhouse.io")) {
    return url.hostname.split(".")[0] ?? null
  }
  return null
}

function parseLeverCompany(url: URL) {
  if (url.hostname !== "jobs.lever.co") return null
  return url.pathname.split("/").filter(Boolean)[0] ?? null
}

function parseAshbyCompany(url: URL) {
  if (url.hostname !== "jobs.ashbyhq.com") return null
  return url.pathname.split("/").filter(Boolean)[0] ?? null
}

function parseWorkdayContext(url: URL) {
  if (!url.hostname.includes("myworkdayjobs.com")) return null
  const parts = url.pathname.split("/").filter(Boolean)
  const enUsIndex = parts.findIndex((part) => part.toLowerCase() === "en-us")
  const site = enUsIndex >= 0 ? parts[enUsIndex + 1] : null
  if (!site) return null
  return {
    tenantHost: url.hostname,
    site,
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HireovenCrawler/1.0; +https://hireoven.com)",
      },
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function crawlGreenhouse(careersUrl: URL): Promise<RawJob[]> {
  const board = parseGreenhouseBoard(careersUrl)
  if (!board) return []

  const payload = await fetchJson<{
    jobs?: Array<{
      id: number
      title: string
      absolute_url: string
      location?: { name?: string }
      updated_at?: string
    }>
  }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`)

  const jobs = payload?.jobs ?? []
  return jobs
    .filter((job) => job?.title && job?.absolute_url)
    .map((job) => ({
      externalId: `greenhouse:${job.id}`,
      title: job.title,
      url: job.absolute_url,
      location: job.location?.name,
      postedAt: job.updated_at,
    }))
}

async function crawlLever(careersUrl: URL): Promise<RawJob[]> {
  const company = parseLeverCompany(careersUrl)
  if (!company) return []

  const payload = await fetchJson<
    Array<{
      id: string
      text: string
      hostedUrl: string
      categories?: { location?: string }
      createdAt?: number
    }>
  >(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`)

  const jobs = payload ?? []
  return jobs
    .filter((job) => job?.id && job?.text && job?.hostedUrl)
    .map((job) => ({
      externalId: `lever:${job.id}`,
      title: job.text,
      url: job.hostedUrl,
      location: job.categories?.location,
      postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : undefined,
    }))
}

async function crawlAshby(careersUrl: URL): Promise<RawJob[]> {
  const company = parseAshbyCompany(careersUrl)
  if (!company) return []

  const html = await fetchJson<string>(
    `https://jobs.ashbyhq.com/${encodeURIComponent(company)}`
  )

  // fetchJson<string> is not ideal for HTML; fallback below if parser returns null.
  let markup: string | null = null
  if (typeof html === "string") {
    markup = html
  } else {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(
        `https://jobs.ashbyhq.com/${encodeURIComponent(company)}`,
        {
          method: "GET",
          signal: controller.signal,
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; HireovenCrawler/1.0; +https://hireoven.com)",
          },
        }
      )
      if (response.ok) {
        markup = await response.text()
      }
    } catch {
      markup = null
    } finally {
      clearTimeout(timeout)
    }
  }

  if (!markup) return []

  const linkRegex = /href="(\/[^"]+\/job\/[^"]+)"/gi
  const jobs: RawJob[] = []
  const seen = new Set<string>()
  for (const match of markup.matchAll(linkRegex)) {
    const path = match[1]
    const fullUrl = `https://jobs.ashbyhq.com${path}`
    if (seen.has(fullUrl)) continue
    seen.add(fullUrl)

    const segments = path.split("/").filter(Boolean)
    const externalId = segments[segments.length - 1] ?? fullUrl
    jobs.push({
      externalId: `ashby:${externalId}`,
      title: segments[segments.length - 2]?.replace(/-/g, " ") ?? "Open role",
      url: fullUrl,
    })
  }

  return jobs
}

async function crawlWorkday(careersUrl: URL): Promise<RawJob[]> {
  const context = parseWorkdayContext(careersUrl)
  if (!context) return []

  const jobsApi = `https://${context.tenantHost}/wday/cxs/${encodeURIComponent(
    context.site
  )}/${encodeURIComponent(context.site)}/jobs`

  const payload = await fetchJson<{
    jobPostings?: Array<{
      externalPath?: string
      title?: string
      location?: string
      postedOn?: string
      bulletFields?: string[]
    }>
  }>(jobsApi)

  const postings = payload?.jobPostings ?? []
  return postings
    .filter((posting) => posting.title && posting.externalPath)
    .map((posting) => ({
      externalId: `workday:${posting.externalPath}`,
      title: posting.title!,
      url: `https://${context.tenantHost}/en-US/${context.site}${posting.externalPath}`,
      location: posting.location ?? posting.bulletFields?.[0],
      postedAt: posting.postedOn,
    }))
}

async function crawlByKnownAts(careersUrl: URL): Promise<RawJob[]> {
  const greenhouseBoard = parseGreenhouseBoard(careersUrl)
  if (greenhouseBoard) {
    return crawlGreenhouse(careersUrl)
  }

  const leverCompany = parseLeverCompany(careersUrl)
  if (leverCompany) {
    return crawlLever(careersUrl)
  }

  const ashbyCompany = parseAshbyCompany(careersUrl)
  if (ashbyCompany) {
    return crawlAshby(careersUrl)
  }

  const workdayContext = parseWorkdayContext(careersUrl)
  if (workdayContext) {
    return crawlWorkday(careersUrl)
  }

  return []
}

async function discoverAndCrawlFromHtml(careersUrl: URL): Promise<RawJob[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(careersUrl.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HireovenCrawler/1.0; +https://hireoven.com)",
      },
    })
    if (!response.ok) return []
    const html = await response.text()

    const greenhouseMatch = html.match(/https?:\/\/boards\.greenhouse\.io\/([a-z0-9_-]+)/i)
    if (greenhouseMatch?.[1]) {
      const proxyUrl = new URL(`https://boards.greenhouse.io/${greenhouseMatch[1]}`)
      return crawlGreenhouse(proxyUrl)
    }

    const leverMatch = html.match(/https?:\/\/jobs\.lever\.co\/([a-z0-9_-]+)/i)
    if (leverMatch?.[1]) {
      const proxyUrl = new URL(`https://jobs.lever.co/${leverMatch[1]}`)
      return crawlLever(proxyUrl)
    }

    const ashbyMatch = html.match(/https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i)
    if (ashbyMatch?.[1]) {
      const proxyUrl = new URL(`https://jobs.ashbyhq.com/${ashbyMatch[1]}`)
      return crawlAshby(proxyUrl)
    }

    const workdayMatch = html.match(/https?:\/\/([a-z0-9.-]*myworkdayjobs\.com)\/en-us\/([a-z0-9._-]+)/i)
    if (workdayMatch?.[1] && workdayMatch?.[2]) {
      const proxyUrl = new URL(`https://${workdayMatch[1]}/en-us/${workdayMatch[2]}`)
      return crawlWorkday(proxyUrl)
    }

    return []
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

function dedupeJobs(jobs: RawJob[]) {
  const map = new Map<string, RawJob>()
  for (const job of jobs) {
    const key = job.externalId ?? job.url
    if (!key) continue
    map.set(key, job)
  }
  return [...map.values()]
}

export async function crawlCareersPage(
  target: CrawlTarget
): Promise<CrawlResult> {
  const careersUrl = new URL(target.careersUrl)
  const fromKnownAts = await crawlByKnownAts(careersUrl)
  const jobs =
    fromKnownAts.length > 0
      ? fromKnownAts
      : await discoverAndCrawlFromHtml(careersUrl)

  return {
    url: target.careersUrl,
    jobs: dedupeJobs(jobs),
    crawledAt: new Date(),
  }
}

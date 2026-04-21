export interface CrawlTarget {
  id: string
  companyName: string
  careersUrl: string
  lastCrawledAt: Date | null
  atsType?: string | null
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

const USER_AGENT =
  "Mozilla/5.0 (compatible; HireovenCrawler/1.0; +https://hireoven.com)"
const FETCH_TIMEOUT_MS = 12_000
const MAX_DISCOVERED_ATS_CANDIDATES = 12
const MAX_GENERIC_JOBS = 250
const WORKDAY_FALLBACK_MAX_ATTEMPTS = 48
const WORKDAY_HOST_SHARDS = [1, 2, 3, 4, 5]

const WORKDAY_PATH_STOPWORDS = new Set([
  "job",
  "jobs",
  "search",
  "recruiting",
  "career",
  "careers",
  "details",
])

const GENERIC_JOB_PATH_HINTS = [
  "/job/",
  "/jobs/",
  "/position/",
  "/positions/",
  "/opening/",
  "/openings/",
  "/opportunity/",
  "/opportunities/",
  "/requisition/",
  "/requisitions/",
]

const GENERIC_BLOCKED_PATH_HINTS = [
  "/about",
  "/blog",
  "/news",
  "/press",
  "/privacy",
  "/terms",
  "/cookie",
  "/contact",
  "/help",
  "/faq",
  "/investor",
  "/events",
]

const ROLE_TEXT_HINT =
  /\b(engineer|developer|scientist|analyst|manager|director|intern|architect|designer|consultant|specialist|lead|principal|product|data|software)\b/i

const GENERIC_ANCHOR_TEXT =
  /^(learn more|read more|view all jobs?|all jobs?|careers?|search jobs?|apply now|apply|see all|details?)$/i

const COMPANY_STOPWORDS = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "llc",
  "ltd",
  "limited",
  "plc",
  "group",
  "holdings",
  "international",
  "global",
  "technologies",
  "technology",
  "systems",
  "services",
  "solutions",
  "us",
  "usa",
])

function parseGreenhouseBoard(url: URL) {
  const host = url.hostname.toLowerCase()
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const slug = url.pathname.split("/").filter(Boolean)[0]
    return slug ?? null
  }
  if (host.endsWith(".greenhouse.io")) {
    return host.split(".")[0] ?? null
  }
  return null
}

function parseLeverCompany(url: URL) {
  if (url.hostname.toLowerCase() !== "jobs.lever.co") return null
  return url.pathname.split("/").filter(Boolean)[0] ?? null
}

function parseAshbyCompany(url: URL) {
  if (url.hostname.toLowerCase() !== "jobs.ashbyhq.com") return null
  return url.pathname.split("/").filter(Boolean)[0] ?? null
}

function parseIcimsPortal(url: URL) {
  const host = url.hostname.toLowerCase()
  return host === "icims.com" || host.endsWith(".icims.com")
}

function parseBambooPortal(url: URL) {
  const host = url.hostname.toLowerCase()
  return host === "bamboohr.com" || host.endsWith(".bamboohr.com")
}

function isLocaleSegment(part: string) {
  return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(part)
}

function parseWorkdayContext(url: URL): {
  tenantHost: string
  tenant: string
  sites: string[]
} | null {
  const host = url.hostname.toLowerCase()
  if (!host.includes("myworkdayjobs.com")) return null

  const tenant = host.split(".")[0]
  if (!tenant) return null

  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((p) => decodeURIComponent(p).trim())
    .filter(Boolean)

  const siteCandidates = new Set<string>()
  for (let i = 0; i < Math.min(parts.length, 8); i++) {
    const part = parts[i]
    if (!part) continue
    const lower = part.toLowerCase()
    if (isLocaleSegment(part)) continue
    if (WORKDAY_PATH_STOPWORDS.has(lower)) continue
    if (lower.startsWith("job")) continue
    if (!/[a-z]/i.test(part)) continue
    siteCandidates.add(part)
  }

  // Common path shape: /en-US/<site>/...
  if (parts[0] && isLocaleSegment(parts[0]) && parts[1]) {
    siteCandidates.add(parts[1])
  }
  // Common path shape: /<site>/...
  if (parts[0] && !isLocaleSegment(parts[0])) {
    siteCandidates.add(parts[0])
  }

  const sites = [...siteCandidates].slice(0, 6)
  if (sites.length === 0) return null

  return {
    tenantHost: host,
    tenant,
    sites,
  }
}

type WorkdayContext = {
  tenantHost: string
  tenant: string
  sites: string[]
}

type WorkdayPosting = {
  externalPath?: string
  title?: string
  location?: string
  locationsText?: string
  postedOn?: string
  bulletFields?: string[]
}

function buildRequestHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra ?? {})
  if (!headers.has("user-agent")) {
    headers.set("user-agent", USER_AGENT)
  }
  return headers
}

async function fetchText(
  url: string,
  init: RequestInit = {}
): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: buildRequestHeaders(init.headers),
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: buildRequestHeaders(),
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchWorkdayPostings(
  context: WorkdayContext,
  site: string
): Promise<WorkdayPosting[]> {
  const jobsApi = `https://${context.tenantHost}/wday/cxs/${encodeURIComponent(
    context.tenant
  )}/${encodeURIComponent(site)}/jobs`

  const collected: WorkdayPosting[] = []
  let sawHttp200 = false

  for (let offset = 0; offset < 100; offset += 20) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(jobsApi, {
        method: "POST",
        signal: controller.signal,
        headers: buildRequestHeaders({
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          appliedFacets: {},
          limit: 20,
          offset,
          searchText: "",
        }),
      })
      if (!response.ok) break
      sawHttp200 = true

      const payload = (await response.json()) as {
        jobPostings?: WorkdayPosting[]
      }

      const postings = payload?.jobPostings ?? []
      if (postings.length === 0) break
      collected.push(...postings)
      if (postings.length < 20) break
    } catch {
      break
    } finally {
      clearTimeout(timeout)
    }
  }

  if (collected.length === 0 && !sawHttp200) {
    const payload = await fetchJson<{
      jobPostings?: WorkdayPosting[]
    }>(jobsApi)
    if ((payload?.jobPostings?.length ?? 0) > 0) {
      collected.push(...(payload?.jobPostings ?? []))
    }
  }

  return collected
}

function mapWorkdayPostings(
  context: WorkdayContext,
  site: string,
  postings: WorkdayPosting[]
): RawJob[] {
  const deduped = new Map<string, WorkdayPosting>()
  for (const posting of postings) {
    if (!posting.externalPath) continue
    deduped.set(posting.externalPath, posting)
  }

  return [...deduped.values()]
    .filter((posting) => posting.title && posting.externalPath)
    .map((posting) => ({
      externalId: `workday:${site}:${posting.externalPath}`,
      title: posting.title!,
      url: new URL(
        `${site}${posting.externalPath}`.replace(/([^:]\/)\/+/g, "$1"),
        `https://${context.tenantHost}/`
      ).toString(),
      location:
        posting.location ??
        posting.locationsText ??
        posting.bulletFields?.[0],
      postedAt: posting.postedOn,
    }))
}

function normalizeWorkdaySlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
}

function compactSlug(value: string): string {
  return value.replace(/-/g, "")
}

function domainCoreLabel(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "")
  const parts = host.split(".").filter(Boolean)
  if (parts.length >= 2) return parts[parts.length - 2]
  return parts[0] ?? host
}

function companyNameSlugCandidates(companyName: string): string[] {
  const words = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !COMPANY_STOPWORDS.has(w))

  if (words.length === 0) return []
  const first = words[0]
  const firstTwo = words.slice(0, 2).join("")
  const firstThree = words.slice(0, 3).join("")

  return [first, firstTwo, firstThree].filter(Boolean)
}

function workdaySlugCandidates(careersUrl: URL, companyName: string): string[] {
  const set = new Set<string>()

  const primaryDomain = normalizeWorkdaySlug(domainCoreLabel(careersUrl.hostname))
  if (primaryDomain) set.add(primaryDomain)

  const firstLabel = normalizeWorkdaySlug(
    careersUrl.hostname.toLowerCase().replace(/^www\./, "").split(".")[0] ?? ""
  )
  if (firstLabel && firstLabel !== "careers" && firstLabel !== "jobs") {
    set.add(firstLabel)
  }

  for (const raw of companyNameSlugCandidates(companyName)) {
    const normalized = normalizeWorkdaySlug(raw)
    if (!normalized) continue
    set.add(normalized)
    set.add(compactSlug(normalized))
  }

  return [...set].filter((s) => s.length >= 3).slice(0, 4)
}

function workdaySiteCandidates(slug: string): string[] {
  const compact = compactSlug(slug)
  const pascal = slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")

  const candidates = [
    `${compact}careers`,
    `${slug}careers`,
    compact,
    slug,
    "careers",
    "career",
    "External",
    "EXT",
    "CorporateCareers",
    `${pascal}Careers`,
  ]

  return [...new Set(candidates.filter(Boolean))]
}

async function crawlWorkdayByHeuristic(
  careersUrl: URL,
  companyName: string
): Promise<RawJob[]> {
  const slugs = workdaySlugCandidates(careersUrl, companyName)
  if (slugs.length === 0) return []

  let attempts = 0
  for (const slug of slugs) {
    const hostSlugs = [...new Set([compactSlug(slug), slug].filter(Boolean))]
    const tenantCandidates = [...new Set([compactSlug(slug), slug].filter(Boolean))]
    const siteCandidates = workdaySiteCandidates(slug)

    for (const hostSlug of hostSlugs) {
      for (const shard of WORKDAY_HOST_SHARDS) {
        const tenantHost = `${hostSlug}.wd${shard}.myworkdayjobs.com`

        for (const tenant of tenantCandidates) {
          const context: WorkdayContext = {
            tenantHost,
            tenant,
            sites: [],
          }

          for (const site of siteCandidates) {
            attempts += 1
            if (attempts > WORKDAY_FALLBACK_MAX_ATTEMPTS) return []
            const postings = await fetchWorkdayPostings(context, site)
            if (postings.length === 0) continue

            const jobs = mapWorkdayPostings(context, site, postings)
            if (jobs.length > 0) return jobs
          }
        }
      }
    }
  }

  return []
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

  const markup = await fetchText(
    `https://jobs.ashbyhq.com/${encodeURIComponent(company)}`
  )
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

  for (const site of context.sites) {
    const postings = await fetchWorkdayPostings(context, site)
    if (postings.length === 0) continue

    const jobs = mapWorkdayPostings(context, site, postings)
    if (jobs.length > 0) return jobs
  }

  return []
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

function toUrl(value: string, base?: URL): URL | null {
  try {
    return base ? new URL(value, base) : new URL(value)
  } catch {
    return null
  }
}

type AnchorLink = { href: URL; text: string }

function extractAnchorLinks(html: string, baseUrl: URL): AnchorLink[] {
  const links: AnchorLink[] = []
  const regex = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi

  for (const match of html.matchAll(regex)) {
    const rawHref = decodeHtmlEntities((match[2] ?? "").trim())
    if (!rawHref) continue
    if (
      rawHref.startsWith("#") ||
      rawHref.startsWith("javascript:") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:")
    ) {
      continue
    }

    const href = toUrl(rawHref, baseUrl)
    if (!href) continue

    const text = cleanText(match[3] ?? "")
    links.push({ href, text })
  }

  return links
}

function extractAbsoluteUrlsFromHtml(html: string, baseUrl: URL): URL[] {
  const found = new Map<string, URL>()

  for (const link of extractAnchorLinks(html, baseUrl)) {
    found.set(link.href.toString(), link.href)
  }

  const absoluteUrlRegex = /https?:\/\/[^\s"'<>]+/gi
  for (const match of html.matchAll(absoluteUrlRegex)) {
    const raw = match[0]?.replace(/[),.;]+$/, "")
    if (!raw) continue
    const url = toUrl(raw)
    if (!url) continue
    found.set(url.toString(), url)
  }

  return [...found.values()]
}

function inferTitleFromUrl(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean)
  const blocked = new Set([
    "job",
    "jobs",
    "career",
    "careers",
    "position",
    "positions",
    "opening",
    "openings",
  ])

  let candidate = [...segments]
    .reverse()
    .find((s) => !blocked.has(s.toLowerCase()))

  if (!candidate) candidate = segments[segments.length - 1] ?? "Open role"

  const cleaned = decodeURIComponent(candidate)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(?:r|req|requisition)[ -]?\d+\b/gi, "")
    .replace(/\b\d{4,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim()

  if (!cleaned) return "Open role"
  return cleaned
}

function isLikelyJobLink(url: URL, text: string, baseUrl: URL): boolean {
  if (!/^https?:$/i.test(url.protocol)) return false
  if (url.hostname.toLowerCase() !== baseUrl.hostname.toLowerCase()) return false

  const path = url.pathname.toLowerCase()
  if (!path || path === "/" || path === baseUrl.pathname.toLowerCase()) return false
  if (/\.(pdf|docx?|png|jpe?g|gif|svg|webp|zip|ics)$/i.test(path)) return false

  const hasBlockedHint = GENERIC_BLOCKED_PATH_HINTS.some((hint) =>
    path.includes(hint)
  )
  const hasJobHint = GENERIC_JOB_PATH_HINTS.some((hint) => path.includes(hint))
  const hasQueryJobHint = [...url.searchParams.keys()].some((k) =>
    /job|position|opening|requisition/i.test(k)
  )
  const hasRoleText =
    ROLE_TEXT_HINT.test(text) &&
    text.length <= 100 &&
    !/[{}$<>]/.test(text) &&
    !GENERIC_ANCHOR_TEXT.test(text)
  const segmentCount = path.split("/").filter(Boolean).length
  const hasRoleOnlySignal = hasRoleText && segmentCount >= 2

  if (hasBlockedHint && !hasJobHint && !hasQueryJobHint) return false
  if (!(hasJobHint || hasQueryJobHint || hasRoleOnlySignal)) return false
  return true
}

function extractGenericJobsFromHtml(html: string, baseUrl: URL): RawJob[] {
  const out: RawJob[] = []
  const seen = new Set<string>()
  for (const link of extractAnchorLinks(html, baseUrl)) {
    if (!isLikelyJobLink(link.href, link.text, baseUrl)) continue
    const url = link.href.toString()
    if (seen.has(url)) continue
    seen.add(url)

    const title =
      link.text && !GENERIC_ANCHOR_TEXT.test(link.text)
        ? link.text
        : inferTitleFromUrl(link.href)

    out.push({
      title: title || "Open role",
      url,
    })

    if (out.length >= MAX_GENERIC_JOBS) break
  }
  return out
}

function walkJson(value: unknown, cb: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, cb)
    return
  }
  if (!value || typeof value !== "object") return
  const obj = value as Record<string, unknown>
  cb(obj)
  for (const child of Object.values(obj)) {
    walkJson(child, cb)
  }
}

function jsonLdTypeIncludes(
  node: Record<string, unknown>,
  expected: string
): boolean {
  const typeRaw = node["@type"]
  const values = Array.isArray(typeRaw) ? typeRaw : [typeRaw]
  return values
    .map((v) => String(v ?? "").toLowerCase())
    .includes(expected.toLowerCase())
}

function extractJobLocation(node: Record<string, unknown>): string | undefined {
  const raw = node["jobLocation"]
  const locations = Array.isArray(raw) ? raw : [raw]

  for (const loc of locations) {
    if (!loc || typeof loc !== "object") continue
    const obj = loc as Record<string, unknown>
    const address = obj.address as Record<string, unknown> | undefined
    const parts = [
      address?.addressLocality,
      address?.addressRegion,
      address?.addressCountry,
    ]
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
    if (parts.length > 0) return parts.join(", ")
  }

  return undefined
}

function extractJobsFromJsonLd(html: string, baseUrl: URL): RawJob[] {
  const out: RawJob[] = []
  const seen = new Set<string>()

  const scriptRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const match of html.matchAll(scriptRegex)) {
    const raw = (match[1] ?? "").trim()
    if (!raw) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }

    walkJson(parsed, (node) => {
      if (!jsonLdTypeIncludes(node, "JobPosting")) return

      const title = String(node.title ?? node.name ?? "").trim()
      const rawUrl = String(
        node.url ??
          node.mainEntityOfPage ??
          (node.identifier as Record<string, unknown> | undefined)?.value ??
          ""
      ).trim()
      if (!title || !rawUrl) return

      const resolved = toUrl(rawUrl, baseUrl)
      if (!resolved) return

      const url = resolved.toString()
      if (seen.has(url)) return
      seen.add(url)

      out.push({
        externalId:
          String(
            (node.identifier as Record<string, unknown> | undefined)?.value ?? ""
          ).trim() || undefined,
        title,
        url,
        location: extractJobLocation(node),
        postedAt: String(node.datePosted ?? "").trim() || undefined,
      })
    })
  }

  return out
}

async function crawlIcims(careersUrl: URL): Promise<RawJob[]> {
  const html = await fetchText(careersUrl.toString())
  if (!html) return []
  const jsonLdJobs = extractJobsFromJsonLd(html, careersUrl)
  const genericJobs = extractGenericJobsFromHtml(html, careersUrl)
  return dedupeJobs([...jsonLdJobs, ...genericJobs])
}

async function crawlBambooHr(careersUrl: URL): Promise<RawJob[]> {
  const html = await fetchText(careersUrl.toString())
  if (!html) return []
  const jsonLdJobs = extractJobsFromJsonLd(html, careersUrl)
  const genericJobs = extractGenericJobsFromHtml(html, careersUrl)
  return dedupeJobs([...jsonLdJobs, ...genericJobs])
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

  if (parseIcimsPortal(careersUrl)) {
    return crawlIcims(careersUrl)
  }

  if (parseBambooPortal(careersUrl)) {
    return crawlBambooHr(careersUrl)
  }

  return []
}

async function discoverAndCrawlFromHtml(careersUrl: URL): Promise<RawJob[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(careersUrl.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: buildRequestHeaders(),
    })
    if (!response.ok) return []
    const html = await response.text()

    const discoveredUrls = extractAbsoluteUrlsFromHtml(html, careersUrl)
    const knownAtsCandidates: URL[] = []
    const seen = new Set<string>()

    for (const candidate of discoveredUrls) {
      const known =
        Boolean(parseGreenhouseBoard(candidate)) ||
        Boolean(parseLeverCompany(candidate)) ||
        Boolean(parseAshbyCompany(candidate)) ||
        Boolean(parseWorkdayContext(candidate)) ||
        parseIcimsPortal(candidate) ||
        parseBambooPortal(candidate)

      if (!known) continue
      const key = candidate.toString()
      if (seen.has(key)) continue
      seen.add(key)
      knownAtsCandidates.push(candidate)
      if (knownAtsCandidates.length >= MAX_DISCOVERED_ATS_CANDIDATES) break
    }

    for (const candidate of knownAtsCandidates) {
      const jobs = await crawlByKnownAts(candidate)
      if (jobs.length > 0) return jobs
    }

    const jsonLdJobs = extractJobsFromJsonLd(html, careersUrl)
    const genericJobs = extractGenericJobsFromHtml(html, careersUrl)
    const combined = dedupeJobs([...jsonLdJobs, ...genericJobs])
    if (combined.length > 0) return combined

    // One-hop fallback: follow "all jobs"/"search jobs" links on the same host.
    const oneHopCandidates = extractAnchorLinks(html, careersUrl)
      .filter((a) => a.href.hostname.toLowerCase() === careersUrl.hostname.toLowerCase())
      .filter((a) => a.href.toString() !== careersUrl.toString())
      .filter(
        (a) =>
          /all jobs|search jobs|open positions|view openings/i.test(a.text) ||
          /\/(careers?|jobs?)\b/i.test(a.href.pathname)
      )
      .slice(0, 3)

    const oneHopJobs: RawJob[] = []
    for (const candidate of oneHopCandidates) {
      const nextHtml = await fetchText(candidate.href.toString())
      if (!nextHtml) continue
      oneHopJobs.push(
        ...extractJobsFromJsonLd(nextHtml, candidate.href),
        ...extractGenericJobsFromHtml(nextHtml, candidate.href)
      )
    }

    return dedupeJobs(oneHopJobs)
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
  let jobs =
    fromKnownAts.length > 0
      ? fromKnownAts
      : await discoverAndCrawlFromHtml(careersUrl)

  if (
    jobs.length === 0 &&
    (target.atsType?.toLowerCase() ?? "") === "workday"
  ) {
    jobs = await crawlWorkdayByHeuristic(careersUrl, target.companyName)
  }

  return {
    url: target.careersUrl,
    jobs: dedupeJobs(jobs),
    crawledAt: new Date(),
  }
}

import {
  cleanJobDescription,
  normalizeJobApplyUrl,
} from "@/lib/jobs/description"

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
  description?: string
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
const ORACLE_SEARCH_PAGE_SIZE = 24
const ORACLE_MAX_JOBS = 240
const PHENOM_DEFAULT_PAGE_SIZE = 10
const PHENOM_MAX_JOBS = 240
const GOOGLE_RESULTS_PAGE_SIZE = 20
const GOOGLE_MAX_JOBS = 200

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
  "/article",
  "/articles",
  "/blog",
  "/category",
  "/categories",
  "/developer",
  "/developers",
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
  "/insight",
  "/insights",
  "/login",
  "/portal",
  "/resume",
  "/service",
  "/services",
]

const ROLE_TEXT_HINT =
  /\b(engineer|developer|scientist|analyst|manager|director|intern|architect|designer|consultant|specialist|lead|principal|product|data|software)\b/i

const GENERIC_ANCHOR_TEXT =
  /^(learn more|read more|view all jobs?|all jobs?|careers?|search jobs?|apply now|apply|see all|details?)$/i

const GENERIC_BLOCKED_ANCHOR_TEXT =
  /^(login|log back in!?|get started|developer portal.*|analyst reports?|by job title)$/i

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

function isOracleCandidateExperienceUrl(url: URL) {
  const host = url.hostname.toLowerCase()
  const path = url.pathname.toLowerCase()
  return (
    host.includes("oracle.com") &&
    (path.includes("/sites/jobsearch") || path.includes("/hcmui/candexpstatic"))
  )
}

function isCiscoPhenomPortal(url: URL) {
  const host = url.hostname.toLowerCase()
  return host === "jobs.cisco.com" || host === "careers.cisco.com"
}

function isGoogleCareersPortal(url: URL) {
  const host = url.hostname.toLowerCase()
  if (host === "careers.google.com") return true
  return host.endsWith(".google.com") && url.pathname.toLowerCase().includes("/about/careers")
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

async function fetchJson<T>(
  url: string,
  init: RequestInit = {}
): Promise<T | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: "GET",
      ...init,
      signal: controller.signal,
      headers: buildRequestHeaders(init.headers),
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
      url: normalizeJobApplyUrl(
        new URL(
          `${site}${posting.externalPath}`.replace(/([^:]\/)\/+/g, "$1"),
          `https://${context.tenantHost}/`
        ).toString()
      ),
      description: cleanJobDescription(posting.bulletFields?.join("\n") ?? null) ?? undefined,
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
      content?: string
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
      url: normalizeJobApplyUrl(job.absolute_url),
      description: cleanJobDescription(job.content ?? null) ?? undefined,
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
      description?: string
      descriptionPlain?: string
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
      url: normalizeJobApplyUrl(job.hostedUrl),
      description:
        cleanJobDescription(
          job.descriptionPlain ??
            (job.description ? cleanText(job.description) : null)
        ) ?? undefined,
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
    const fullUrl = normalizeJobApplyUrl(`https://jobs.ashbyhq.com${path}`)
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

function greenhouseEmbeddedJobId(url: URL): string | null {
  const fromQuery = url.searchParams.get("gh_jid")?.trim()
  if (fromQuery) return fromQuery
  const fromPath = url.pathname.match(/\/jobs\/(\d+)/i)?.[1]
  return fromPath?.trim() || null
}

function extractGreenhouseEmbeddedJobsFromHtml(html: string, baseUrl: URL): RawJob[] {
  if (!/gh_jid=/i.test(html) || !/_greenhouseJob_/i.test(html)) return []

  const fromProps: RawJob[] = []
  const propsRaw =
    html.match(/component-export="GreenhouseJobList"[\s\S]*?props="([\s\S]*?)"\s+ssr/i)?.[1] ??
    null

  if (propsRaw) {
    const decodedProps = decodeHtmlEntities(decodeHtmlEntities(propsRaw))
    const jobsRegex =
      /"absolute_url":\[0,"([^"]*gh_jid=\d+[^"]*)"\][\s\S]{0,5000}?"location":\[0,\{"name":\[0,"([^"]*)"\]\}\][\s\S]{0,2000}?"id":\[0,"(\d+)"\][\s\S]{0,3000}?"title":\[0,"([^"]+)"\][\s\S]{0,10000}?"first_published":\[0,"([^"]+)"\][\s\S]{0,50000}?"content":\[0,"([\s\S]*?)"\],"departments":/g

    const seenProps = new Set<string>()
    for (const match of decodedProps.matchAll(jobsRegex)) {
      const rawUrl = decodeHtmlEntities((match[1] ?? "").trim())
      const location = decodeHtmlEntities((match[2] ?? "").trim()) || undefined
      const id = (match[3] ?? "").trim()
      const title = cleanText(match[4] ?? "")
      const postedAt = (match[5] ?? "").trim() || undefined
      const rawContent = (match[6] ?? "").trim()
      const description =
        cleanJobDescription(
          decodeHtmlEntities(rawContent)
            .replace(/\\n/g, "\n")
            .replace(/\\"/g, '"')
        ) ?? undefined

      if (!rawUrl || !id || !title) continue

      const resolved = toUrl(rawUrl, baseUrl)
      if (!resolved) continue

      // Canonicalize `/careers/jobs?gh_jid=<id>` to the concrete job path.
      if (/\/careers\/jobs\/?$/i.test(resolved.pathname) && resolved.searchParams.has("gh_jid")) {
        resolved.pathname = `${resolved.pathname.replace(/\/+$/, "")}/${id}`
      }

      const key = `greenhouse-embedded:${id}`
      if (seenProps.has(key)) continue
      seenProps.add(key)

      fromProps.push({
        externalId: key,
        title,
        url: normalizeJobApplyUrl(resolved.toString()),
        description,
        location,
        postedAt,
      })
    }
  }

  if (fromProps.length > 0) return fromProps

  const out: RawJob[] = []
  const seen = new Set<string>()
  const cardRegex =
    /<div class="_greenhouseJob_[^"]*"[\s\S]*?<a[^>]*href="([^"]*\/careers\/jobs\/\d+\?gh_jid=\d+[^"]*)"[^>]*>\s*<\/a>[\s\S]*?<\/div>\s*<\/div>/gi

  for (const match of html.matchAll(cardRegex)) {
    const rawHref = decodeHtmlEntities((match[1] ?? "").trim())
    if (!rawHref) continue

    const resolved = toUrl(rawHref, baseUrl)
    if (!resolved) continue

    const block = match[0] ?? ""
    const title = cleanText(block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "")
    if (!title) continue

    const id = greenhouseEmbeddedJobId(resolved)
    const key = id ?? resolved.toString()
    if (seen.has(key)) continue
    seen.add(key)

    const details = [...block.matchAll(/<span class="_jobDetail_[^"]*">([\s\S]*?)<\/span>/gi)]
      .map((detailMatch) => cleanText(detailMatch[1] ?? ""))
      .filter(Boolean)
    const location = details[0] || undefined

    out.push({
      externalId: id ? `greenhouse-embedded:${id}` : undefined,
      title,
      url: normalizeJobApplyUrl(resolved.toString()),
      location,
    })

    if (out.length >= MAX_GENERIC_JOBS) break
  }

  return out
}

function isLikelyJobLink(url: URL, text: string, baseUrl: URL): boolean {
  if (!/^https?:$/i.test(url.protocol)) return false
  if (url.hostname.toLowerCase() !== baseUrl.hostname.toLowerCase()) return false
  if (url.searchParams.has("gh_jid")) return false

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
    !GENERIC_ANCHOR_TEXT.test(text) &&
    !GENERIC_BLOCKED_ANCHOR_TEXT.test(text)
  const segmentCount = path.split("/").filter(Boolean).length
  const hasCareersContentPath =
    /\/careers?\/[^/]+/i.test(path) ||
    /\/jobs?\/results\//i.test(path) ||
    /\/jobs?\/[^/]+/i.test(path)
  const hasRoleOnlySignal = hasRoleText && (hasCareersContentPath || segmentCount >= 3)

  if (hasBlockedHint && !hasJobHint && !hasQueryJobHint) return false
  if (!(hasJobHint || hasQueryJobHint || hasRoleOnlySignal)) return false
  return true
}

function extractGenericJobsFromHtml(html: string, baseUrl: URL): RawJob[] {
  const out: RawJob[] = []
  const seen = new Set<string>()
  for (const link of extractAnchorLinks(html, baseUrl)) {
    if (!isLikelyJobLink(link.href, link.text, baseUrl)) continue
    const url = normalizeJobApplyUrl(link.href.toString())
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

function looksLikeOracleCandidateExperienceHtml(html: string): boolean {
  return (
    /var\s+CX_CONFIG\s*=/.test(html) &&
    /apiBaseUrl:\s*'https?:\/\/[^']+'/.test(html) &&
    /siteNumber:\s*'[^']+'/.test(html)
  )
}

function looksLikePhenomHtml(html: string): boolean {
  return (
    /var\s+phApp\s*=\s*phApp\s*\|\|/.test(html) &&
    /"widgetApiEndpoint":"https?:\/\/[^"]+"/.test(html)
  )
}

function looksLikeGoogleJobsResultsHtml(html: string): boolean {
  return html.includes("HiringCportalFrontendUi") && html.includes("jobs/results/")
}

function readConfigValue(html: string, key: string): string | null {
  const quoted = html.match(new RegExp(`"${key}":"([^"]+)"`, "i"))?.[1]
  const single = html.match(new RegExp(`${key}:\\s*'([^']+)'`, "i"))?.[1]
  const raw = quoted ?? single
  if (!raw) return null
  return decodeHtmlEntities(raw).replace(/\\\//g, "/")
}

function extractBalancedObjectAfter(html: string, marker: string): string | null {
  const markerIndex = html.indexOf(marker)
  if (markerIndex < 0) return null

  const firstBraceIndex = html.indexOf("{", markerIndex)
  if (firstBraceIndex < 0) return null

  let depth = 0
  let inString: '"' | "'" | null = null
  let escaped = false

  for (let i = firstBraceIndex; i < html.length; i++) {
    const ch = html[i]
    if (!ch) break

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === inString) {
        inString = null
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = ch
      continue
    }
    if (ch === "{") {
      depth += 1
      continue
    }
    if (ch === "}") {
      depth -= 1
      if (depth === 0) {
        return html.slice(firstBraceIndex, i + 1)
      }
    }
  }

  return null
}

type OraclePortalConfig = {
  apiBaseUrl: string
  siteNumber: string
  siteLang: string | null
  siteUrlName: string | null
}

type OracleRequisition = {
  Id?: string
  Title?: string
  PrimaryLocation?: string
  PostedDate?: string
  secondaryLocations?: Array<Record<string, unknown> | string>
}

type OracleSearchBucket = {
  TotalJobsCount?: number
  requisitionList?: OracleRequisition[]
}

type OracleSearchResponse = {
  items?: OracleSearchBucket[]
}

function parseOraclePortalConfig(html: string): OraclePortalConfig | null {
  const apiBaseUrl = readConfigValue(html, "apiBaseUrl")
  const siteNumber = readConfigValue(html, "siteNumber")
  if (!apiBaseUrl || !siteNumber) return null

  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    siteNumber,
    siteLang: readConfigValue(html, "siteLang"),
    siteUrlName: readConfigValue(html, "siteURLName"),
  }
}

function resolveOracleCareersPath(careersUrl: URL, siteUrlName: string | null): string {
  const match = careersUrl.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)\/sites\/([^/?#]+)/i)
  const locale = match?.[1] ?? "en"
  const site = siteUrlName ?? match?.[2] ?? "jobsearch"
  return `/${locale}/sites/${encodeURIComponent(site)}`
}

function pickOracleLocation(requisition: OracleRequisition): string | undefined {
  const primary = String(requisition.PrimaryLocation ?? "").trim()
  if (primary) return primary

  const secondary = requisition.secondaryLocations
  if (!Array.isArray(secondary)) return undefined

  for (const item of secondary) {
    if (typeof item === "string") {
      const text = item.trim()
      if (text) return text
      continue
    }
    if (!item || typeof item !== "object") continue
    const candidate = String(
      (item as Record<string, unknown>).location ??
        (item as Record<string, unknown>).Location ??
        ""
    ).trim()
    if (candidate) return candidate
  }

  return undefined
}

async function crawlOracleCandidateExperience(
  careersUrl: URL,
  initialHtml?: string
): Promise<RawJob[]> {
  const html = initialHtml ?? (await fetchText(careersUrl.toString()))
  if (!html || !looksLikeOracleCandidateExperienceHtml(html)) return []

  const config = parseOraclePortalConfig(html)
  if (!config) return []

  const jobs: RawJob[] = []
  const seen = new Set<string>()
  let totalJobsCount = Number.POSITIVE_INFINITY

  for (
    let offset = 0;
    offset < totalJobsCount && jobs.length < ORACLE_MAX_JOBS;
    offset += ORACLE_SEARCH_PAGE_SIZE
  ) {
    const finder = `findReqs;siteNumber=${encodeURIComponent(
      config.siteNumber
    )},limit=${ORACLE_SEARCH_PAGE_SIZE},offset=${offset}`
    const url = `${config.apiBaseUrl}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${finder}`

    const payload = await fetchJson<OracleSearchResponse>(url, {
      headers: config.siteLang
        ? {
            "accept-language": config.siteLang,
            "ora-irc-language": config.siteLang,
          }
        : undefined,
    })
    const bucket = payload?.items?.[0]
    if (!bucket) break

    if (typeof bucket.TotalJobsCount === "number" && Number.isFinite(bucket.TotalJobsCount)) {
      totalJobsCount = bucket.TotalJobsCount
    }

    const requisitions = Array.isArray(bucket.requisitionList)
      ? bucket.requisitionList
      : []
    if (requisitions.length === 0) break

    let addedOnPage = 0
    for (const requisition of requisitions) {
      const id = String(requisition.Id ?? "").trim()
      const title = String(requisition.Title ?? "").trim()
      if (!id || !title) continue

      const externalId = `oracle:${id}`
      if (seen.has(externalId)) continue
      seen.add(externalId)

      const postedAt = String(requisition.PostedDate ?? "").trim()
      jobs.push({
        externalId,
        title,
        url: new URL(
          `${resolveOracleCareersPath(careersUrl, config.siteUrlName)}/job/${encodeURIComponent(
            id
          )}`,
          careersUrl.origin
        ).toString(),
        location: pickOracleLocation(requisition),
        postedAt: postedAt || undefined,
      })
      addedOnPage += 1

      if (jobs.length >= ORACLE_MAX_JOBS) break
    }

    if (addedOnPage === 0 || requisitions.length < ORACLE_SEARCH_PAGE_SIZE) break
  }

  return jobs
}

type PhenomPosting = {
  jobSeqNo?: string
  jobId?: string
  reqId?: string
  title?: string
  location?: string
  cityStateCountry?: string
  cityState?: string
  country?: string
  postedDate?: string
  dateCreated?: string
  applyUrl?: string
  multi_location?: string[]
}

function parsePhenomBaseUrl(html: string, careersUrl: URL): URL | null {
  const configured = readConfigValue(html, "baseUrl") ?? readConfigValue(html, "rootDomain")
  if (!configured) return null
  return toUrl(configured, careersUrl)
}

function extractPhenomJobsFromHtml(html: string): PhenomPosting[] {
  const ddoRaw = extractBalancedObjectAfter(html, "phApp.ddo =")
  if (!ddoRaw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(ddoRaw)
  } catch {
    return []
  }

  if (!parsed || typeof parsed !== "object") return []
  const ddo = parsed as Record<string, unknown>
  const eagerLoadJobs = (
    (ddo.eagerLoadRefineSearch as Record<string, unknown> | undefined)?.data as
      | Record<string, unknown>
      | undefined
  )?.jobs
  if (Array.isArray(eagerLoadJobs)) return eagerLoadJobs as PhenomPosting[]

  for (const value of Object.values(ddo)) {
    if (!value || typeof value !== "object") continue
    const data = (value as Record<string, unknown>).data
    if (!data || typeof data !== "object") continue
    const jobs = (data as Record<string, unknown>).jobs
    if (Array.isArray(jobs) && jobs.length > 0) return jobs as PhenomPosting[]
  }

  return []
}

function pickPhenomLocation(posting: PhenomPosting): string | undefined {
  const candidates = [
    posting.location,
    posting.cityStateCountry,
    posting.cityState,
    Array.isArray(posting.multi_location) ? posting.multi_location[0] : undefined,
    posting.country,
  ]

  for (const value of candidates) {
    const text = String(value ?? "").trim()
    if (text) return text
  }

  return undefined
}

async function crawlPhenomPortal(careersUrl: URL, initialHtml?: string): Promise<RawJob[]> {
  const landingHtml = initialHtml ?? (await fetchText(careersUrl.toString()))
  if (!landingHtml || !looksLikePhenomHtml(landingHtml)) return []

  const baseUrl = parsePhenomBaseUrl(landingHtml, careersUrl)
  if (!baseUrl) return []

  let pageSize = PHENOM_DEFAULT_PAGE_SIZE
  const firstPageJobs = extractPhenomJobsFromHtml(landingHtml)
  if (firstPageJobs.length > 0) {
    pageSize = firstPageJobs.length
  }

  const maxPages = Math.max(1, Math.ceil(PHENOM_MAX_JOBS / Math.max(pageSize, 1)))
  const jobs: RawJob[] = []
  const seen = new Set<string>()

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const searchUrl = new URL("search-results", baseUrl)
    searchUrl.searchParams.set("from", String(from))
    searchUrl.searchParams.set("s", "1")

    const pageHtml =
      page === 0 && careersUrl.pathname.toLowerCase().includes("search-results")
        ? landingHtml
        : await fetchText(searchUrl.toString())
    if (!pageHtml) break

    const postings = extractPhenomJobsFromHtml(pageHtml)
    if (postings.length === 0) break
    if (page === 0 && postings.length > 0) {
      pageSize = postings.length
    }

    let addedOnPage = 0
    for (const posting of postings) {
      const title = String(posting.title ?? "").trim()
      if (!title) continue

      const sourceId = String(
        posting.jobSeqNo ?? posting.jobId ?? posting.reqId ?? ""
      ).trim()

      const applyCandidate = String(posting.applyUrl ?? "").trim()
      const applyUrl = toUrl(applyCandidate, baseUrl)?.toString()
      const fallbackUrl =
        posting.jobId || posting.reqId
          ? new URL(
              `job/${encodeURIComponent(String(posting.jobId ?? posting.reqId))}/${normalizeWorkdaySlug(
                title
              )}`,
              baseUrl
            ).toString()
          : null
      const url = applyUrl ?? fallbackUrl
      if (!url) continue

      const key = sourceId || url
      if (seen.has(key)) continue
      seen.add(key)

      jobs.push({
        externalId: sourceId ? `phenom:${sourceId}` : undefined,
        title,
        url: normalizeJobApplyUrl(url),
        location: pickPhenomLocation(posting),
        postedAt: String(posting.postedDate ?? posting.dateCreated ?? "").trim() || undefined,
      })
      addedOnPage += 1

      if (jobs.length >= PHENOM_MAX_JOBS) break
    }

    if (addedOnPage === 0 || postings.length < pageSize || jobs.length >= PHENOM_MAX_JOBS) {
      break
    }
  }

  return jobs
}

function extractGoogleJobsFromHtml(html: string, baseUrl: URL): RawJob[] {
  const jobs: RawJob[] = []
  const seen = new Set<string>()
  const cardRegex =
    /ssk=['"]\d+:(\d+)['"][\s\S]{0,12000}?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]{0,4000}?<span class="r0wTof [^"]*">([\s\S]*?)<\/span>[\s\S]{0,20000}?href="(jobs\/results\/[^"]+)"/g

  for (const match of html.matchAll(cardRegex)) {
    const id = String(match[1] ?? "").trim()
    const title = cleanText(match[2] ?? "")
    const location = cleanText(match[3] ?? "")
    const href = decodeHtmlEntities(match[4] ?? "")
    const resolved = toUrl(
      href,
      new URL("https://www.google.com/about/careers/applications/")
    )
    if (!id || !title || !resolved) continue
    if (seen.has(id)) continue
    seen.add(id)

    jobs.push({
      externalId: `google:${id}`,
      title,
      url: normalizeJobApplyUrl(resolved.toString()),
      location: location || undefined,
    })

    if (jobs.length >= GOOGLE_RESULTS_PAGE_SIZE) break
  }

  if (jobs.length > 0) return jobs

  const fallback: RawJob[] = []
  for (const job of extractGenericJobsFromHtml(html, baseUrl)) {
    const resolved = toUrl(job.url)
    if (!resolved) continue
    if (!resolved.pathname.toLowerCase().includes("/jobs/results/")) continue

    const id = resolved.pathname.match(/\/jobs\/results\/(\d+)/)?.[1]
    fallback.push({
      externalId: id ? `google:${id}` : undefined,
      title: job.title,
      url: normalizeJobApplyUrl(resolved.toString()),
      location: job.location,
      postedAt: job.postedAt,
    })

    if (fallback.length >= GOOGLE_RESULTS_PAGE_SIZE) break
  }

  return dedupeJobs(fallback)
}

async function crawlGoogleCareers(careersUrl: URL, initialHtml?: string): Promise<RawJob[]> {
  const resultsBase = new URL("https://www.google.com/about/careers/applications/jobs/results")
  const jobs: RawJob[] = []
  const seen = new Set<string>()
  const maxPages = Math.max(1, Math.ceil(GOOGLE_MAX_JOBS / GOOGLE_RESULTS_PAGE_SIZE))

  for (let page = 1; page <= maxPages; page++) {
    const pageUrl = new URL(resultsBase.toString())
    if (page > 1) pageUrl.searchParams.set("page", String(page))

    const html =
      page === 1 && initialHtml && looksLikeGoogleJobsResultsHtml(initialHtml)
        ? initialHtml
        : await fetchText(pageUrl.toString())
    if (!html) break

    const pageJobs = extractGoogleJobsFromHtml(html, pageUrl)
    if (pageJobs.length === 0) break

    let addedOnPage = 0
    for (const job of pageJobs) {
      const key = job.externalId ?? job.url
      if (seen.has(key)) continue
      seen.add(key)
      jobs.push(job)
      addedOnPage += 1

      if (jobs.length >= GOOGLE_MAX_JOBS) break
    }

    if (
      addedOnPage === 0 ||
      pageJobs.length < GOOGLE_RESULTS_PAGE_SIZE ||
      jobs.length >= GOOGLE_MAX_JOBS
    ) {
      break
    }
  }

  if (jobs.length > 0) return jobs

  const fallbackHtml = initialHtml ?? (await fetchText(careersUrl.toString()))
  if (!fallbackHtml) return []
  return dedupeJobs(extractGenericJobsFromHtml(fallbackHtml, careersUrl))
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
        description: cleanJobDescription(String(node.description ?? "").trim()) ?? undefined,
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

  if (isOracleCandidateExperienceUrl(careersUrl)) {
    return crawlOracleCandidateExperience(careersUrl)
  }

  if (isCiscoPhenomPortal(careersUrl)) {
    return crawlPhenomPortal(careersUrl)
  }

  if (isGoogleCareersPortal(careersUrl)) {
    return crawlGoogleCareers(careersUrl)
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

    if (looksLikeOracleCandidateExperienceHtml(html)) {
      const oracleJobs = await crawlOracleCandidateExperience(careersUrl, html)
      if (oracleJobs.length > 0) return oracleJobs
    }

    if (looksLikePhenomHtml(html)) {
      const phenomJobs = await crawlPhenomPortal(careersUrl, html)
      if (phenomJobs.length > 0) return phenomJobs
    }

    if (isGoogleCareersPortal(careersUrl) || looksLikeGoogleJobsResultsHtml(html)) {
      const googleJobs = await crawlGoogleCareers(careersUrl, html)
      if (googleJobs.length > 0) return googleJobs
    }

    const greenhouseEmbeddedJobs = extractGreenhouseEmbeddedJobsFromHtml(html, careersUrl)
    if (greenhouseEmbeddedJobs.length > 0) {
      return greenhouseEmbeddedJobs
    }

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
        parseBambooPortal(candidate) ||
        isOracleCandidateExperienceUrl(candidate) ||
        isCiscoPhenomPortal(candidate) ||
        isGoogleCareersPortal(candidate)

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
    const combined = dedupeJobs([...greenhouseEmbeddedJobs, ...jsonLdJobs, ...genericJobs])
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
        ...extractGreenhouseEmbeddedJobsFromHtml(nextHtml, candidate.href),
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

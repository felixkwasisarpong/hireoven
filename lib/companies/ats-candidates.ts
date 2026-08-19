import { normalizeAtsUrl, type NormalizedAtsProvider } from "@/lib/companies/ats-url-normalization"
import { detectAtsFromHtml } from "@/lib/companies/ats-signatures"
import { detectAtsFromUrl } from "@/lib/companies/detect-ats"

export type AtsCandidateType = Exclude<NormalizedAtsProvider, "custom">

export type AtsCandidateSource =
  | "final_url"
  | "redirect"
  | "link"
  | "script"
  | "iframe"
  | "form"
  | "canonical"
  | "json"
  | "network"
  | "html_marker"
  | "search_query"

export type AtsCandidate = {
  atsType: AtsCandidateType
  candidateUrl: string
  host: string
  source: AtsCandidateSource
  sources: AtsCandidateSource[]
  atsIdentifier: string | null
  evidence: {
    signals: string[]
    urls: string[]
    searchQueries?: string[]
  }
}

export type JobSignal = {
  jobsFound: number
  detailUrls: string[]
  titles: string[]
  locations: string[]
}

export type AtsCandidateVerification = {
  candidate: AtsCandidate
  confidence: number
  rawScore: number
  status: "verified" | "verified_no_jobs" | "pending" | "rejected"
  evidence: {
    factors: Record<string, number>
    signals: string[]
    companyNameMatch: boolean
    officialDomainLinksToAts: boolean
    wrongCompanyName: boolean
    jobs: JobSignal
    finalUrl?: string | null
  }
  nextCheckSeconds: number | null
}

export type PageSnapshot = {
  url: string
  finalUrl?: string | null
  html?: string | null
  redirectChain?: string[]
  networkUrls?: string[]
}

const ICIMS_INFRA_HOSTS = new Set([
  "icims.com",
  "www.icims.com",
  "cdn.icims.com",
  "api.icims.com",
  "developer.icims.com",
  "community.icims.com",
  "partners.icims.com",
  "trust.icims.com",
  "legal.icims.com",
])

const BRANDED_HTML_MARKER_CANDIDATES = new Set<AtsCandidateType>(["icims"])

const ATS_SEARCH_TEMPLATES: Array<{ atsType: AtsCandidateType; query: (name: string) => string }> = [
  { atsType: "workday", query: (name) => `site:myworkdayjobs.com "${name}" careers` },
  { atsType: "icims", query: (name) => `site:icims.com "${name}" jobs` },
  { atsType: "taleo", query: (name) => `site:taleo.net "${name}" careersection` },
  { atsType: "successfactors", query: (name) => `site:jobs.hr.cloud.sap "${name}" jobs` },
  { atsType: "phenom", query: (name) => `site:phenompeople.com "${name}" jobs` },
  { atsType: "eightfold", query: (name) => `site:eightfold.ai "${name}" careers` },
  { atsType: "avature", query: (name) => `site:avature.net "${name}" careers` },
  { atsType: "adp", query: (name) => `site:workforcenow.adp.com "${name}" careers` },
  { atsType: "ukg", query: (name) => `site:recruiting.ultipro.com "${name}" jobs` },
  { atsType: "smartrecruiters", query: (name) => `site:jobs.smartrecruiters.com "${name}" jobs` },
  { atsType: "jobvite", query: (name) => `site:jobs.jobvite.com "${name}" jobs` },
  { atsType: "bamboohr", query: (name) => `site:bamboohr.com "${name}" careers` },
  { atsType: "recruitee", query: (name) => `site:recruitee.com "${name}" jobs` },
]

const LEGAL_STOPWORDS = new Set([
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
  "holding",
  "global",
  "international",
  "the",
  "and",
  "of",
  "usa",
  "us",
])

const URL_RE = /https?:\/\/[^\s"'<>\\)]+/gi
const ATTR_RE =
  /<(a|script|iframe|form|link|meta)\b[^>]*?\s(?:href|src|action|content|data-url|data-src)=["']([^"']+)["'][^>]*>/gi

const JOB_DETAIL_PATH_RE =
  /(?:\/jobs?\/[^/?#]+|\/job\/[^/?#]+|\/jobdetail\/|\/job-details\/|\/careers?\/[^/?#]*job|\/careersection\/[^/?#]+\/jobdetail|\/requisition\/|\/positions?\/[^/?#]+|\/opportunit(?:y|ies)\/|[?&](?:jobId|job_id|reqId|jobReqId|jobREQID)=)/i

function safeUrl(value: string, baseUrl?: string): URL | null {
  try {
    const trimmed = decodeHtml(value).trim()
    if (!trimmed || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:") || trimmed.startsWith("javascript:")) {
      return null
    }
    return baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed)
  } catch {
    return null
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function hostOf(rawUrl: string): string | null {
  const parsed = safeUrl(rawUrl)
  return parsed?.hostname.toLowerCase() ?? null
}

function cleanText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function textKey(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
}

function companyTokens(companyName: string): string[] {
  return textKey(companyName)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !LEGAL_STOPWORDS.has(token))
}

function companyNameMatches(companyName: string, text: string): boolean {
  const tokens = companyTokens(companyName)
  if (tokens.length === 0) return false
  const haystack = ` ${textKey(text)} `
  const compactHaystack = haystack.replace(/\s+/g, "")
  const compactCompany = tokens.join("")
  if (compactCompany.length >= 5 && compactHaystack.includes(compactCompany)) return true
  const matches = tokens.filter((token) => haystack.includes(` ${token} `)).length
  if (tokens.length === 1) return matches === 1
  if (tokens.length <= 3) return matches === tokens.length
  return matches >= Math.max(2, Math.ceil(tokens.length * 0.6))
}

function likelyWrongCompanyName(companyName: string, html: string | null | undefined): boolean {
  if (!html) return false
  if (companyNameMatches(companyName, html)) return false
  const title =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
    ""
  const text = cleanText(title)
  const m = /\b(?:careers|jobs)\s+(?:at|with)\s+([a-z0-9&.,' -]{3,80})/i.exec(text)
  if (!m?.[1]) return false
  return !companyNameMatches(companyName, m[1])
}

function sourceFromTag(tag: string, raw: string): AtsCandidateSource {
  const lower = raw.toLowerCase()
  if (tag === "script") return "script"
  if (tag === "iframe") return "iframe"
  if (tag === "form") return "form"
  if (tag === "link" && lower.includes("canonical")) return "canonical"
  if (tag === "meta") return "json"
  return "link"
}

function htmlUrls(html: string, baseUrl: string): Array<{ url: string; source: AtsCandidateSource }> {
  const out: Array<{ url: string; source: AtsCandidateSource }> = []
  for (const match of html.matchAll(ATTR_RE)) {
    const tag = (match[1] ?? "").toLowerCase()
    const raw = match[2]
    if (!raw) continue
    const parsed = safeUrl(raw, baseUrl)
    if (!parsed) continue
    out.push({ url: parsed.toString(), source: sourceFromTag(tag, match[0] ?? "") })
  }
  for (const match of html.matchAll(URL_RE)) {
    const parsed = safeUrl(match[0])
    if (!parsed) continue
    out.push({ url: parsed.toString(), source: "json" })
  }
  return out
}

function normalizeWorkdayCxsUrl(rawUrl: string): string | null {
  const parsed = safeUrl(rawUrl)
  if (!parsed) return null
  const host = parsed.hostname.toLowerCase()
  if (!host.includes("myworkdayjobs.com")) return null
  const parts = parsed.pathname.split("/").filter(Boolean)
  const cxsIdx = parts.findIndex((part) => part.toLowerCase() === "cxs")
  if (cxsIdx === -1) return null
  const site = parts[cxsIdx + 2]
  if (!site) return null
  return `https://${host}/en-US/${encodeURIComponent(site)}`
}

function candidateFromUrl(rawUrl: string, source: AtsCandidateSource): AtsCandidate | null {
  const cxs = normalizeWorkdayCxsUrl(rawUrl)
  const normalized = normalizeAtsUrl(cxs ?? rawUrl)
  const detected = detectAtsFromUrl(cxs ?? rawUrl)
  const atsType =
    normalized.provider !== "custom"
      ? normalized.provider
      : detected?.atsType && detected.atsType !== "custom"
        ? detected.atsType
        : null
  if (!atsType) return null

  if (normalized.provider !== "custom" && !normalized.shouldPersist) return null

  const candidateUrl = normalized.provider !== "custom" && normalized.shouldPersist
    ? normalized.normalizedUrl
    : cxs ?? rawUrl
  const host = hostOf(candidateUrl)
  if (!host) return null
  if (atsType === "icims" && ICIMS_INFRA_HOSTS.has(host)) return null
  // AtsCandidateType is bounded by NormalizedAtsProvider, and Rippling has no
  // URL-normalization rules — candidates here feed that layer. detectAtsFromUrl
  // only started reporting "rippling" for the Career Site Scout, so dropping it
  // keeps this discovery path behaving exactly as it did before.
  if (atsType === "rippling") return null

  return {
    atsType,
    candidateUrl,
    host,
    source,
    sources: [source],
    atsIdentifier: normalized.atsIdentifier ?? detected?.atsIdentifier ?? null,
    evidence: {
      signals: [normalized.reason],
      urls: [rawUrl],
    },
  }
}

function mergeCandidate(map: Map<string, AtsCandidate>, candidate: AtsCandidate) {
  const key = `${candidate.atsType}:${candidate.candidateUrl}`
  const existing = map.get(key)
  if (!existing) {
    map.set(key, candidate)
    return
  }
  existing.sources = [...new Set([...existing.sources, ...candidate.sources])]
  existing.source = existing.sources[0] ?? existing.source
  existing.evidence.signals = [...new Set([...existing.evidence.signals, ...candidate.evidence.signals])]
  existing.evidence.urls = [...new Set([...existing.evidence.urls, ...candidate.evidence.urls])]
}

export function generateEnterpriseAtsSearchQueries(companyName: string): string[] {
  const name = companyName.trim()
  if (!name) return []
  return ATS_SEARCH_TEMPLATES.map((template) => template.query(name))
}

export function extractAtsCandidates(input: {
  companyName: string
  companyDomain?: string | null
  page: PageSnapshot
  includeSearchQueries?: boolean
}): AtsCandidate[] {
  const candidates = new Map<string, AtsCandidate>()
  const add = (url: string | null | undefined, source: AtsCandidateSource) => {
    if (!url) return
    const candidate = candidateFromUrl(url, source)
    if (candidate) mergeCandidate(candidates, candidate)
  }

  add(input.page.finalUrl ?? input.page.url, "final_url")
  for (const url of input.page.redirectChain ?? []) add(url, "redirect")
  for (const url of input.page.networkUrls ?? []) add(url, "network")

  if (input.page.html) {
    for (const item of htmlUrls(input.page.html, input.page.finalUrl ?? input.page.url)) {
      add(item.url, item.source)
    }

    const marker = detectAtsFromHtml({
      url: input.page.finalUrl ?? input.page.url,
      html: input.page.html,
    })
    if (
      marker?.atsType &&
      marker.atsType !== "custom" &&
      BRANDED_HTML_MARKER_CANDIDATES.has(marker.atsType)
    ) {
      const normalized = normalizeAtsUrl(input.page.finalUrl ?? input.page.url, { atsType: marker.atsType })
      const markerUrl = normalized.shouldPersist ? normalized.normalizedUrl : input.page.finalUrl ?? input.page.url
      const host = hostOf(markerUrl)
      if (host) {
        mergeCandidate(candidates, {
          atsType: marker.atsType,
          candidateUrl: markerUrl,
          host,
          source: "html_marker",
          sources: ["html_marker"],
          atsIdentifier: normalized.atsIdentifier,
          evidence: {
            signals: marker.reasons,
            urls: [input.page.finalUrl ?? input.page.url],
          },
        })
      }
    }
  }

  const out = [...candidates.values()]
  if (out.length === 0 && input.includeSearchQueries) {
    const queries = generateEnterpriseAtsSearchQueries(input.companyName)
    const placeholderHost = input.companyDomain?.replace(/^www\./, "") || "search-query"
    return [{
      atsType: "workday",
      candidateUrl: `search://${encodeURIComponent(input.companyName)}`,
      host: placeholderHost,
      source: "search_query",
      sources: ["search_query"],
      atsIdentifier: null,
      evidence: {
        signals: ["direct_detection_failed_search_queries_generated"],
        urls: [],
        searchQueries: queries,
      },
    }]
  }
  return out
}

function officialLinksToCandidate(officialHtml: string | null | undefined, candidate: AtsCandidate): boolean {
  if (!officialHtml) return false
  const normalized = officialHtml.toLowerCase()
  return normalized.includes(candidate.host.toLowerCase()) ||
    normalized.includes(candidate.candidateUrl.toLowerCase())
}

function extractJobSignals(html: string | null | undefined, baseUrl: string): JobSignal {
  if (!html) return { jobsFound: 0, detailUrls: [], titles: [], locations: [] }
  const detailUrls = new Set<string>()
  const titles = new Set<string>()
  const locations = new Set<string>()

  for (const json of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = json[1] ?? ""
    if (!/"@type"\s*:\s*"?JobPosting"?/i.test(raw)) continue
    const title = /"title"\s*:\s*"([^"]{3,120})"/i.exec(raw)?.[1]
    const location = /"addressLocality"\s*:\s*"([^"]{2,120})"/i.exec(raw)?.[1]
    if (title) titles.add(decodeHtml(title))
    if (location) locations.add(decodeHtml(location))
  }

  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1]
    if (!href || !JOB_DETAIL_PATH_RE.test(href)) continue
    const parsed = safeUrl(href, baseUrl)
    if (parsed) detailUrls.add(parsed.toString())
    const title = cleanText(match[2] ?? "")
    if (title.length >= 3 && title.length <= 120) titles.add(title)
  }

  for (const match of html.matchAll(/"(?:title|jobTitle|job_title)"\s*:\s*"([^"]{3,120})"/gi)) {
    titles.add(decodeHtml(match[1] ?? ""))
  }
  for (const match of html.matchAll(/"(?:location|city|primaryLocation)"\s*:\s*"([^"]{2,120})"/gi)) {
    locations.add(decodeHtml(match[1] ?? ""))
  }

  const jobsFound = Math.max(detailUrls.size, titles.size)
  return {
    jobsFound,
    detailUrls: [...detailUrls].slice(0, 20),
    titles: [...titles].slice(0, 20),
    locations: [...locations].slice(0, 20),
  }
}

export function statusFromCandidateScore(input: {
  score: number
  jobsFound: number
  companyNameMatch: boolean
  officialDomainLinksToAts: boolean
  wrongCompanyName: boolean
}): AtsCandidateVerification["status"] {
  if (input.wrongCompanyName || input.score < 25) return "rejected"
  if (input.score >= 70 && input.jobsFound > 0) return "verified"
  if (
    input.score >= 40 &&
    input.jobsFound === 0 &&
    input.companyNameMatch &&
    input.officialDomainLinksToAts
  ) {
    return "verified_no_jobs"
  }
  if (input.score >= 40) return "pending"
  return "rejected"
}

export function nextCheckSecondsForCandidate(status: AtsCandidateVerification["status"]): number | null {
  switch (status) {
    case "verified":
      return 10 * 60
    case "verified_no_jobs":
      return 8 * 60 * 60
    case "pending":
      return 24 * 60 * 60
    case "rejected":
      return 14 * 24 * 60 * 60
  }
}

export function verifyAtsCandidate(input: {
  candidate: AtsCandidate
  companyName: string
  companyDomain?: string | null
  officialPageHtml?: string | null
  candidatePageHtml?: string | null
  candidateFinalUrl?: string | null
}): AtsCandidateVerification {
  const factors: Record<string, number> = {}
  const signals = [...input.candidate.evidence.signals]
  const officialLink = officialLinksToCandidate(input.officialPageHtml, input.candidate)
  const textForCompanyMatch = [
    input.candidate.candidateUrl,
    input.candidate.host,
    input.officialPageHtml ?? "",
    input.candidatePageHtml ?? "",
  ].join(" ")
  const nameMatch = companyNameMatches(input.companyName, textForCompanyMatch)
  const wrongCompanyName = likelyWrongCompanyName(input.companyName, input.candidatePageHtml)
  const jobs = extractJobSignals(input.candidatePageHtml, input.candidateFinalUrl ?? input.candidate.candidateUrl)

  factors.ats_domain_found = 40
  if (nameMatch) factors.company_name_match = 30
  if (jobs.jobsFound > 0) factors.jobs_found = 30
  else if (input.candidatePageHtml != null) factors.no_jobs_found = -50
  if (officialLink) factors.official_domain_links_to_ats = 20
  if (jobs.detailUrls.length > 0) factors.job_detail_pages_exist = 10
  if (wrongCompanyName) factors.wrong_company_name = -70

  if (officialLink) signals.push("official_page_links_to_candidate")
  if (nameMatch) signals.push("company_name_match")
  if (jobs.jobsFound > 0) signals.push(`jobs_found_${jobs.jobsFound}`)
  if (jobs.detailUrls.length > 0) signals.push(`job_detail_urls_${jobs.detailUrls.length}`)

  const rawScore = Object.values(factors).reduce((sum, value) => sum + value, 0)
  const confidence = Math.max(0, Math.min(100, rawScore))
  const status = statusFromCandidateScore({
    score: confidence,
    jobsFound: jobs.jobsFound,
    companyNameMatch: nameMatch,
    officialDomainLinksToAts: officialLink,
    wrongCompanyName,
  })

  return {
    candidate: input.candidate,
    confidence,
    rawScore,
    status,
    evidence: {
      factors,
      signals: [...new Set(signals)],
      companyNameMatch: nameMatch,
      officialDomainLinksToAts: officialLink,
      wrongCompanyName,
      jobs,
      finalUrl: input.candidateFinalUrl ?? null,
    },
    nextCheckSeconds: nextCheckSecondsForCandidate(status),
  }
}

export async function verifyAtsCandidateUrl(input: {
  candidate: AtsCandidate
  companyName: string
  companyDomain?: string | null
  officialPageHtml?: string | null
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<AtsCandidateVerification> {
  const fetcher = input.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? 8_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let html: string | null = null
  let finalUrl: string | null = null
  try {
    const response = await fetcher(input.candidate.candidateUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; HireovenAtsDiscovery/1.0; +https://hireoven.com)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
        "accept-language": "en-US,en;q=0.9",
      },
    })
    finalUrl = response.url || input.candidate.candidateUrl
    const contentType = response.headers.get("content-type") ?? ""
    if (response.ok && (contentType.includes("text/html") || contentType.includes("application/json") || !contentType)) {
      html = await response.text()
    }
  } catch {
    html = null
  } finally {
    clearTimeout(timer)
  }

  return verifyAtsCandidate({
    candidate: input.candidate,
    companyName: input.companyName,
    companyDomain: input.companyDomain,
    officialPageHtml: input.officialPageHtml,
    candidatePageHtml: html,
    candidateFinalUrl: finalUrl,
  })
}

export async function inspectCareersPageWithPlaywright(input: {
  url: string
  timeoutMs?: number
}): Promise<PageSnapshot | null> {
  const timeoutMs = input.timeoutMs ?? 12_000
  let browser: import("playwright").Browser | null = null
  try {
    const { chromium } = await import("playwright")
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (compatible; HireovenAtsDiscovery/1.0; +https://hireoven.com)",
    })
    const networkUrls = new Set<string>()
    page.on("request", (request) => networkUrls.add(request.url()))
    page.on("response", (response) => networkUrls.add(response.url()))
    const response = await page.goto(input.url, { waitUntil: "networkidle", timeout: timeoutMs })
    const html = await page.content()
    return {
      url: input.url,
      finalUrl: page.url() || response?.url() || input.url,
      html,
      redirectChain: response?.request().redirectedFrom()
        ? collectRedirectChain(response.request())
        : [],
      networkUrls: [...networkUrls],
    }
  } catch {
    return null
  } finally {
    await browser?.close().catch(() => {})
  }
}

function collectRedirectChain(request: import("playwright").Request): string[] {
  const chain: string[] = []
  let current: import("playwright").Request | null = request
  while (current) {
    chain.unshift(current.url())
    current = current.redirectedFrom()
  }
  return chain
}

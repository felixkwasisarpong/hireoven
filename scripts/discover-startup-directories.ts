/**
 * Discover companies from YC, Built In city pages, and Wellfound with
 * Playwright, then resolve each one to either:
 *   1. a crawlable ATS URL the harvester can claim directly, or
 *   2. a crawlable company careers page for the legacy crawler.
 *
 * Usage:
 *   npx tsx scripts/discover-startup-directories.ts
 *   npx tsx scripts/discover-startup-directories.ts --execute
 *   npx tsx scripts/discover-startup-directories.ts --sources=yc,builtin --limit=60
 *   npx tsx scripts/discover-startup-directories.ts --sources=wellfound --storage-state=./playwright-state.json
 *
 * Notes:
 * - Dry-run by default. Pass `--execute` to upsert companies.
 * - Wellfound currently returns a DataDome challenge to clean headless
 *   sessions. `--storage-state` lets you reuse a real browser session when
 *   you want Wellfound coverage. Without that, the script logs the block and
 *   continues with YC / Built In.
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { isAtsDomain } from "@/lib/companies/ats-domains"
import {
  discoverCareersUrl,
  scoreCareersUrl,
  type CareersUrlConfidence,
} from "@/lib/companies/careers-url-discovery"
import { normalizeAtsUrl } from "@/lib/companies/ats-url-normalization"
import { companyLogoUrlFromDomain, normalizeCompanyDomain } from "@/lib/companies/logo-url"
import { resolveDirectAtsUrl, type RenderHtml } from "@/lib/companies/ats-url-resolver"
import { detectAdapter, type HarvestCtx } from "@/lib/harvester/adapters"
import { getPostgresPool } from "@/lib/postgres/server"
import type { BrowserContext, Page } from "playwright"

loadEnvConfig(process.cwd())

process.on("uncaughtException", (error) => {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("ERR_INVALID_STATE") || message.includes("Controller is already closed")) {
    return
  }
  console.error("[discover-startup-directories] uncaughtException:", error)
})

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (message.includes("ERR_INVALID_STATE") || message.includes("Controller is already closed")) {
    return
  }
  console.error("[discover-startup-directories] unhandledRejection:", reason)
})

type SourceName = "yc" | "builtin" | "wellfound"

type SourceCompanyRef = {
  source: SourceName
  companyUrl: string
  discoveryUrl: string
  city: string | null
}

type ExtractedProfile = {
  ref: SourceCompanyRef
  name: string
  websiteUrl: string | null
  extraCareerUrls: string[]
}

type CompanyResolution = {
  profile: ExtractedProfile
  domain: string | null
  careersUrl: string | null
  directAtsUrl: string | null
  directAtsProvider: string | null
  directAtsIdentifier: string | null
  atsType: string | null
  atsIdentifier: string | null
  crawlReady: boolean
  reason: string
  metadata: Record<string, unknown>
}

type ReportPayload = {
  mode: "dry-run" | "execute"
  started_at: string
  sources: SourceName[]
  summary: {
    discovered_refs: number
    extracted_profiles: number
    crawl_ready: number
    ats_ready: number
    custom_ready: number
    with_jobs: number
    without_jobs: number
    skipped: number
    inserted: number
    updated: number
    blocked: number
  }
  warnings: string[]
  discovered_by_source: Record<string, number>
  upserts: Array<Record<string, unknown>>
  skipped: Array<Record<string, unknown>>
}

const DEFAULT_BUILTIN_CITIES = [
  "san-francisco",
  "new-york-city",
  "austin",
  "seattle",
  "chicago",
] as const

const SOURCE_NAMES: SourceName[] = ["yc", "builtin", "wellfound"]
const YCOMBINATOR_DIRECTORY_URL = "https://www.ycombinator.com/companies"
const WELLFOUND_DIRECTORY_URL = "https://wellfound.com/companies"

const NAVIGATION_TIMEOUT_MS = 35_000
const DISCOVERY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

const SOCIAL_OR_AGGREGATOR_HOSTS = new Set([
  "angel.co",
  "bookface.ycombinator.com",
  "builtin.com",
  "employers.builtin.com",
  "facebook.com",
  "github.com",
  "instagram.com",
  "knowledgebase.builtin.com",
  "linkedin.com",
  "medium.com",
  "news.ycombinator.com",
  "startupschool.org",
  "substack.com",
  "tiktok.com",
  "twitter.com",
  "wellfound.com",
  "x.com",
  "youtube.com",
])

const args = process.argv.slice(2)

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = args.find((value) => value.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = args.indexOf(`--${name}`)
  if (idx !== -1) return args[idx + 1]
  return undefined
}

function intFlag(name: string, fallback: number, min = 1): number {
  const raw = Number.parseInt(flag(name) ?? "", 10)
  return Number.isFinite(raw) && raw >= min ? raw : fallback
}

function csvFlag<T extends string>(name: string, allowed: readonly T[], fallback: readonly T[]): T[] {
  const raw = flag(name)
  if (!raw) return [...fallback]
  const set = new Set<T>()
  for (const value of raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)) {
    if (allowed.includes(value as T)) set.add(value as T)
  }
  return set.size > 0 ? [...set] : [...fallback]
}

function stringListFlag(name: string, fallback: readonly string[]): string[] {
  const raw = flag(name)
  if (!raw) return [...fallback]
  const values = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  return values.length > 0 ? [...new Set(values)] : [...fallback]
}

const execute = args.includes("--execute")
const verbose = args.includes("--verbose")
const useRealChrome = args.includes("--real-chrome") || Boolean(flag("storage-state"))
// When using a storage-state (Wellfound), force headed mode — DataDome detects
// headless Chrome regardless of cookies or real-Chrome binary.
const headful = args.includes("--headful") || useRealChrome
const sources = csvFlag("sources", SOURCE_NAMES, SOURCE_NAMES)
const limit = intFlag("limit", 120)
const concurrency = intFlag("concurrency", 4)
const ycScrolls = intFlag("yc-scrolls", 10)
const builtinPages = intFlag("builtin-pages", 2)
const builtinCities = stringListFlag("builtin-cities", DEFAULT_BUILTIN_CITIES)
const discoveryLimitPerSource = intFlag("discover-limit-per-source", 120)
const storageStatePath = flag("storage-state")?.trim() || null
const wellfoundCompanyUrlsFile = flag("wellfound-company-urls-file")?.trim() || null
const reportPath =
  flag("report") ||
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `startup-directory-discovery-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.json`
  )

function writeReport(report: ReportPayload): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`[discover-startup-directories] report: ${reportPath}`)
}

function confidenceRank(confidence: CareersUrlConfidence): number {
  switch (confidence) {
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
    default:
      return 0
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function cleanPublicUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl?.trim()) return null
  try {
    const parsed = new URL(rawUrl.trim())
    const blockedParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "source"]
    for (const param of blockedParams) parsed.searchParams.delete(param)
    parsed.hash = ""
    const trimmed = parsed.toString().replace(/\/+$/, "")
    return trimmed || parsed.origin
  } catch {
    return null
  }
}

function domainFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl?.trim()) return null
  try {
    const host = new URL(rawUrl).hostname
    const normalized = normalizeCompanyDomain(host)
    return normalized || null
  } catch {
    return null
  }
}

function isWellfoundBlockedHtml(html: string): boolean {
  const lowered = html.toLowerCase()
  return (
    lowered.includes("captcha-delivery.com") ||
    lowered.includes("geo.captcha-delivery.com") ||
    lowered.includes("x-datadome")
  )
}

function uniqueRefs(refs: SourceCompanyRef[]): SourceCompanyRef[] {
  const seen = new Map<string, SourceCompanyRef>()
  for (const ref of refs) {
    seen.set(ref.companyUrl, ref)
  }
  return [...seen.values()]
}

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function bestLinkCandidate(
  links: Array<{ href: string; text: string }>
): string | null {
  let best: { href: string; score: number } | null = null
  for (const link of links) {
    const cleaned = cleanPublicUrl(link.href)
    if (!cleaned) continue

    let parsed: URL
    try {
      parsed = new URL(cleaned)
    } catch {
      continue
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
    if (
      SOCIAL_OR_AGGREGATOR_HOSTS.has(host) ||
      [...SOCIAL_OR_AGGREGATOR_HOSTS].some((blocked) => host.endsWith(`.${blocked}`))
    ) {
      continue
    }

    const text = link.text.trim().toLowerCase()
    let score = 0
    if (/view website|visit website|website/.test(text)) score += 120
    if (/^https?:\/\//.test(text) || text === host || text === parsed.origin.toLowerCase()) score += 100
    if (/careers|jobs|join us|work with us/.test(text)) score += 80
    if (text.length === 0) score -= 25
    if (/\b(the verge|techcrunch|forbes|inc\.|usa today|news)\b/.test(text)) score -= 40
    if (parsed.pathname === "/" || parsed.pathname === "") score += 10

    if (!best || score > best.score) {
      best = { href: cleaned, score }
    }
  }
  return best && best.score > 0 ? best.href : null
}

function buildProbeUrls(profile: ExtractedProfile): string[] {
  const urls = new Set<string>()
  const websiteUrl = cleanPublicUrl(profile.websiteUrl)

  for (const extra of profile.extraCareerUrls) {
    const cleaned = cleanPublicUrl(extra)
    if (cleaned) urls.add(cleaned)
  }

  if (websiteUrl) {
    urls.add(websiteUrl)
    try {
      const parsed = new URL(websiteUrl)
      const origin = parsed.origin.replace(/\/+$/, "")
      urls.add(origin)
      urls.add(`${origin}/careers`)
      urls.add(`${origin}/jobs`)
      urls.add(`${origin}/about/careers`)
      urls.add(`${origin}/work-with-us`)
      urls.add(`${origin}/join-us`)
      urls.add(`${origin}/open-positions`)
    } catch {
      // ignore malformed website URL
    }
  }

  return [...urls]
}

async function withPage<T>(context: BrowserContext, fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await context.newPage()
  try {
    return await fn(page)
  } finally {
    try {
      await page.close()
    } catch {
      // ignore
    }
  }
}

async function goto(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS })
  try {
    await page.waitForLoadState("networkidle", { timeout: 3_000 })
  } catch {
    // many directory pages keep polling
  }
  await page.waitForTimeout(800)
}

async function collectProfileLinks(page: Page, source: SourceName): Promise<string[]> {
  return page.evaluate((kind) => {
    const output: string[] = []
    const seen = new Set<string>()

    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const rawHref = anchor.getAttribute("href") || ""
      let absolute: URL
      try {
        absolute = new URL(rawHref, window.location.href)
      } catch {
        continue
      }

      const path = absolute.pathname.replace(/\/+$/, "")
      let matches = false

      if (kind === "yc") {
        matches = /^\/companies\/[a-z0-9-]+$/i.test(path)
      } else if (kind === "builtin") {
        matches = /^\/company\/[a-z0-9-]+$/i.test(path)
      } else if (kind === "wellfound") {
        matches = /^\/company\/[a-z0-9-]+$/i.test(path)
      }

      if (!matches) continue
      const normalized = absolute.toString()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      output.push(normalized)
    }

    return output
  }, source)
}

/**
 * Probe the resolved ATS for at least one live job. Discovery should only
 * persist a company when its board actually has openings — otherwise we fill
 * `companies` with empty boards the harvester then crawls for nothing.
 *
 * Uses the same adapter the harvester would (detected from the careers / direct
 * ATS URL). `verified` is false when no adapter matches (e.g. a custom careers
 * page we can't introspect) or the fetch fails — in both cases the board's job
 * count is unknown, so we treat it as "don't save".
 */
async function probeLiveJobCount(
  row: CompanyResolution
): Promise<{ jobCount: number; verified: boolean }> {
  const detectionUrl = row.directAtsUrl?.trim() || row.careersUrl?.trim() || ""
  if (!detectionUrl) return { jobCount: 0, verified: false }

  const detection = detectAdapter(detectionUrl)
  if (!detection) return { jobCount: 0, verified: false }

  const ctx: HarvestCtx = { etag: null, lastModified: null, timeoutMs: 8_000 }
  try {
    const result = await detection.adapter.fetchJobs({ slug: detection.slug, ctx })
    return { jobCount: result.jobs.length, verified: true }
  } catch {
    return { jobCount: 0, verified: false }
  }
}

async function discoverYcRefs(context: BrowserContext): Promise<SourceCompanyRef[]> {
  return withPage(context, async (page) => {
    await goto(page, YCOMBINATOR_DIRECTORY_URL)
    const refs = new Set<string>()
    let stableRounds = 0
    let previousCount = 0

    for (let round = 0; round < ycScrolls; round += 1) {
      for (const url of await collectProfileLinks(page, "yc")) refs.add(url)
      if (refs.size === previousCount) stableRounds += 1
      else stableRounds = 0
      if (stableRounds >= 2 && refs.size >= 40) break
      previousCount = refs.size
      await page.mouse.wheel(0, 5_000)
      await page.waitForTimeout(1_000)
    }

    return [...refs].slice(0, discoveryLimitPerSource).map((companyUrl) => ({
      source: "yc" as const,
      companyUrl,
      discoveryUrl: YCOMBINATOR_DIRECTORY_URL,
      city: null,
    }))
  })
}

async function discoverBuiltinRefs(context: BrowserContext): Promise<SourceCompanyRef[]> {
  const refs: SourceCompanyRef[] = []

  for (const city of builtinCities) {
    const baseUrl = `https://builtin.com/companies/location/${city}`
    for (let pageNumber = 1; pageNumber <= builtinPages; pageNumber += 1) {
      const discoveryUrl = pageNumber === 1 ? baseUrl : `${baseUrl}?page=${pageNumber}`
      const pageRefs = await withPage(context, async (page) => {
        await goto(page, discoveryUrl)
        const links = await collectProfileLinks(page, "builtin")
        return links.map((companyUrl) => ({
          source: "builtin" as const,
          companyUrl,
          discoveryUrl,
          city,
        }))
      })
      refs.push(...pageRefs)
      if (refs.length >= discoveryLimitPerSource) break
    }
    if (refs.length >= discoveryLimitPerSource) break
  }

  return uniqueRefs(refs).slice(0, discoveryLimitPerSource)
}

async function discoverWellfoundRefs(context: BrowserContext, warnings: string[]): Promise<SourceCompanyRef[]> {
  if (wellfoundCompanyUrlsFile) {
    const filePath = path.isAbsolute(wellfoundCompanyUrlsFile)
      ? wellfoundCompanyUrlsFile
      : path.join(process.cwd(), wellfoundCompanyUrlsFile)
    const urls = fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, discoveryLimitPerSource)

    return urls.map((companyUrl) => ({
      source: "wellfound" as const,
      companyUrl,
      discoveryUrl: `file:${filePath}`,
      city: null,
    }))
  }

  return withPage(context, async (page) => {
    await goto(page, WELLFOUND_DIRECTORY_URL)
    const html = await page.content()
    if (isWellfoundBlockedHtml(html)) {
      warnings.push(
        "Wellfound blocked the clean Playwright session. Re-run with --storage-state=/path/to/state.json if you want Wellfound coverage."
      )
      return []
    }

    const refs = new Set<string>()
    for (let round = 0; round < 6; round += 1) {
      for (const url of await collectProfileLinks(page, "wellfound")) refs.add(url)
      await page.mouse.wheel(0, 5_000)
      await page.waitForTimeout(1_000)
    }

    return [...refs].slice(0, discoveryLimitPerSource).map((companyUrl) => ({
      source: "wellfound" as const,
      companyUrl,
      discoveryUrl: WELLFOUND_DIRECTORY_URL,
      city: null,
    }))
  })
}

async function extractYcProfile(context: BrowserContext, ref: SourceCompanyRef): Promise<ExtractedProfile | null> {
  return withPage(context, async (page) => {
    await goto(page, ref.companyUrl)
    const title = await page.title()
    const html = decodeHtmlEntities(await page.content())
    const websiteFromHtml = html.match(/"website":"(https?:\/\/[^"]+)"/i)?.[1] ?? null
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
        href: new URL(anchor.getAttribute("href") || "", window.location.href).toString(),
        text: (anchor.textContent || "").trim().replace(/\s+/g, " "),
      }))
    )

    const fallbackSlug = ref.companyUrl.split("/").filter(Boolean).at(-1) ?? ""
    const name =
      title.split(":")[0]?.trim() ||
      titleCaseSlug(fallbackSlug) ||
      "Unknown Company"
    const websiteUrl = cleanPublicUrl(websiteFromHtml) ?? bestLinkCandidate(links)

    return {
      ref,
      name,
      websiteUrl,
      extraCareerUrls: [],
    }
  })
}

async function extractBuiltinProfile(
  context: BrowserContext,
  ref: SourceCompanyRef
): Promise<ExtractedProfile | null> {
  return withPage(context, async (page) => {
    await goto(page, ref.companyUrl)
    const data = await page.evaluate(() => {
      const h1 = document.querySelector("h1")?.textContent?.trim() ?? ""
      const title = document.title
      const links = Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
        href: new URL(anchor.getAttribute("href") || "", window.location.href).toString(),
        text: (anchor.textContent || "").trim().replace(/\s+/g, " "),
      }))
      return { h1, title, links }
    })

    const websiteUrl = bestLinkCandidate(data.links)
    const fallbackSlug = ref.companyUrl.split("/").filter(Boolean).at(-1) ?? ""
    const name =
      data.h1 ||
      data.title.split(" Careers")[0]?.trim() ||
      titleCaseSlug(fallbackSlug) ||
      "Unknown Company"

    return {
      ref,
      name,
      websiteUrl,
      extraCareerUrls: [],
    }
  })
}

async function extractWellfoundProfile(
  context: BrowserContext,
  ref: SourceCompanyRef
): Promise<ExtractedProfile | null> {
  return withPage(context, async (page) => {
    await goto(page, ref.companyUrl)
    const html = await page.content()
    if (isWellfoundBlockedHtml(html)) return null

    const data = await page.evaluate((blockedHosts: string[]) => {
      const h1 = document.querySelector("h1")?.textContent?.trim() ?? ""
      const title = document.title
      const links = Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
        href: new URL(anchor.getAttribute("href") || "", window.location.href).toString(),
        text: (anchor.textContent || "").trim().replace(/\s+/g, " "),
      }))

      // Wellfound does not render the company website as a DOM link — the URL
      // only appears inside the __NEXT_DATA__ JSON blob. Scan it for the first
      // non-Wellfound, non-social https URL.
      let wellfoundWebsite: string | null = null
      const nextDataText = document.getElementById("__NEXT_DATA__")?.textContent ?? ""
      if (nextDataText) {
        const urlRegex = /"(https?:\/\/[^"]{4,120})"/g
        let m: RegExpExecArray | null
        while ((m = urlRegex.exec(nextDataText)) !== null) {
          let parsed: URL
          try { parsed = new URL(m[1]) } catch { continue }
          const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
          if (blockedHosts.some((b) => host === b || host.endsWith(`.${b}`))) continue
          wellfoundWebsite = m[1]
          break
        }
      }

      return { h1, title, links, wellfoundWebsite }
    }, [...SOCIAL_OR_AGGREGATOR_HOSTS])

    const fallbackSlug = ref.companyUrl.split("/").filter(Boolean).at(-1) ?? ""
    const name =
      data.h1 ||
      data.title.split("|")[0]?.trim() ||
      titleCaseSlug(fallbackSlug) ||
      "Unknown Company"
    const websiteUrl =
      cleanPublicUrl(data.wellfoundWebsite) ?? bestLinkCandidate(data.links)

    return {
      ref,
      name,
      websiteUrl,
      extraCareerUrls: [],
    }
  })
}

async function extractProfile(context: BrowserContext, ref: SourceCompanyRef): Promise<ExtractedProfile | null> {
  if (ref.source === "yc") return extractYcProfile(context, ref)
  if (ref.source === "builtin") return extractBuiltinProfile(context, ref)
  return extractWellfoundProfile(context, ref)
}

async function fetchProbeHtml(url: string): Promise<{ ok: boolean; status: number | null; html: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": DISCOVERY_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
        "accept-language": "en-US,en;q=0.9",
      },
    })
    if (!response.ok) {
      try {
        await response.body?.cancel()
      } catch {
        // ignore
      }
      return { ok: false, status: response.status, html: null }
    }
    return { ok: true, status: response.status, html: await response.text() }
  } catch {
    return { ok: false, status: null, html: null }
  } finally {
    clearTimeout(timer)
  }
}

async function resolveCrawlableAts(
  urls: string[],
  companyName: string,
  renderHtml: RenderHtml
): Promise<{
  careersUrl: string
  directAtsUrl: string
  directAtsProvider: string
  directAtsIdentifier: string | null
  atsType: string
  atsIdentifier: string
  reason: string
} | null> {
  for (const url of urls) {
    let resolution
    try {
      resolution = await resolveDirectAtsUrl(url, {
        companyName,
        renderHtml,
      })
    } catch {
      resolution = null
    }

    if (!resolution) continue

    const normalized = normalizeAtsUrl(resolution.directUrl, { atsType: resolution.provider })
    if (!normalized.shouldPersist) continue

    const adapterHit = detectAdapter(normalized.normalizedUrl)
    if (!adapterHit) continue

    return {
      careersUrl: normalized.normalizedUrl,
      directAtsUrl: normalized.normalizedUrl,
      directAtsProvider: normalized.provider,
      directAtsIdentifier: normalized.atsIdentifier,
      atsType: adapterHit.adapter.name,
      atsIdentifier: adapterHit.slug,
      reason: `ats:${resolution.source}`,
    }
  }

  return null
}

async function resolveProfile(profile: ExtractedProfile, renderHtml: RenderHtml): Promise<CompanyResolution> {
  const websiteUrl = cleanPublicUrl(profile.websiteUrl)
  const rawDomain = domainFromUrl(websiteUrl)
  const domain = rawDomain && !isAtsDomain(rawDomain) ? rawDomain : null
  const probeUrls = buildProbeUrls(profile)

  const atsHit = await resolveCrawlableAts(probeUrls, profile.name, renderHtml)
  if (atsHit) {
    return {
      profile,
      domain,
      careersUrl: atsHit.careersUrl,
      directAtsUrl: atsHit.directAtsUrl,
      directAtsProvider: atsHit.directAtsProvider,
      directAtsIdentifier: atsHit.directAtsIdentifier,
      atsType: atsHit.atsType,
      atsIdentifier: atsHit.atsIdentifier,
      crawlReady: true,
      reason: atsHit.reason,
      metadata: {
        website_url: websiteUrl,
        ats_probe_urls: probeUrls,
      },
    }
  }

  let bestCustom = websiteUrl ? scoreCareersUrl(websiteUrl) : { url: "", confidence: "none" as const, reason: "missing_website" }

  if (domain) {
    const discovered = await discoverCareersUrl({
      domain,
      probe: async ({ url }) => fetchProbeHtml(url),
      maxAttempts: 6,
    })
    if (confidenceRank(discovered.confidence) > confidenceRank(bestCustom.confidence)) {
      bestCustom = discovered
    }
  }

  if (bestCustom.confidence !== "none") {
    const customAtsHit = await resolveCrawlableAts([bestCustom.url], profile.name, renderHtml)
    if (customAtsHit) {
      return {
        profile,
        domain,
        careersUrl: customAtsHit.careersUrl,
        directAtsUrl: customAtsHit.directAtsUrl,
        directAtsProvider: customAtsHit.directAtsProvider,
        directAtsIdentifier: customAtsHit.directAtsIdentifier,
        atsType: customAtsHit.atsType,
        atsIdentifier: customAtsHit.atsIdentifier,
        crawlReady: true,
        reason: `${customAtsHit.reason}:${bestCustom.reason}`,
        metadata: {
          website_url: websiteUrl,
          ats_probe_urls: probeUrls,
          careers_discovery: bestCustom,
        },
      }
    }
  }

  if (confidenceRank(bestCustom.confidence) >= confidenceRank("medium")) {
    const normalized = normalizeAtsUrl(bestCustom.url)
    return {
      profile,
      domain,
      careersUrl: normalized.normalizedUrl,
      directAtsUrl: null,
      directAtsProvider: null,
      directAtsIdentifier: null,
      atsType: "custom",
      atsIdentifier: null,
      crawlReady: true,
      reason: `custom:${bestCustom.reason}`,
      metadata: {
        website_url: websiteUrl,
        ats_probe_urls: probeUrls,
        careers_discovery: bestCustom,
      },
    }
  }

  return {
    profile,
    domain,
    careersUrl: null,
    directAtsUrl: null,
    directAtsProvider: null,
    directAtsIdentifier: null,
    atsType: null,
    atsIdentifier: null,
    crawlReady: false,
    reason: domain ? `no_crawlable_target:${bestCustom.reason}` : "missing_company_domain",
    metadata: {
      website_url: websiteUrl,
      ats_probe_urls: probeUrls,
      careers_discovery: bestCustom,
    },
  }
}

async function main() {
  console.log(
    [
      "",
      "── Discover startup directories ─────────────────────────",
      `  mode:         ${execute ? "EXECUTE (will upsert)" : "DRY RUN"}`,
      `  sources:      ${sources.join(",")}`,
      `  limit:        ${limit}`,
      `  concurrency:  ${concurrency}`,
      `  yc scrolls:   ${ycScrolls}`,
      `  built in:     ${builtinCities.join(",")} (pages=${builtinPages})`,
      `  browser:      ${headful ? "headed" : "headless"}`,
      storageStatePath ? `  storage:      ${storageStatePath}` : undefined,
      wellfoundCompanyUrlsFile ? `  wellfound:    ${wellfoundCompanyUrlsFile}` : undefined,
      "──────────────────────────────────────────────────────────",
      "",
    ]
      .filter(Boolean)
      .join("\n")
  )

  const { chromium } = await import("playwright")
  const browser = await chromium.launch({
    headless: !headful,
    ...(useRealChrome ? { channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] } : {}),
  })
  const context = await browser.newContext({
    ...(useRealChrome ? {} : { userAgent: DISCOVERY_USER_AGENT }),
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
    storageState: storageStatePath ?? undefined,
  })
  if (useRealChrome) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined })
    })
  }

  await context.route("**/*", (route) => {
    const type = route.request().resourceType()
    if (type === "image" || type === "font" || type === "media") {
      return route.abort()
    }
    return route.continue()
  })

  const warnings: string[] = []
  const report: ReportPayload = {
    mode: execute ? "execute" : "dry-run",
    started_at: new Date().toISOString(),
    sources,
    summary: {
      discovered_refs: 0,
      extracted_profiles: 0,
      crawl_ready: 0,
      ats_ready: 0,
      custom_ready: 0,
      with_jobs: 0,
      without_jobs: 0,
      skipped: 0,
      inserted: 0,
      updated: 0,
      blocked: 0,
    },
    warnings,
    discovered_by_source: {},
    upserts: [],
    skipped: [],
  }

  try {
    const discovered: SourceCompanyRef[] = []

    if (sources.includes("yc")) discovered.push(...(await discoverYcRefs(context)))
    if (sources.includes("builtin")) discovered.push(...(await discoverBuiltinRefs(context)))
    if (sources.includes("wellfound")) discovered.push(...(await discoverWellfoundRefs(context, warnings)))

    for (const warning of warnings) {
      console.warn(`[discover-startup-directories] warning: ${warning}`)
    }
    report.summary.blocked = warnings.filter((warning) => warning.toLowerCase().includes("blocked")).length

    const refs = uniqueRefs(discovered).slice(0, limit)
    report.summary.discovered_refs = refs.length

    for (const ref of refs) {
      report.discovered_by_source[ref.source] = (report.discovered_by_source[ref.source] ?? 0) + 1
    }

    console.log(`[discover-startup-directories] discovered refs=${refs.length}`)

    const renderHtml: RenderHtml = async (url: string) =>
      withPage(context, async (page) => {
        try {
          await goto(page, url)
          return await page.content()
        } catch {
          return null
        }
      })

    const limiter = pLimit(concurrency)

    const profiles = (
      await Promise.all(
        refs.map((ref) =>
          limiter(async () => {
            try {
              const profile = await extractProfile(context, ref)
              if (verbose && profile) {
                console.log(
                  `[discover-startup-directories] profile ${ref.source.padEnd(9)} ${profile.name} ${profile.websiteUrl ?? "no-website"}`
                )
              }
              return profile
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              report.skipped.push({
                source: ref.source,
                company_url: ref.companyUrl,
                reason: `extract_error:${message}`,
              })
              return null
            }
          })
        )
      )
    ).filter((profile): profile is ExtractedProfile => Boolean(profile))

    report.summary.extracted_profiles = profiles.length

    const resolutions = await Promise.all(
      profiles.map((profile) =>
        limiter(async () => {
          try {
            return await resolveProfile(profile, renderHtml)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return {
              profile,
              domain: domainFromUrl(profile.websiteUrl),
              careersUrl: null,
              directAtsUrl: null,
              directAtsProvider: null,
              directAtsIdentifier: null,
              atsType: null,
              atsIdentifier: null,
              crawlReady: false,
              reason: `resolve_error:${message}`,
              metadata: {
                website_url: profile.websiteUrl,
              },
            } satisfies CompanyResolution
          }
        })
      )
    )

    const crawlReady = resolutions.filter((row) => row.crawlReady)
    const atsReady = crawlReady.filter((row) => row.atsType && row.atsType !== "custom")
    const customReady = crawlReady.filter((row) => row.atsType === "custom")
    const skipped = resolutions.filter((row) => !row.crawlReady)

    report.summary.crawl_ready = crawlReady.length
    report.summary.ats_ready = atsReady.length
    report.summary.custom_ready = customReady.length
    report.summary.skipped = skipped.length

    for (const row of skipped) {
      if (row.profile.ref.source === "wellfound" && row.reason.includes("missing_company_domain")) {
        report.summary.blocked += 1
      }
      report.skipped.push({
        source: row.profile.ref.source,
        company_url: row.profile.ref.companyUrl,
        name: row.profile.name,
        reason: row.reason,
        website_url: row.profile.websiteUrl,
      })
    }

    console.log(
      `[discover-startup-directories] crawl-ready=${crawlReady.length} ats-ready=${atsReady.length} custom-ready=${customReady.length} skipped=${skipped.length}`
    )

    // Only keep companies whose board currently has at least one live job —
    // never persist an empty board the harvester would crawl for nothing.
    const probed = await Promise.all(
      crawlReady.map((row) =>
        limiter(async () => ({ row, ...(await probeLiveJobCount(row)) }))
      )
    )
    const withJobs = probed.filter((entry) => entry.jobCount > 0)
    report.summary.with_jobs = withJobs.length
    report.summary.without_jobs = probed.length - withJobs.length
    for (const entry of probed) {
      if (entry.jobCount > 0) continue
      report.skipped.push({
        source: entry.row.profile.ref.source,
        company_url: entry.row.profile.ref.companyUrl,
        name: entry.row.profile.name,
        reason: entry.verified ? "no_live_jobs" : "jobs_unverifiable",
        website_url: entry.row.profile.websiteUrl,
      })
    }
    console.log(
      `[discover-startup-directories] with-jobs=${withJobs.length} skipped-no-jobs=${probed.length - withJobs.length}`
    )

    if (!execute) {
      for (const { row, jobCount } of withJobs.slice(0, 30)) {
        console.log(
          `  ${String(row.atsType ?? "none").padEnd(16)} ${row.profile.name.padEnd(30)} jobs=${String(jobCount).padEnd(4)} ${row.careersUrl ?? "missing"}`
        )
      }
      writeReport(report)
      return
    }

    if (withJobs.length === 0) {
      writeReport(report)
      return
    }

    const pool = getPostgresPool()

    try {
      for (const { row, jobCount } of withJobs) {
        if (!row.domain || !row.careersUrl || !row.atsType) {
          report.skipped.push({
            source: row.profile.ref.source,
            company_url: row.profile.ref.companyUrl,
            name: row.profile.name,
            reason: "missing_required_upsert_fields",
          })
          continue
        }

        const rawAtsConfig = {
          source: "startup_directory_discovery",
          crawl_allowed: true,
          guessed_domain: row.domain,
          startup_directory_discovery: {
            source_name: row.profile.ref.source,
            source_company_url: row.profile.ref.companyUrl,
            discovery_url: row.profile.ref.discoveryUrl,
            city: row.profile.ref.city,
            website_url: row.profile.websiteUrl,
            resolution_reason: row.reason,
            discovered_job_count: jobCount,
            synced_at: new Date().toISOString(),
            ...(row.metadata ?? {}),
          },
        }

        const result = await pool.query<{ was_inserted: boolean }>(
          `INSERT INTO companies (
             name,
             domain,
             careers_url,
             direct_ats_url,
             direct_ats_provider,
             direct_ats_identifier,
             logo_url,
             ats_type,
             ats_identifier,
             is_active,
             status,
             freshness_tier,
             discovered_via,
             raw_ats_config,
             next_harvest_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9,
             true, 'active', 'tier_3', $10, $11::jsonb, now()
           )
           ON CONFLICT (domain) DO UPDATE SET
             name = EXCLUDED.name,
             careers_url = CASE
               WHEN EXCLUDED.ats_type IS NOT NULL AND EXCLUDED.ats_type <> 'custom' THEN EXCLUDED.careers_url
               WHEN companies.careers_url IS NULL OR companies.careers_url = '' THEN EXCLUDED.careers_url
               WHEN companies.ats_type IS NULL OR companies.ats_type = 'custom' THEN EXCLUDED.careers_url
               ELSE companies.careers_url
             END,
             direct_ats_url = COALESCE(EXCLUDED.direct_ats_url, companies.direct_ats_url),
             direct_ats_provider = COALESCE(EXCLUDED.direct_ats_provider, companies.direct_ats_provider),
             direct_ats_identifier = COALESCE(EXCLUDED.direct_ats_identifier, companies.direct_ats_identifier),
             logo_url = COALESCE(companies.logo_url, EXCLUDED.logo_url),
             ats_type = CASE
               WHEN EXCLUDED.ats_type IS NOT NULL AND EXCLUDED.ats_type <> 'custom' THEN EXCLUDED.ats_type
               ELSE COALESCE(companies.ats_type, EXCLUDED.ats_type)
             END,
             ats_identifier = COALESCE(EXCLUDED.ats_identifier, companies.ats_identifier),
             is_active = true,
             status = 'active',
             discovered_via = COALESCE(companies.discovered_via, EXCLUDED.discovered_via),
             raw_ats_config = COALESCE(companies.raw_ats_config, '{}'::jsonb) || COALESCE(EXCLUDED.raw_ats_config, '{}'::jsonb),
             next_harvest_at = LEAST(COALESCE(companies.next_harvest_at, now()), now())
           RETURNING (xmax = 0) AS was_inserted`,
          [
            row.profile.name,
            row.domain,
            row.careersUrl,
            row.directAtsUrl,
            row.directAtsProvider,
            row.directAtsIdentifier,
            companyLogoUrlFromDomain(row.domain, "google-favicon") || null,
            row.atsType,
            row.atsIdentifier,
            `startup-directory:${row.profile.ref.source}`,
            JSON.stringify(rawAtsConfig),
          ]
        )

        const wasInserted = result.rows[0]?.was_inserted === true
        if (wasInserted) report.summary.inserted += 1
        else report.summary.updated += 1

        report.upserts.push({
          source: row.profile.ref.source,
          name: row.profile.name,
          domain: row.domain,
          ats_type: row.atsType,
          careers_url: row.careersUrl,
          direct_ats_url: row.directAtsUrl,
          action: wasInserted ? "inserted" : "updated",
          reason: row.reason,
        })
      }
    } finally {
      await pool.end()
    }

    writeReport(report)
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error("[discover-startup-directories] fatal:", error)
  process.exit(1)
})

/**
 * Shared JSON-LD scraping helper.
 *
 * Most P2 ATSes (BambooHR, JazzHR, many Jobvite installations, etc.) render
 * their public career pages as plain HTML with one or more
 * `<script type="application/ld+json">` blocks that embed schema.org
 * JobPosting objects. The structure is documented and stable.
 *
 * This helper handles the fetch + extraction + mapping. Per-adapter code is
 * a thin URL detector + a call to mapJsonLdToHarvestedJobs().
 */

import {
  hashContent,
  type HarvestCtx,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { harvesterFetch } from "@/lib/harvester/http-agent"

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 hireoven-harvester/1.0"
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

export type JsonLdFetchResult =
  | { kind: "ok"; html: string; etag: string | null; lastModified: string | null; upstreamLatencyMs: number }
  | { kind: "not_modified"; etag: string | null; lastModified: string | null; upstreamLatencyMs: number }
  | { kind: "error"; status: number | null; reason: string; upstreamLatencyMs: number }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchHtmlConditional(
  url: string,
  ctx: HarvestCtx,
  options: { maxAttempts?: number } = {}
): Promise<JsonLdFetchResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const userAgent = ctx.userAgent ?? DEFAULT_USER_AGENT
  const timeoutMs = Math.max(1_000, ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const doFetch = ctx.fetchImpl ?? harvesterFetch

  const headers: Record<string, string> = {
    "user-agent": userAgent,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
    "accept-language": "en-US,en;q=0.9",
  }
  if (ctx.etag) headers["if-none-match"] = ctx.etag
  if (ctx.lastModified) headers["if-modified-since"] = ctx.lastModified

  let attempt = 0
  let upstreamLatencyMs = 0
  let lastStatus: number | null = null
  let lastReason = "unknown"

  while (attempt < maxAttempts) {
    attempt += 1
    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await doFetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "follow",
      })
      upstreamLatencyMs += Date.now() - startedAt
      const etag = response.headers.get("etag")
      const lastModified = response.headers.get("last-modified")

      if (response.status === 304) {
        return {
          kind: "not_modified",
          etag: etag ?? ctx.etag,
          lastModified: lastModified ?? ctx.lastModified,
          upstreamLatencyMs,
        }
      }
      if (response.ok) {
        const html = await response.text()
        return { kind: "ok", html, etag, lastModified, upstreamLatencyMs }
      }

      lastStatus = response.status
      lastReason = `http_${response.status}`
      if (!RETRY_STATUSES.has(response.status) || attempt >= maxAttempts) {
        return { kind: "error", status: response.status, reason: lastReason, upstreamLatencyMs }
      }
      await sleep(250 * 2 ** (attempt - 1) + Math.random() * 250)
    } catch (error) {
      upstreamLatencyMs += Date.now() - startedAt
      lastReason =
        error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_error"
      if (attempt >= maxAttempts) {
        return { kind: "error", status: null, reason: lastReason, upstreamLatencyMs }
      }
      await sleep(250 * 2 ** (attempt - 1) + Math.random() * 250)
    } finally {
      clearTimeout(timer)
    }
  }

  return { kind: "error", status: lastStatus, reason: lastReason, upstreamLatencyMs }
}

type JsonLdJobPosting = {
  "@type"?: string | string[]
  "@context"?: string
  identifier?: string | number | { value?: string; "@type"?: string }
  title?: string
  description?: string
  hiringOrganization?: { name?: string; sameAs?: string }
  jobLocation?: JsonLdJobLocation | JsonLdJobLocation[]
  applicantLocationRequirements?: { name?: string } | Array<{ name?: string }>
  employmentType?: string | string[]
  datePosted?: string
  url?: string
  baseSalary?: {
    currency?: string
    value?: { minValue?: number; maxValue?: number; unitText?: string }
    // Flat form: some iCIMS portals (e.g. Liberty Mutual) omit the nested `value` wrapper.
    minValue?: number
    maxValue?: number
    unitText?: string
  }
  jobLocationType?: string
}

type JsonLdJobLocation = {
  "@type"?: string
  address?: {
    addressLocality?: string
    addressRegion?: string
    addressCountry?: string | { name?: string }
  }
  name?: string
}

function unescapeXmlNumericEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
}

export function extractJsonLdBlocks(html: string): unknown[] {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const out: unknown[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = unescapeXmlNumericEntities(m[1].trim())
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) out.push(...parsed)
      else if (parsed && typeof parsed === "object") out.push(parsed)
    } catch {
      // Some sites emit invalid JSON inside script tags; skip silently.
    }
  }
  return out
}

function isJobPosting(obj: unknown): obj is JsonLdJobPosting {
  if (!obj || typeof obj !== "object") return false
  const type = (obj as { "@type"?: unknown })["@type"]
  if (Array.isArray(type)) return type.some((t) => typeof t === "string" && t === "JobPosting")
  return type === "JobPosting"
}

function stripHtml(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const text = value
    .replace(/<\/(p|div|li|br|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
  return text || undefined
}

function flattenLocation(loc: JsonLdJobLocation | JsonLdJobLocation[] | undefined): string | undefined {
  if (!loc) return undefined
  const list = Array.isArray(loc) ? loc : [loc]
  for (const item of list) {
    if (item.name?.trim()) return item.name.trim()
    const a = item.address
    if (!a) continue
    const country =
      typeof a.addressCountry === "string"
        ? a.addressCountry
        : a.addressCountry?.name
    const parts = [a.addressLocality, a.addressRegion, country]
      .map((p) => p?.trim())
      .filter((p): p is string => Boolean(p))
    if (parts.length) return parts.join(", ")
  }
  return undefined
}

function pickIdentifier(raw: JsonLdJobPosting): string | undefined {
  if (typeof raw.identifier === "string") return raw.identifier.trim() || undefined
  if (typeof raw.identifier === "number") return String(raw.identifier)
  if (raw.identifier && typeof raw.identifier === "object" && raw.identifier.value) {
    return String(raw.identifier.value).trim() || undefined
  }
  return undefined
}

function pickEmploymentType(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) return value[0]?.trim() || undefined
  return value.trim() || undefined
}

function pickWorkMode(raw: JsonLdJobPosting): string | undefined {
  const type = raw.jobLocationType?.toLowerCase() ?? ""
  if (type.includes("telecommute") || type.includes("remote")) return "remote"
  if (type.includes("hybrid")) return "hybrid"
  return undefined
}

function annualSalary(raw: JsonLdJobPosting):
  | { min?: number; max?: number; currency?: string }
  | null {
  // schema.org standard: baseSalary.value.{minValue,maxValue,unitText}
  // Flat form (e.g. iCIMS / Liberty Mutual): baseSalary.{minValue,maxValue} directly.
  const nested = raw.baseSalary?.value
  const bs = raw.baseSalary
  const minRaw = nested?.minValue ?? bs?.minValue
  const maxRaw = nested?.maxValue ?? bs?.maxValue
  const unit = (nested?.unitText ?? bs?.unitText ?? "").toLowerCase()
  if (minRaw === undefined && maxRaw === undefined) return null
  if (unit && !unit.includes("year") && !unit.includes("annual")) return null
  const min = typeof minRaw === "number" ? Math.round(minRaw) : undefined
  const max = typeof maxRaw === "number" ? Math.round(maxRaw) : undefined
  if (min === undefined && max === undefined) return null
  if ((min ?? 0) > 0 && (min ?? 0) < 10_000) return null
  if ((max ?? 0) > 2_000_000) return null
  return { min, max, currency: bs?.currency }
}

export type JsonLdMapOptions = {
  sourceAts: string
  /** Used when the JobPosting has no `url` field. */
  fallbackUrl?: string
}

export function mapJsonLdToHarvestedJobs(
  blocks: unknown[],
  options: JsonLdMapOptions
): HarvestedJob[] {
  const jobs: HarvestedJob[] = []
  const seenExternalIds = new Set<string>()

  for (const block of blocks) {
    if (!isJobPosting(block)) continue
    const title = (typeof block.title === "string" ? block.title.trim() : "") || ""
    if (!title) continue
    const identifier = pickIdentifier(block)
    const applyUrl = (typeof block.url === "string" && block.url.trim()) || options.fallbackUrl
    if (!applyUrl) continue

    const externalKey = identifier ?? applyUrl
    const externalId = `${options.sourceAts}:${externalKey}`
    if (seenExternalIds.has(externalId)) continue
    seenExternalIds.add(externalId)

    const description = stripHtml(block.description)
    const location = flattenLocation(block.jobLocation)
    const postedAt =
      typeof block.datePosted === "string" ? new Date(block.datePosted).toISOString() : undefined
    const workMode = pickWorkMode(block)
    const employmentType = pickEmploymentType(block.employmentType)
    const salary = annualSalary(block)

    const contentHash = hashContent([
      title,
      applyUrl,
      location,
      postedAt,
      workMode,
      employmentType,
      salary?.min,
      salary?.max,
      salary?.currency,
      description?.slice(0, 4_000),
    ])

    jobs.push({
      externalId,
      title,
      applyUrl,
      description,
      location,
      postedAt,
      workMode,
      employmentType,
      salaryMin: salary?.min,
      salaryMax: salary?.max,
      salaryCurrency: salary?.currency,
      contentHash,
    })
  }
  return jobs
}

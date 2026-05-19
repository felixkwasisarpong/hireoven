import crypto from "node:crypto"
import { harvesterFetch } from "@/lib/harvester/http-agent"

export type AtsName =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workable"
  | "workday"
  | "recruitee"
  | "teamtailor"
  | "personio"
  | "bamboohr"
  | "jazzhr"
  | "jobvite"
  | "icims"
  | "infosys"
  | "apple"

export type HarvestCtx = {
  etag: string | null
  lastModified: string | null
  userAgent?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export type HarvestedJob = {
  externalId: string
  title: string
  applyUrl: string
  description?: string
  location?: string
  postedAt?: string
  workMode?: string
  employmentType?: string
  salaryMin?: number
  salaryMax?: number
  salaryCurrency?: string
  /** sha256(canonical-serialized fields), truncated to 16 bytes hex. */
  contentHash: string
}

export type HarvestResult = {
  jobs: HarvestedJob[]
  /** 304 Not Modified — caller must not deactivate listings. */
  notModified: boolean
  etag: string | null
  lastModified: string | null
  sourceAts: AtsName
  sourceAtsSlug: string
  fetchedAt: Date
  upstreamLatencyMs: number
}

export interface AtsAdapter {
  readonly name: AtsName
  /**
   * Per-adapter concurrency budget. The worker keeps one limiter per adapter
   * so slow boards (Workday) don't starve fast ones (Greenhouse). Unset →
   * worker falls back to HARVESTER_CONCURRENCY.
   */
  readonly concurrency?: number
  detectFromUrl(url: string): { slug: string } | null
  fetchJobs(input: { slug: string; ctx: HarvestCtx }): Promise<HarvestResult>
}

const DEFAULT_USER_AGENT =
  "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)"
const DEFAULT_TIMEOUT_MS = 8_000
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

export type ConditionalFetchResult<T> =
  | { kind: "ok"; status: number; data: T; etag: string | null; lastModified: string | null; upstreamLatencyMs: number }
  | { kind: "not_modified"; status: 304; etag: string | null; lastModified: string | null; upstreamLatencyMs: number }
  | { kind: "error"; status: number | null; reason: string; upstreamLatencyMs: number }

export async function conditionalFetchJson<T>(
  url: string,
  ctx: HarvestCtx,
  options: { maxAttempts?: number } = {}
): Promise<ConditionalFetchResult<T>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const userAgent = ctx.userAgent ?? DEFAULT_USER_AGENT
  const timeoutMs = Math.max(1_000, ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const doFetch = ctx.fetchImpl ?? harvesterFetch

  const headers: Record<string, string> = {
    "user-agent": userAgent,
    accept: "application/json",
    "accept-encoding": "gzip, deflate, br",
  }
  if (ctx.etag) headers["if-none-match"] = ctx.etag
  if (ctx.lastModified) headers["if-modified-since"] = ctx.lastModified

  let attempt = 0
  let lastReason = "unknown"
  let lastStatus: number | null = null

  while (attempt < maxAttempts) {
    attempt += 1
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await doFetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      })
      const upstreamLatencyMs = Date.now() - startedAt
      const responseEtag = response.headers.get("etag")
      const responseLastModified = response.headers.get("last-modified")

      if (response.status === 304) {
        return {
          kind: "not_modified",
          status: 304,
          etag: responseEtag ?? ctx.etag,
          lastModified: responseLastModified ?? ctx.lastModified,
          upstreamLatencyMs,
        }
      }

      if (response.ok) {
        const data = (await response.json()) as T
        return {
          kind: "ok",
          status: response.status,
          data,
          etag: responseEtag,
          lastModified: responseLastModified,
          upstreamLatencyMs,
        }
      }

      lastStatus = response.status
      lastReason = `http_${response.status}`

      if (!RETRY_STATUSES.has(response.status) || attempt >= maxAttempts) {
        return { kind: "error", status: response.status, reason: lastReason, upstreamLatencyMs }
      }

      const retryAfterHeader = response.headers.get("retry-after")
      const retryAfterSec = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : NaN
      const backoff = Number.isFinite(retryAfterSec)
        ? Math.min(retryAfterSec * 1000, 5_000)
        : 250 * 2 ** (attempt - 1) + Math.random() * 250
      await sleep(backoff)
    } catch (error) {
      const upstreamLatencyMs = Date.now() - startedAt
      lastStatus = null
      lastReason =
        error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_error"
      if (attempt >= maxAttempts) {
        return { kind: "error", status: null, reason: lastReason, upstreamLatencyMs }
      }
      await sleep(250 * 2 ** (attempt - 1) + Math.random() * 250)
    } finally {
      clearTimeout(timeout)
    }
  }

  return { kind: "error", status: lastStatus, reason: lastReason, upstreamLatencyMs: 0 }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * sha256 truncated to 16 bytes (32 hex chars). Good enough for change detection;
 * swap to xxhash/blake3 if profiling shows hashing dominates.
 */
export function hashContent(parts: Array<string | number | undefined | null>): string {
  const h = crypto.createHash("sha256")
  for (const part of parts) {
    h.update(String(part ?? ""))
    h.update("") // unit separator, prevents boundary collisions
  }
  return h.digest("hex").slice(0, 32)
}

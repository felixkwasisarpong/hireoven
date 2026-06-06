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
  | "successfactors"
  | "taleo"
  | "oraclecloud"
  | "usajobs"
  | "infosys"
  | "apple"
  | "rippling"

export type HarvestCtx = {
  etag: string | null
  lastModified: string | null
  userAgent?: string
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  /**
   * External IDs for this company's jobs that already carry a non-trivial
   * description in the DB. Adapters with per-cycle detail-fetch budgets
   * (workday, smartrecruiters, jobvite, icims, successfactors, taleo) should
   * skip these so the cap goes to jobs that still need descriptions.
   * Optional — adapters that don't have a detail-fetch step just ignore it.
   */
  alreadyDescribedIds?: ReadonlySet<string>
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

/**
 * Resolve a per-adapter concurrency, with env override.
 * Reads HARVESTER_<NAME>_CONCURRENCY (e.g. HARVESTER_ICIMS_CONCURRENCY) — must
 * be a positive integer to win, otherwise the fallback is used. Read at module
 * load only; restart the worker after changing the env.
 */
export function envConcurrency(name: AtsName, fallback: number): number {
  const key = `HARVESTER_${name.toUpperCase()}_CONCURRENCY`
  const raw = Number.parseInt(process.env[key] ?? "", 10)
  if (Number.isFinite(raw) && raw >= 1) return raw
  return fallback
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const reason = signal.reason
  const message = reason instanceof Error ? reason.message : "aborted"
  const error = new Error(message)
  error.name = "AbortError"
  throw error
}

export function linkAbortSignal(
  parent: AbortSignal | undefined,
  controller: AbortController
): () => void {
  if (!parent) return () => {}
  const abort = () => controller.abort(parent.reason)
  if (parent.aborted) {
    abort()
    return () => {}
  }
  parent.addEventListener("abort", abort, { once: true })
  return () => parent.removeEventListener("abort", abort)
}

export type ConditionalFetchResult<T> =
  | { kind: "ok"; status: number; data: T; etag: string | null; lastModified: string | null; upstreamLatencyMs: number }
  | { kind: "not_modified"; status: 304; etag: string | null; lastModified: string | null; upstreamLatencyMs: number }
  | { kind: "error"; status: number | null; reason: string; upstreamLatencyMs: number }

export async function conditionalFetchJson<T>(
  url: string,
  ctx: HarvestCtx,
  options: { maxAttempts?: number; method?: "GET" | "POST"; body?: string } = {}
): Promise<ConditionalFetchResult<T>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const method = options.method ?? "GET"
  const userAgent = ctx.userAgent ?? DEFAULT_USER_AGENT
  const timeoutMs = Math.max(1_000, ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const doFetch = ctx.fetchImpl ?? harvesterFetch

  const headers: Record<string, string> = {
    "user-agent": userAgent,
    accept: "application/json",
    "accept-encoding": "gzip, deflate, br",
  }
  if (method === "POST" && options.body != null) headers["content-type"] = "application/json"
  // Conditional caching only applies to GET. POST job-board APIs (Workable)
  // don't honor If-None-Match / If-Modified-Since, so we never send them there.
  if (method === "GET" && ctx.etag) headers["if-none-match"] = ctx.etag
  if (method === "GET" && ctx.lastModified) headers["if-modified-since"] = ctx.lastModified

  let attempt = 0
  let lastReason = "unknown"
  let lastStatus: number | null = null

  while (attempt < maxAttempts) {
    attempt += 1
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const unlinkAbortSignal = linkAbortSignal(ctx.signal, controller)

    try {
      throwIfAborted(ctx.signal)
      const response = await doFetch(url, {
        method,
        headers,
        ...(options.body != null ? { body: options.body } : {}),
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
        // Race body-read against an independent timeout. AbortController
        // gates the initial response (line ~117 above), but Node's undici
        // fetch doesn't reliably propagate abort signal into the body
        // decompression stream — large gzip/brotli responses (greenhouse
        // boards with hundreds of jobs + ?content=true) can hang forever
        // inside response.json() even after the outer signal fires. This
        // race forces a hard ceiling on body-read time so the per-company
        // slot cannot wedge.
        const bodyTimeoutMs = Math.max(1_000, timeoutMs * 2)
        let bodyTimer: ReturnType<typeof setTimeout> | undefined
        const bodyReadTimeout = new Promise<never>((_, reject) => {
          bodyTimer = setTimeout(
            () => reject(new Error("body_read_timeout")),
            bodyTimeoutMs
          )
          bodyTimer.unref?.()
        })
        let data: T
        try {
          data = await Promise.race([response.json() as Promise<T>, bodyReadTimeout])
        } finally {
          if (bodyTimer) clearTimeout(bodyTimer)
        }
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
      if (ctx.signal?.aborted || attempt >= maxAttempts) {
        return { kind: "error", status: null, reason: lastReason, upstreamLatencyMs }
      }
      await sleep(250 * 2 ** (attempt - 1) + Math.random() * 250)
    } finally {
      clearTimeout(timeout)
      unlinkAbortSignal()
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

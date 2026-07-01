/**
 * Shared fetch layer for the replica scrapers.
 *
 * Mirrors the important bits of the Python `jobhive` scrapers' HTTP behaviour
 * (retry on 429/5xx with backoff, generous timeouts, browser-ish UA) and — for
 * a fair head-to-head against the real harvester — reuses the same residential
 * proxy the harvester uses for Workday. Set HARVESTER_PROXY_URL to route
 * proxy-listed hosts (default suffix myworkdayjobs.com) through it.
 */

import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici"

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"

const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

const PROXY_HOST_SUFFIXES = (
  process.env.HARVESTER_PROXY_HOSTS ?? "myworkdayjobs.com"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

let directAgent: Agent | null = null
let proxyAgent: ProxyAgent | null = null
let proxyResolved = false

function getDirectAgent(): Agent {
  if (!directAgent) {
    directAgent = new Agent({ keepAliveTimeout: 30_000, keepAliveMaxTimeout: 60_000 })
  }
  return directAgent
}

function getProxyAgent(): ProxyAgent | null {
  if (proxyResolved) return proxyAgent
  proxyResolved = true
  const url = process.env.HARVESTER_PROXY_URL
  if (url) proxyAgent = new ProxyAgent(url)
  return proxyAgent
}

function dispatcherFor(url: string): Dispatcher {
  const proxy = getProxyAgent()
  if (proxy) {
    try {
      const host = new URL(url).hostname.toLowerCase()
      if (PROXY_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
        return proxy
      }
    } catch {
      /* fall through to direct */
    }
  }
  return getDirectAgent()
}

/**
 * Optional transport injection. By default the replica uses its own undici +
 * ProxyAgent (independent from the harvester — the point of an oracle). But for
 * benchmarking the *proxy-routed* adapters (Workday, Workable, …) you want both
 * sides to egress through the exact same proxy so the only difference measured
 * is parsing, not which IP got 403'd. Passing the harvester's `harvesterFetch`
 * here makes the replica ride the identical transport (same ProxyAgent, same
 * HARVESTER_PROXY_HOSTS routing, same keep-alive). See benchmark `--shared-transport`.
 */
type FetchLike = typeof undiciFetch
let injectedFetch: FetchLike | null = null
export function useTransport(fn: FetchLike | null): void {
  injectedFetch = fn
}

export type FetchJsonResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number | null; reason: string }

export type FetchOpts = {
  method?: "GET" | "POST"
  body?: string
  headers?: Record<string, string>
  timeoutMs?: number
  maxAttempts?: number
  signal?: AbortSignal
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fetchJson<T>(
  url: string,
  opts: FetchOpts = {},
): Promise<FetchJsonResult<T>> {
  const method = opts.method ?? "GET"
  const timeoutMs = Math.max(1_000, opts.timeoutMs ?? 30_000)
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3)
  const headers: Record<string, string> = {
    "user-agent": DEFAULT_UA,
    accept: "application/json",
    "accept-encoding": "gzip, deflate, br",
    ...opts.headers,
  }
  if (method === "POST" && opts.body != null && !headers["content-type"]) {
    headers["content-type"] = "application/json"
  }

  let lastReason = "unknown"
  let lastStatus: number | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort()
      else opts.signal.addEventListener("abort", () => controller.abort(), { once: true })
    }
    try {
      // When a shared transport is injected it owns proxy/dispatcher routing;
      // otherwise use our own per-host dispatcher (direct or ProxyAgent).
      const doFetch = injectedFetch ?? undiciFetch
      const res = await doFetch(url, {
        method,
        headers,
        ...(opts.body != null ? { body: opts.body } : {}),
        signal: controller.signal,
        ...(injectedFetch ? {} : { dispatcher: dispatcherFor(url) }),
      })
      lastStatus = res.status
      if (res.ok) {
        const data = (await res.json()) as T
        return { ok: true, status: res.status, data }
      }
      lastReason = `http_${res.status}`
      if (!RETRY_STATUSES.has(res.status) || attempt >= maxAttempts) {
        return { ok: false, status: res.status, reason: lastReason }
      }
      const ra = res.headers.get("retry-after")
      const raSec = ra ? Number.parseFloat(ra) : NaN
      await sleep(Number.isFinite(raSec) ? Math.min(raSec * 1000, 5_000) : 400 * 2 ** (attempt - 1))
    } catch (err) {
      lastStatus = null
      lastReason = (err as Error)?.name === "AbortError" ? "timeout" : "fetch_error"
      if (attempt >= maxAttempts) return { ok: false, status: null, reason: lastReason }
      await sleep(400 * 2 ** (attempt - 1))
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, status: lastStatus, reason: lastReason }
}

/** Fetch raw text (for HTML-detail scrapers like Personio). */
export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string | null> {
  const timeoutMs = Math.max(1_000, opts.timeoutMs ?? 30_000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const doFetch = injectedFetch ?? undiciFetch
    const res = await doFetch(url, {
      method: opts.method ?? "GET",
      headers: { "user-agent": DEFAULT_UA, ...opts.headers },
      ...(opts.body != null ? { body: opts.body } : {}),
      signal: controller.signal,
      ...(injectedFetch ? {} : { dispatcher: dispatcherFor(url) }),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const TAG_RE = /<[^>]+>/g
const WS_RE = /\s+/g

/** Decode HTML entities once and strip tags → plain text, capped at 25k. */
export function cleanHtml(input: string | null | undefined): string | undefined {
  if (!input) return undefined
  let s = String(input)
  // minimal entity decode — covers the ATS payloads we see
  s = s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
  s = s.replace(TAG_RE, " ").replace(WS_RE, " ").trim()
  return s ? s.slice(0, 25_000) : undefined
}

export function parseIso(v: unknown): string | undefined {
  if (!v) return undefined
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

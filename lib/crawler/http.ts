const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.CRAWLER_FETCH_TIMEOUT_MS ?? "12000", 10)
const DEFAULT_MAX_ATTEMPTS = Number.parseInt(process.env.CRAWLER_HTTP_MAX_ATTEMPTS ?? "3", 10)
const DEFAULT_DOMAIN_CONCURRENCY = Number.parseInt(
  process.env.CRAWLER_DOMAIN_CONCURRENCY ?? "3",
  10
)
const DEFAULT_MIN_DELAY_MS = Number.parseInt(
  process.env.CRAWLER_REQUEST_MIN_DELAY_MS ?? "250",
  10
)
const DEFAULT_MAX_DELAY_MS = Number.parseInt(
  process.env.CRAWLER_REQUEST_MAX_DELAY_MS ?? "900",
  10
)
const DEFAULT_BACKOFF_MS = Number.parseInt(
  process.env.CRAWLER_HTTP_RETRY_BASE_DELAY_MS ?? "500",
  10
)
const PROXY_FALLBACK_ENABLED = process.env.CRAWLER_PROXY_FALLBACK_ENABLED === "true"
const PROXY_URL_TEMPLATE = process.env.CRAWLER_PROXY_URL_TEMPLATE?.trim() ?? ""
const PROXY_AUTH_HEADER_NAME = process.env.CRAWLER_PROXY_AUTH_HEADER_NAME?.trim() ?? ""
const PROXY_AUTH_HEADER_VALUE = process.env.CRAWLER_PROXY_AUTH_HEADER_VALUE?.trim() ?? ""
const PROXY_ALLOWED_HOSTS = new Set(
  (process.env.CRAWLER_PROXY_HOST_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
)
const PROXY_BLOCKED_ONLY = process.env.CRAWLER_PROXY_BLOCKED_ONLY !== "false"

const RETRY_STATUSES = new Set([403, 406, 408, 425, 429, 500, 502, 503, 504])

type DomainGate = {
  active: number
  queue: Array<() => void>
  lastStartedAt: number
}

export type CrawlerHttpResult<T = unknown> = {
  ok: boolean
  statusCode: number | null
  response: Response | null
  data: T | null
  errorReason: string | null
  retryCount: number
  fallbackUsed: "proxy" | null
}

const gates = new Map<string, DomainGate>()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jitter(minMs = DEFAULT_MIN_DELAY_MS, maxMs = DEFAULT_MAX_DELAY_MS) {
  if (maxMs <= 0) return 0
  const min = Math.max(0, Math.min(minMs, maxMs))
  const max = Math.max(min, maxMs)
  return min + Math.floor(Math.random() * (max - min + 1))
}

function hostFor(url: string) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return "invalid-url"
  }
}

async function acquireDomain(host: string) {
  const gate =
    gates.get(host) ??
    {
      active: 0,
      queue: [],
      lastStartedAt: 0,
    }
  gates.set(host, gate)

  if (gate.active >= Math.max(1, DEFAULT_DOMAIN_CONCURRENCY)) {
    await new Promise<void>((resolve) => gate.queue.push(resolve))
  }

  gate.active += 1
  const sinceLast = Date.now() - gate.lastStartedAt
  const delay = jitter()
  if (sinceLast < delay) {
    await sleep(delay - sinceLast)
  }
  gate.lastStartedAt = Date.now()

  return () => {
    gate.active = Math.max(0, gate.active - 1)
    gate.queue.shift()?.()
  }
}

export function buildCrawlerRequestHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra ?? {})
  if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT)
  if (!headers.has("accept")) {
    headers.set(
      "accept",
      "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7"
    )
  }
  if (!headers.has("accept-language")) headers.set("accept-language", "en-US,en;q=0.9")
  if (!headers.has("cache-control")) headers.set("cache-control", "no-cache")
  if (!headers.has("pragma")) headers.set("pragma", "no-cache")
  return headers
}

function classifyStatus(status: number | null) {
  if (status === null) return "fetch_error"
  if (status === 403) return "blocked_403"
  if (status === 404) return "not_found_404"
  if (status === 406) return "not_acceptable_406"
  if (status === 429) return "rate_limited_429"
  if (status >= 500) return `server_${status}`
  if (status >= 400) return `http_${status}`
  return null
}

export function detectBlockedHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const compact = html.toLowerCase()
  if (compact.includes("access denied")) return "blocked_html_access_denied"
  if (compact.includes("forbidden")) return "blocked_html_forbidden"
  if (compact.includes("request blocked")) return "blocked_html_request_blocked"
  if (compact.includes("attention required")) return "blocked_html_attention_required"
  if (compact.includes("cloudflare")) return "blocked_html_cloudflare"
  if (compact.includes("akamai")) return "blocked_html_akamai"
  if (compact.includes("incapsula")) return "blocked_html_incapsula"
  if (compact.includes("perimeterx")) return "blocked_html_perimeterx"
  if (compact.includes("bot detection")) return "blocked_html_bot_detection"
  return null
}

function isBlockedReason(reason: string | null | undefined) {
  if (!reason) return false
  const normalized = reason.toLowerCase()
  return (
    normalized.includes("blocked") ||
    normalized.includes("forbidden") ||
    normalized.includes("rate_limited") ||
    normalized.includes("not_acceptable_406")
  )
}

function isAllowedProxyHost(host: string) {
  if (PROXY_ALLOWED_HOSTS.size === 0) return true
  for (const allowed of PROXY_ALLOWED_HOSTS) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true
  }
  return false
}

function buildProxyUrl(targetUrl: string): string | null {
  if (!PROXY_URL_TEMPLATE) return null
  if (PROXY_URL_TEMPLATE.includes("{url}")) {
    return PROXY_URL_TEMPLATE.replace(/\{url\}/g, encodeURIComponent(targetUrl))
  }
  const separator = PROXY_URL_TEMPLATE.includes("?") ? "&" : "?"
  return `${PROXY_URL_TEMPLATE}${separator}url=${encodeURIComponent(targetUrl)}`
}

function isRetriable(status: number | null, error: unknown) {
  if (error) return true
  return status !== null && RETRY_STATUSES.has(status)
}

async function readResponse<T>(
  response: Response,
  responseType: "json" | "text" | "response"
): Promise<T | null> {
  if (responseType === "response") return null
  if (responseType === "text") return (await response.text()) as T
  return (await response.json()) as T
}

async function tryProxyFallback<T>(
  targetUrl: string,
  init: RequestInit,
  options: { responseType: "json" | "text" | "response"; timeoutMs: number },
  fallbackReason: string | null
): Promise<CrawlerHttpResult<T> | null> {
  if (!PROXY_FALLBACK_ENABLED) return null
  const host = hostFor(targetUrl)
  if (!isAllowedProxyHost(host)) return null
  if (PROXY_BLOCKED_ONLY && !isBlockedReason(fallbackReason)) return null

  const proxyUrl = buildProxyUrl(targetUrl)
  if (!proxyUrl) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const headers = buildCrawlerRequestHeaders(init.headers)
    headers.set("x-crawler-target-url", targetUrl)
    if (PROXY_AUTH_HEADER_NAME && PROXY_AUTH_HEADER_VALUE) {
      headers.set(PROXY_AUTH_HEADER_NAME, PROXY_AUTH_HEADER_VALUE)
    }

    const response = await fetch(proxyUrl, {
      method: "GET",
      ...init,
      signal: controller.signal,
      headers,
    })

    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        response,
        data: null,
        errorReason: classifyStatus(response.status),
        retryCount: 0,
        fallbackUsed: "proxy",
      }
    }

    const data = await readResponse<T>(response, options.responseType)
    if (options.responseType === "text") {
      const blockedReason = detectBlockedHtml((data as string | null) ?? null)
      if (blockedReason) {
        return {
          ok: false,
          statusCode: response.status,
          response,
          data: null,
          errorReason: blockedReason,
          retryCount: 0,
          fallbackUsed: "proxy",
        }
      }
    }

    return {
      ok: true,
      statusCode: response.status,
      response,
      data,
      errorReason: null,
      retryCount: 0,
      fallbackUsed: "proxy",
    }
  } catch {
    return {
      ok: false,
      statusCode: null,
      response: null,
      data: null,
      errorReason: "proxy_fetch_error",
      retryCount: 0,
      fallbackUsed: "proxy",
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function crawlerFetch<T = unknown>(
  url: string,
  init: RequestInit = {},
  options: {
    responseType?: "json" | "text" | "response"
    maxAttempts?: number
    timeoutMs?: number
  } = {}
): Promise<CrawlerHttpResult<T>> {
  const responseType = options.responseType ?? "response"
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const timeoutMs = Math.max(1000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let lastStatus: number | null = null
  let lastReason: string | null = null
  let lastResponse: Response | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const release = await acquireDomain(hostFor(url))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let caught: unknown = null

    try {
      const response = await fetch(url, {
        method: "GET",
        ...init,
        signal: controller.signal,
        headers: buildCrawlerRequestHeaders(init.headers),
      })
      lastStatus = response.status
      lastResponse = response

      if (response.ok && responseType === "text") {
        const body = await response.text()
        const blockedReason = detectBlockedHtml(body)
        if (!blockedReason) {
          return {
            ok: true,
            statusCode: response.status,
            response,
            data: body as T,
            errorReason: null,
            retryCount: attempt - 1,
            fallbackUsed: null,
          }
        }
        lastReason = blockedReason
      } else if (response.ok) {
        try {
          const data = await readResponse<T>(response, responseType)
          return {
            ok: true,
            statusCode: response.status,
            response,
            data,
            errorReason: null,
            retryCount: attempt - 1,
            fallbackUsed: null,
          }
        } catch {
          return {
            ok: false,
            statusCode: response.status,
            response,
            data: null,
            errorReason: responseType === "json" ? "invalid_json" : "invalid_body",
            retryCount: attempt - 1,
            fallbackUsed: null,
          }
        }
      } else {
        lastReason = classifyStatus(response.status)
      }

      try {
        await response.body?.cancel()
      } catch {}

      const proxied = await tryProxyFallback<T>(
        url,
        init,
        { responseType, timeoutMs },
        lastReason
      )
      if (proxied?.ok) {
        return {
          ...proxied,
          retryCount: attempt - 1,
        }
      }
      if (proxied) {
        lastStatus = proxied.statusCode
        lastReason = proxied.errorReason
      }
    } catch (error) {
      caught = error
      lastStatus = null
      lastReason = error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_error"
    } finally {
      clearTimeout(timeout)
      release()
    }

    if (attempt >= maxAttempts || !isRetriable(lastStatus, caught)) break
    await sleep(DEFAULT_BACKOFF_MS * 2 ** (attempt - 1) + jitter(100, 750))
  }

  return {
    ok: false,
    statusCode: lastStatus,
    response: lastResponse,
    data: null,
    errorReason: lastReason ?? classifyStatus(lastStatus),
    retryCount: Math.max(0, maxAttempts - 1),
    fallbackUsed: null,
  }
}

export async function fetchCrawlerText(url: string, init: RequestInit = {}) {
  return crawlerFetch<string>(url, init, { responseType: "text" })
}

export async function fetchCrawlerJson<T>(url: string, init: RequestInit = {}) {
  return crawlerFetch<T>(url, init, { responseType: "json" })
}

export async function fetchCrawlerResponse(url: string, init: RequestInit = {}) {
  return crawlerFetch(url, init, { responseType: "response" })
}

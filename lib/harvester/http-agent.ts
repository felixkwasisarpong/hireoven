/**
 * Harvester-local fetch dispatcher with per-host keep-alive + optional HTTP/2.
 *
 * Even with HTTP/2 disabled, this agent gives the harvester adapter calls a
 * dedicated connection pool with explicit keep-alive — the legacy crawler in
 * `lib/crawler/*` and Next.js app routes stay on Node's default fetch, so
 * pool exhaustion / connection churn is isolated to harvest traffic.
 *
 * HTTP/2 (`HARVESTER_HTTP2=true`) is opt-in because undici 6.x's H2
 * implementation is marked experimental and asserts under heavy concurrency
 * on Node 20. Stable on Node 22 + undici 7+. Enable only when you know your
 * runtime supports it. Default is HTTP/1.1 + keep-alive, which already
 * eliminates handshake overhead for shared-host adapters (Greenhouse, Lever,
 * Ashby, SmartRecruiters).
 *
 * Optional proxy routing (`HARVESTER_PROXY_URL`): some ATS WAFs (notably
 * Workday's) block datacenter IP ranges with a 403 even though the board is
 * public — verified by the same request returning 200 from a residential IP.
 * Requests whose hostname matches `HARVESTER_PROXY_HOSTS` (comma-separated
 * suffixes, default `myworkdayjobs.com`) are routed through a residential
 * ProxyAgent so the worker presents a non-datacenter IP. Everything else stays
 * on the direct keep-alive agent. Set `HARVESTER_PROXY_URL` to a proxy URI like
 * `http://user:pass@residential.proxy:8000` to enable.
 */

import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici"

const H2_ENABLED = process.env.HARVESTER_HTTP2 === "true"

const DEFAULT_PROXY_HOST_SUFFIXES = ["myworkdayjobs.com"]

let cachedAgent: Agent | null = null
let cachedProxyAgent: ProxyAgent | null = null
let proxyResolved = false

function getAgent(): Agent {
  if (cachedAgent) return cachedAgent
  cachedAgent = new Agent({
    allowH2: H2_ENABLED,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 120_000,
    // Higher pipelining than the undici default; fast-host adapters benefit.
    pipelining: H2_ENABLED ? 10 : 1,
  })
  return cachedAgent
}

/** Comma-separated host suffixes to route through the proxy, lowercased. */
export function proxyHostSuffixes(
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = env.HARVESTER_PROXY_HOSTS
  if (raw === undefined) return DEFAULT_PROXY_HOST_SUFFIXES
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/** Pure host matcher — exported for tests. */
export function hostMatchesProxy(host: string, suffixes: string[]): boolean {
  const h = host.toLowerCase()
  return suffixes.some((suffix) => h === suffix || h.endsWith(`.${suffix}`))
}

function getProxyAgent(): ProxyAgent | null {
  if (proxyResolved) return cachedProxyAgent
  proxyResolved = true
  const uri = process.env.HARVESTER_PROXY_URL
  if (uri) {
    cachedProxyAgent = new ProxyAgent({
      uri,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 120_000,
    })
  }
  return cachedProxyAgent
}

/** Extract an href from fetch's polymorphic first arg (string | URL | Request)
 *  without relying on instanceof (undici's URL/Request types differ from the
 *  global lib types, so instanceof doesn't narrow). */
function hrefOf(url: Parameters<typeof undiciFetch>[0]): string | null {
  if (typeof url === "string") return url
  const candidate = url as { href?: unknown; url?: unknown }
  if (typeof candidate.href === "string") return candidate.href // URL
  if (typeof candidate.url === "string") return candidate.url // Request
  return null
}

function dispatcherFor(url: Parameters<typeof undiciFetch>[0]): Dispatcher {
  const proxy = getProxyAgent()
  if (proxy) {
    const href = hrefOf(url)
    if (href) {
      try {
        const host = new URL(href).hostname
        if (hostMatchesProxy(host, proxyHostSuffixes())) return proxy
      } catch {
        // Unparseable URL — fall through to the direct agent.
      }
    }
  }
  return getAgent()
}

/**
 * Drop-in replacement for `fetch` that routes through the harvester's HTTP/2
 * dispatcher (or the residential proxy agent for matching hosts). The undici
 * `fetch` Response is API-compatible with the global fetch Response (same
 * `.json()`, `.text()`, `.headers.get()`, `.status`, `.ok`, `.url`) — TS lib
 * types differ subtly (Symbol.dispose iterator) so we cast through `unknown`
 * and trust runtime behaviour.
 */
export const harvesterFetch = ((
  url: Parameters<typeof undiciFetch>[0],
  init?: Parameters<typeof undiciFetch>[1]
) => {
  return undiciFetch(url, { ...init, dispatcher: dispatcherFor(url) })
}) as unknown as typeof fetch

/** Test/debug accessor — never used in production code. */
export function http2Enabled(): boolean {
  return H2_ENABLED
}

/** Tear down the agents' connections — call on worker shutdown. */
export async function closeHarvesterAgent(): Promise<void> {
  if (cachedAgent) {
    await cachedAgent.close()
    cachedAgent = null
  }
  if (cachedProxyAgent) {
    await cachedProxyAgent.close()
    cachedProxyAgent = null
  }
  proxyResolved = false
}

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
import { gateHostRate, reportHostResult } from "@/lib/harvester/host-rate-gate"

const H2_ENABLED = process.env.HARVESTER_HTTP2 === "true"

// apply.workable.com rate-limits per datacenter IP — route through the
// residential proxy pool so each request presents a different egress IP.
const DEFAULT_PROXY_HOST_SUFFIXES = ["myworkdayjobs.com", "apply.workable.com"]

/**
 * Keep-alive is effectively DISABLED on the proxy path (~1 ms idle). Rotating
 * residential proxies (WebShare `p.webshare.io`) assign a fresh egress IP per
 * NEW upstream connection; with a long keep-alive the ProxyAgent reuses ONE
 * tunnel for 30–120 s, so a burst of requests shares ONE IP and Workable
 * rate-limits it (the 429 bursts we saw). A ~1 ms idle timeout makes each
 * request open a fresh CONNECT tunnel → a fresh IP. Direct (non-proxied) hosts
 * keep the long keep-alive on getAgent().
 */
export const PROXY_KEEP_ALIVE_MS = 1

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

/** Comma-separated host suffixes to route through the proxy, lowercased.
 *  HARVESTER_PROXY_HOSTS is additive — it extends the defaults rather than
 *  replacing them, so adding a new host never accidentally drops an existing one. */
export function proxyHostSuffixes(
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = env.HARVESTER_PROXY_HOSTS
  if (!raw) return DEFAULT_PROXY_HOST_SUFFIXES
  const extra = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  const merged = [...DEFAULT_PROXY_HOST_SUFFIXES]
  for (const h of extra) if (!merged.includes(h)) merged.push(h)
  return merged
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
      // No keep-alive on the proxy → fresh connection → fresh rotating IP per request.
      keepAliveTimeout: PROXY_KEEP_ALIVE_MS,
      keepAliveMaxTimeout: PROXY_KEEP_ALIVE_MS,
      // No pipelining: don't multiplex requests onto one tunnel (would re-pin the IP).
      pipelining: 0,
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
export const harvesterFetch = (async (
  url: Parameters<typeof undiciFetch>[0],
  init?: Parameters<typeof undiciFetch>[1]
) => {
  // Proactively rate-gate configured (path-based, per-IP-limited) hosts so we
  // never exceed their threshold and earn a 429. No-op for unconfigured hosts.
  const href = hrefOf(url)
  if (href) await gateHostRate(href)
  const res = await undiciFetch(url, { ...init, dispatcher: dispatcherFor(url) })
  // Feed the status back into the adaptive governor + circuit breaker. A 429/403
  // here cuts this host's rate (and, on a streak, trips its breaker) so the NEXT
  // caller is already slowed — turning one block into a graceful backoff instead
  // of a storm. Network errors (undiciFetch throwing) are intentionally NOT
  // reported: they may be our own timeout/abort, not the host refusing us.
  if (href) reportHostResult(href, res.status)
  return res
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

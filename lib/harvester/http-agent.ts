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
 * MODERATE keep-alive on the proxy path (~10 s idle).
 *
 * History: this was ~1 ms to force a fresh CONNECT tunnel (→ fresh WebShare
 * egress IP) per request and kill Workable's per-IP 429 bursts. But under
 * concurrent harvest load, opening a fresh tunnel for EVERY request creates a
 * CONNECT-handshake storm against the proxy — individual requests then hang past
 * the 20 s per-attempt timeout and surface as "workable fetch failed: timeout"
 * (~20% of Workable crawls; isolated calls run ~300 ms, so it's contention, not
 * a slow proxy). The IP-rotation 429 defense is now redundant: the per-host rate
 * gate (ATS_RATE_LIMIT_WORKABLE_*) already holds 429s to a trickle (~25/hr).
 * So we reuse a tunnel for a short window to eliminate the handshake storm — the
 * rate gate, not per-request IP rotation, is what keeps 429s down. Direct
 * (non-proxied) hosts keep the longer keep-alive on getAgent().
 */
export const PROXY_KEEP_ALIVE_MS = 10_000

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
      // Short keep-alive → a burst reuses one tunnel (no per-request CONNECT
      // storm) but tunnels still recycle quickly. The rate gate prevents 429s.
      keepAliveTimeout: PROXY_KEEP_ALIVE_MS,
      keepAliveMaxTimeout: PROXY_KEEP_ALIVE_MS,
      // No pipelining: keep requests sequential on a reused tunnel rather than
      // multiplexed (multiplexing a burst onto one IP is what invites 429s).
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

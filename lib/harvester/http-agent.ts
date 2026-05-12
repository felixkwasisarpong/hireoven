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
 */

import { Agent, fetch as undiciFetch } from "undici"

const H2_ENABLED = process.env.HARVESTER_HTTP2 === "true"

let cachedAgent: Agent | null = null

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

/**
 * Drop-in replacement for `fetch` that routes through the harvester's HTTP/2
 * dispatcher. The undici `fetch` Response is API-compatible with the global
 * fetch Response (same `.json()`, `.text()`, `.headers.get()`, `.status`,
 * `.ok`, `.url`) — TS lib types differ subtly (Symbol.dispose iterator) so
 * we cast through `unknown` and trust runtime behaviour.
 */
export const harvesterFetch = ((
  url: Parameters<typeof undiciFetch>[0],
  init?: Parameters<typeof undiciFetch>[1]
) => {
  return undiciFetch(url, { ...init, dispatcher: getAgent() })
}) as unknown as typeof fetch

/** Test/debug accessor — never used in production code. */
export function http2Enabled(): boolean {
  return H2_ENABLED
}

/** Tear down the agent's connections — call on worker shutdown. */
export async function closeHarvesterAgent(): Promise<void> {
  if (cachedAgent) {
    await cachedAgent.close()
    cachedAgent = null
  }
}

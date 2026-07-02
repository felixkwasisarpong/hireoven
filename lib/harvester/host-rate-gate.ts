/**
 * Proactive per-host request rate gate for the harvester.
 *
 * Path-based ATS (Workable on apply.workable.com, JazzHR on applytojob.com,
 * Eightfold pcsx, etc.) share ONE domain across all tenants and rate-limit per
 * source IP. Crawling thousands of their boards from a few IPs trips a 429 storm
 * that gets the IP flagged (observed: raw + proxy IPs both 429'd). Retrying on
 * 429 (what conditionalFetchJson does) is reactive — by then we're already
 * flagged. This gate is proactive: it caps the request RATE to configured hosts
 * so we stay under the threshold and never earn the 429 in the first place.
 *
 * Token bucket per host. Rates are configured as a CLUSTER budget and divided by
 * HARVESTER_INSTANCES so N worker loops in one process don't multiply the real
 * rate past the limit. A proxy pool multiplies capacity on top of this (each IP
 * gets the full budget) — the gate is what keeps any single IP polite.
 *
 * Config: HARVESTER_HOST_RATE_LIMITS="apply.workable.com=6,applytojob.com=6"
 *   (host suffix = cluster requests/sec). Unlisted hosts are never gated.
 */

const INSTANCES = Math.max(1, Number.parseInt(process.env.HARVESTER_INSTANCES ?? "1", 10))

type Bucket = { tokens: number; lastRefillMs: number; ratePerSec: number; capacity: number }

function loadConfig(raw = process.env.HARVESTER_HOST_RATE_LIMITS): Map<string, number> {
  const out = new Map<string, number>()
  for (const pair of (raw ?? "").split(",")) {
    const [host, rate] = pair.split("=").map((s) => s.trim())
    const clusterRate = Number.parseFloat(rate ?? "")
    if (host && Number.isFinite(clusterRate) && clusterRate > 0) {
      // Per-process share of the cluster budget.
      out.set(host.toLowerCase(), clusterRate / INSTANCES)
    }
  }
  return out
}

let CONFIG = loadConfig()
const buckets = new Map<string, Bucket>()

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Longest-suffix match so "apply.workable.com" matches "workable.com" configs too. */
function rateForHost(host: string): number {
  let best = 0
  for (const [suffix, rate] of CONFIG) {
    if (host === suffix || host.endsWith(`.${suffix}`)) best = Math.max(best, rate)
  }
  return best
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Await a token for this URL's host before the caller issues the request. No-op
 * (returns immediately) for unconfigured hosts. Serializes only within a host's
 * bucket; different hosts are independent.
 */
export async function gateHostRate(url: string, nowMs = Date.now()): Promise<void> {
  const host = hostOf(url)
  if (!host) return
  const rate = rateForHost(host)
  if (rate <= 0) return

  let b = buckets.get(host)
  if (!b) {
    // Small burst allowance = 1s worth of tokens, min 1.
    const capacity = Math.max(1, rate)
    b = { tokens: capacity, lastRefillMs: nowMs, ratePerSec: rate, capacity }
    buckets.set(host, b)
  } else {
    b.tokens = Math.min(b.capacity, b.tokens + ((nowMs - b.lastRefillMs) / 1000) * b.ratePerSec)
    b.lastRefillMs = nowMs
  }

  if (b.tokens >= 1) {
    b.tokens -= 1
    return
  }
  // Not enough: wait for the next token, then consume it.
  const waitMs = ((1 - b.tokens) / b.ratePerSec) * 1000
  await sleep(waitMs)
  b.tokens = 0
  b.lastRefillMs = Date.now()
}

/** Test hooks. */
export function __setHostRateConfig(raw: string): void {
  CONFIG = loadConfig(raw)
  buckets.clear()
}
export function __resetHostRateGate(): void {
  CONFIG = loadConfig()
  buckets.clear()
}
export function isHostGated(url: string): boolean {
  const h = hostOf(url)
  return h ? rateForHost(h) > 0 : false
}

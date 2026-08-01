/**
 * Adaptive per-host request governor for the harvester.
 *
 * Path-based ATS (Workable on apply.workable.com, JazzHR on applytojob.com,
 * Eightfold pcsx, etc.) share ONE domain across all tenants and rate-limit per
 * source IP. Crawling thousands of their boards from a few IPs trips a 429 storm
 * that gets the IP flagged. Three layers keep us safe:
 *
 *   1. PROACTIVE token bucket — caps the request RATE to each host so we stay
 *      under the threshold and never earn the 429 in the first place. Rates are a
 *      CLUSTER budget divided by HARVESTER_INSTANCES (N loops in one process must
 *      not multiply the real rate). A proxy pool multiplies capacity on top (each
 *      IP gets the full budget); the gate keeps any single IP polite.
 *
 *   2. ADAPTIVE feedback (AIMD) — `reportHostResult` is called after every
 *      response. On a block status (429/403/503) the host's rate is multiplicatively
 *      cut (halved); on sustained success it additively recovers toward its ceiling.
 *      A host we DIDN'T pre-configure but that starts blocking is auto-gated on the
 *      spot, so an unforeseen host protects itself the moment it pushes back.
 *
 *   3. CIRCUIT BREAKER — after `CIRCUIT_THRESHOLD` consecutive blocks a host's
 *      circuit opens for an exponentially-backing-off cooldown; `gateHostRate`
 *      waits it out so we stop hammering a host that's actively refusing us. It
 *      half-opens after the cooldown and closes on the next success.
 *
 * Config: HARVESTER_HOST_RATE_LIMITS="apply.workable.com=6,applytojob.com=6"
 *   (host suffix = cluster requests/sec). Unlisted hosts are ungated UNTIL they
 *   emit a block, then layer 2 auto-gates them. Everything else is env-tunable
 *   (see the constants below).
 */

const INSTANCES = Math.max(1, Number.parseInt(process.env.HARVESTER_INSTANCES ?? "1", 10))

function floatEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseFloat(process.env[name] ?? "")
  return Number.isFinite(n) && n >= min ? n : dflt
}
function intEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}

// HTTP statuses that mean "you're being rate-limited or WAF-blocked" — the
// signal that drives AIMD + the circuit breaker.
const BLOCK_STATUSES = new Set([429, 403, 503, 502])

const DECREASE_FACTOR = floatEnv("HARVESTER_HOST_DECREASE_FACTOR", 0.5, 0.05)
const MIN_RATE = floatEnv("HARVESTER_HOST_MIN_RATE", 0.2, 0.01)
const RECOVER_STEP = floatEnv("HARVESTER_HOST_RECOVER_STEP", 0.5, 0)
const RECOVER_INTERVAL_MS = intEnv("HARVESTER_HOST_RECOVER_INTERVAL_MS", 5_000, 100)
// Auto-gate: rate an unlisted host adopts the moment it first blocks, and the
// ceiling it may recover up to (never back to fully-ungated — once a host shows
// it rate-limits, we keep it politely capped).
const AUTO_GATE_RATE = floatEnv("HARVESTER_HOST_AUTO_GATE_RATE", 3, 0.1)
const AUTO_GATE_CEILING = floatEnv("HARVESTER_HOST_AUTO_GATE_CEILING", 12, 0.1)
// Circuit breaker.
const CIRCUIT_THRESHOLD = intEnv("HARVESTER_HOST_CIRCUIT_THRESHOLD", 5, 1)
const CIRCUIT_BASE_COOLDOWN_MS = intEnv("HARVESTER_HOST_CIRCUIT_COOLDOWN_MS", 30_000, 500)
const CIRCUIT_MAX_COOLDOWN_MS = intEnv("HARVESTER_HOST_CIRCUIT_MAX_COOLDOWN_MS", 600_000, 1_000)
// Cap a single gate wait so one call can't block a worker indefinitely; an open
// circuit simply makes several successive calls each wait a slice.
const MAX_WAIT_MS = intEnv("HARVESTER_HOST_MAX_WAIT_MS", 30_000, 100)

type HostState = {
  tokens: number
  lastRefillMs: number
  capacity: number
  /** Recovery ceiling — the configured rate, or AUTO_GATE_CEILING for auto-gated hosts. */
  baseRate: number
  /** AIMD current rate. 0 means ungated (no token wait). */
  currentRate: number
  consecutiveBlocks: number
  /** Circuit open until this epoch-ms (0 = closed). */
  openUntilMs: number
  /** How many times the circuit has opened — drives exponential cooldown. */
  openCount: number
  lastRecoverMs: number
}

function loadConfig(raw = process.env.HARVESTER_HOST_RATE_LIMITS): Map<string, number> {
  const out = new Map<string, number>()
  for (const pair of (raw ?? "").split(",")) {
    const [host, rate] = pair.split("=").map((s) => s.trim())
    const clusterRate = Number.parseFloat(rate ?? "")
    if (host && Number.isFinite(clusterRate) && clusterRate > 0) {
      out.set(host.toLowerCase(), clusterRate / INSTANCES)
    }
  }
  return out
}

let CONFIG = loadConfig()
const states = new Map<string, HostState>()

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

function abortError(): Error {
  const err = new Error("aborted")
  err.name = "AbortError"
  return err
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function makeState(rate: number, ceiling: number, nowMs: number): HostState {
  const capacity = Math.max(1, rate > 0 ? rate : ceiling)
  return {
    tokens: capacity,
    lastRefillMs: nowMs,
    capacity,
    baseRate: ceiling,
    currentRate: rate,
    consecutiveBlocks: 0,
    openUntilMs: 0,
    openCount: 0,
    lastRecoverMs: nowMs,
  }
}

/**
 * Await a token for this URL's host before the caller issues the request. No-op
 * for pristine unlisted hosts. Waits out an open circuit. Serializes only within
 * a host's bucket; different hosts are independent.
 */
export async function gateHostRate(
  url: string,
  nowMs = Date.now(),
  signal?: AbortSignal
): Promise<void> {
  const host = hostOf(url)
  if (!host) return
  if (signal?.aborted) throw abortError()

  let b = states.get(host)
  if (!b) {
    const cfg = rateForHost(host)
    if (cfg <= 0) return // pristine unlisted host — no gate, no state (until it blocks)
    b = makeState(cfg, cfg, nowMs)
    states.set(host, b)
  }

  // Circuit breaker: if open, wait out (a slice of) the cooldown, then probe.
  if (b.openUntilMs > nowMs) {
    await sleep(Math.min(b.openUntilMs - nowMs, MAX_WAIT_MS), signal)
    nowMs = Date.now()
  }

  if (b.currentRate <= 0) return

  b.tokens = Math.min(b.capacity, b.tokens + ((nowMs - b.lastRefillMs) / 1000) * b.currentRate)
  b.lastRefillMs = nowMs
  if (b.tokens >= 1) {
    b.tokens -= 1
    return
  }
  await sleep(Math.min(((1 - b.tokens) / b.currentRate) * 1000, MAX_WAIT_MS), signal)
  b.tokens = 0
  b.lastRefillMs = Date.now()
}

/**
 * Feed a response's status back into the governor. Called after every harvester
 * fetch. `status` is the HTTP status, or null for a network error (which we do
 * NOT treat as a block — it may be our own timeout).
 */
export function reportHostResult(url: string, status: number | null, nowMs = Date.now()): void {
  const host = hostOf(url)
  if (!host) return
  const isBlock = typeof status === "number" && BLOCK_STATUSES.has(status)
  const now = nowMs
  let b = states.get(host)

  if (!isBlock) {
    if (!b) return
    const ok = typeof status === "number" && status >= 200 && status < 400
    if (!ok) return // non-block error (4xx that isn't a block, etc.) — leave state as-is
    b.consecutiveBlocks = 0
    b.openUntilMs = 0 // success closes the circuit
    if (b.currentRate > 0 && b.currentRate < b.baseRate && now - b.lastRecoverMs >= RECOVER_INTERVAL_MS) {
      b.currentRate = Math.min(b.baseRate, b.currentRate + RECOVER_STEP)
      b.lastRecoverMs = now
      if (b.openCount > 0) b.openCount -= 1 // decay the penalty on sustained health
    }
    return
  }

  // Block (429 / 403 / 503 / 502): back off this host.
  if (!b) {
    const cfg = rateForHost(host)
    if (cfg > 0) {
      // Configured host, first block: start from its budget, then cut.
      b = makeState(cfg, cfg, now)
      states.set(host, b)
      b.currentRate = Math.max(MIN_RATE, cfg * DECREASE_FACTOR)
    } else {
      // Unlisted host, first block: adopt the conservative auto-gate rate.
      b = makeState(AUTO_GATE_RATE, AUTO_GATE_CEILING, now)
      states.set(host, b)
    }
  } else {
    const from = b.currentRate > 0 ? b.currentRate : AUTO_GATE_RATE
    b.currentRate = Math.max(MIN_RATE, from * DECREASE_FACTOR)
    if (b.baseRate <= 0) b.baseRate = AUTO_GATE_CEILING
  }
  // Drain the bucket so the reduced rate bites immediately.
  b.tokens = 0
  b.lastRefillMs = now
  b.consecutiveBlocks += 1

  if (b.consecutiveBlocks >= CIRCUIT_THRESHOLD) {
    b.openCount += 1
    const cooldown = Math.min(
      CIRCUIT_MAX_COOLDOWN_MS,
      CIRCUIT_BASE_COOLDOWN_MS * 2 ** (b.openCount - 1)
    )
    b.openUntilMs = now + cooldown
    b.consecutiveBlocks = 0
  }
}

/** True if the host is proactively configured OR has an active adaptive gate. */
export function isHostGated(url: string): boolean {
  const h = hostOf(url)
  if (!h) return false
  if (rateForHost(h) > 0) return true
  const b = states.get(h)
  return !!b && (b.currentRate > 0 || b.openUntilMs > Date.now())
}

/** Test hooks. */
export function __setHostRateConfig(raw: string): void {
  CONFIG = loadConfig(raw)
  states.clear()
}
export function __resetHostRateGate(): void {
  CONFIG = loadConfig()
  states.clear()
}
/** Observability / test accessor for a host's current governor state. */
export function __hostGateState(url: string):
  | { currentRate: number; consecutiveBlocks: number; circuitOpen: boolean; openCount: number }
  | undefined {
  const h = hostOf(url)
  const b = h ? states.get(h) : undefined
  if (!b) return undefined
  return {
    currentRate: b.currentRate,
    consecutiveBlocks: b.consecutiveBlocks,
    circuitOpen: b.openUntilMs > Date.now(),
    openCount: b.openCount,
  }
}

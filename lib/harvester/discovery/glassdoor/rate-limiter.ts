export type GlassdoorRateLimitConfig = {
  maxRequestsPerMinute: number
  minDelayMs: number
  maxDelayMs: number
  backoffBaseMs?: number
  backoffMaxMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomInt(min: number, max: number): number {
  if (max <= min) return min
  return Math.floor(min + Math.random() * (max - min + 1))
}

export class GlassdoorRateLimiter {
  private lastRequestAt = 0
  private readonly config: Required<GlassdoorRateLimitConfig>
  private readonly sleepImpl: (ms: number) => Promise<void>

  constructor(
    config: GlassdoorRateLimitConfig,
    sleepImpl: (ms: number) => Promise<void> = sleep
  ) {
    this.config = {
      backoffBaseMs: 60_000,
      backoffMaxMs: 6 * 60 * 60 * 1000,
      ...config,
      maxRequestsPerMinute: Math.max(1, config.maxRequestsPerMinute),
      minDelayMs: Math.max(0, config.minDelayMs),
      maxDelayMs: Math.max(config.minDelayMs, config.maxDelayMs),
    }
    this.sleepImpl = sleepImpl
  }

  async waitBeforeRequest(): Promise<number> {
    const minIntervalMs = Math.ceil(60_000 / this.config.maxRequestsPerMinute)
    const jitterMs = randomInt(this.config.minDelayMs, this.config.maxDelayMs)
    const now = Date.now()
    const rpmWaitMs = Math.max(0, this.lastRequestAt + minIntervalMs - now)
    const waitMs = Math.max(jitterMs, rpmWaitMs)

    if (waitMs > 0) await this.sleepImpl(waitMs)
    this.lastRequestAt = Date.now()
    return waitMs
  }

  backoffDelayMs(attempts: number): number {
    const exponent = Math.max(0, Math.min(8, attempts - 1))
    const delay = this.config.backoffBaseMs * 2 ** exponent
    return Math.min(this.config.backoffMaxMs, delay)
  }
}

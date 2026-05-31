/**
 * Apex in-memory TTL cache — no Redis dependency.
 * Runs as a singleton in the Node.js process; survives across requests.
 *
 * Safety: never cache sensitive user data (resumes, autofill values, application answers).
 */

import type { ApexCacheStats } from "./types"

type CacheEntry<T> = {
  value:     T
  expiresAt: number
  hits:      number
  createdAt: number
}

const DEFAULT_MAX_SIZE = 400

class ApexCache {
  private store = new Map<string, CacheEntry<unknown>>()
  private hits   = 0
  private misses = 0
  private maxSize: number

  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined
    if (!entry) { this.misses++; return null }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      this.misses++
      return null
    }
    entry.hits++
    this.hits++
    return entry.value
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (this.store.size >= this.maxSize) this.evictOldest()
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      hits:      0,
      createdAt: Date.now(),
    })
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  // Invalidate all keys starting with a prefix (e.g., user-specific keys)
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key)
    }
  }

  stats(): ApexCacheStats {
    const total = this.hits + this.misses
    return {
      size:    this.store.size,
      maxSize: this.maxSize,
      hits:    this.hits,
      misses:  this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    }
  }

  private evictOldest(): void {
    const now = Date.now()
    // First pass: evict expired entries
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) { this.store.delete(key); return }
    }
    // Second pass: evict the least-accessed entry
    let minHits = Infinity
    let evictKey = ""
    for (const [key, entry] of this.store) {
      if (entry.hits < minHits) { minHits = entry.hits; evictKey = key }
    }
    if (evictKey) this.store.delete(evictKey)
  }
}

// Singleton — one cache per process, shared across requests
const globalForCache = globalThis as typeof globalThis & { _apexCache?: ApexCache }
export const apexCache = globalForCache._apexCache ?? (globalForCache._apexCache = new ApexCache())

// ── TTL constants ─────────────────────────────────────────────────────────────

export const CACHE_TTL = {
  COMPANY_INTEL:      24 * 60 * 60 * 1000, // 24h — company data changes slowly
  JOB_SUMMARY:         4 * 60 * 60 * 1000, // 4h
  STRATEGY:           24 * 60 * 60 * 1000, // 24h per user
  RESEARCH:            1 * 60 * 60 * 1000, // 1h per objective
  JOB_FIT:            30 * 60 * 1000,      // 30min — resume/job fit
  MARKET_SIGNALS:     60 * 60 * 1000,      // 1h
  APEX_CHAT_COMMAND:  5 * 60 * 1000,      // 5min for repeated identical commands
  COVER_LETTER:       30 * 60 * 1000,      // 30min — job + resume pair
} as const

// ── Cache key builders ────────────────────────────────────────────────────────

export function cacheKey(...parts: (string | number | boolean | null | undefined)[]): string {
  return parts.map((p) => String(p ?? "_")).join(":")
}

/**
 * Stable hash for longer strings (message text, prompts, etc.).
 * Uses SHA-256 truncated to 16 hex chars (64 bits) — collision probability
 * is negligible at our scale, replacing the prior 32-bit djb2 variant which
 * had real collision risk across thousands of cached prompts.
 *
 * Callers MUST still namespace keys with userId via `cacheKey(..., userId)`;
 * a strong hash alone doesn't prevent cross-user leakage if userId is missing.
 */
import { createHash } from "node:crypto"

export function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}

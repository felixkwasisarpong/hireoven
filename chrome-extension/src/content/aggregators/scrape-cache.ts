/**
 * Per-(site, jobId) scrape cache with 10-minute TTL.
 *
 * Each aggregator handler consults this before re-ingesting a job that's already
 * been seen in the same session. Memory-only: a fresh page load resets state.
 */

const TTL_MS = 10 * 60 * 1000

interface CacheEntry<T> {
  storedAt: number
  value: T
}

const store = new Map<string, CacheEntry<unknown>>()

export function cacheKey(site: string, jobId: string): string {
  return `${site}:${jobId}`
}

export function getCached<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() - entry.storedAt > TTL_MS) {
    store.delete(key)
    return null
  }
  return entry.value as T
}

export function setCached<T>(key: string, value: T): void {
  store.set(key, { storedAt: Date.now(), value })
}

export function clearCache(): void {
  store.clear()
}

/**
 * Lookback window (minutes) for the instant-notify fallback sweep. Wider than
 * the cron interval so a missed run is covered; dedup makes the overlap safe.
 * Kept out of the route file because Next.js route modules may only export
 * handlers + config.
 */
export function instantNotifyWindowMinutes(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.INSTANT_NOTIFY_WINDOW_MIN ?? "20")
  return Number.isFinite(n) && n > 0 ? Math.min(n, 180) : 20
}

export function isWithinInstantNotifyWindow(
  firstDetectedAt: string | Date | null | undefined,
  options: { nowMs?: number; windowMinutes?: number } = {}
): boolean {
  if (!firstDetectedAt) return false
  const detectedMs = firstDetectedAt instanceof Date
    ? firstDetectedAt.getTime()
    : new Date(firstDetectedAt).getTime()
  if (!Number.isFinite(detectedMs)) return false

  const nowMs = options.nowMs ?? Date.now()
  const windowMinutes = options.windowMinutes ?? instantNotifyWindowMinutes()
  const ageMs = nowMs - detectedMs
  // Allow small clock skew for DB/app differences, but never notify genuinely
  // old postings from backfills or update-only harvest paths.
  return ageMs >= -5 * 60_000 && ageMs <= windowMinutes * 60_000
}

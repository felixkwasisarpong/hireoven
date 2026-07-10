/**
 * Lookback window (minutes) for the instant-notify fallback sweep. Wider than
 * the cron interval so a missed run is covered; dedup makes the overlap safe.
 * Kept out of the route file because Next.js route modules may only export
 * handlers + config.
 */
export function instantNotifyWindowMinutes(env: Record<string, string | undefined> = process.env): number {
  // Default 40: must exceed ALERT_ACCUMULATE_MINUTES (30) + the sweep interval
  // so jobs held back during the accumulation window are still inside the
  // lookback when it elapses (otherwise a batched job would be dropped, unsent).
  const n = Number(env.INSTANT_NOTIFY_WINDOW_MIN ?? "40")
  return Number.isFinite(n) && n > 0 ? Math.min(n, 180) : 40
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

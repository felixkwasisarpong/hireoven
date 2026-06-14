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

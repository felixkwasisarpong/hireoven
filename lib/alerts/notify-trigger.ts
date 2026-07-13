/**
 * Event trigger for instant notifications.
 *
 * The harvester calls this right after persisting a company's jobs. The web app
 * receives the new IDs and either sends immediately when accumulation is
 * disabled, or acknowledges and lets the hourly accumulator sweep batch email.
 *
 * Best-effort and non-blocking: env-gated, never throws, bounded. If it can't
 * reach the app (or env isn't configured), /api/cron/instant-notify is the
 * safety net and default email accumulator.
 */
import { resolveAppOrigin } from "@/lib/app-url"

const NOTIFY_BATCH_CAP = 500

export async function triggerInstantNotify(jobIds: string[]): Promise<void> {
  const ids = Array.from(new Set(jobIds.filter(Boolean))).slice(0, NOTIFY_BATCH_CAP)
  if (ids.length === 0) return

  const secret = process.env.CRON_SECRET
  const base = resolveAppOrigin()
  // No secret, or no real app origin (defaults to localhost when unset) → rely
  // on the cron fallback instead of POSTing into the void.
  if (!secret || !base || base.includes("localhost")) return

  try {
    await fetch(`${base}/api/internal/notify-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ jobIds: ids }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // best-effort; the cron sweep backstops any miss
  }
}

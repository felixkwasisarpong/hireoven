/**
 * Event trigger for instant notifications.
 *
 * The harvester calls this right after persisting a company's jobs, so an alert
 * fires the moment a matching job lands — not on a timer. It hands the new job
 * IDs to the web app (which holds the VAPID / Resend keys and does the sending),
 * rather than sending from the harvester box.
 *
 * Best-effort and non-blocking: env-gated, never throws, bounded. If it can't
 * reach the app (or env isn't configured), the /api/cron/instant-notify sweep is
 * the safety net.
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

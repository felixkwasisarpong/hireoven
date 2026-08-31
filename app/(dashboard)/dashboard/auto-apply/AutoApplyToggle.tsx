"use client"

import { useState } from "react"
import { Loader2, Moon } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  initialEnabled: boolean
  /** Included cap, for stating the promise in concrete terms. */
  weeklyCap: number
  /** False when the plan itself is not switched on for this account. */
  planEnabled: boolean
}

/**
 * The switch that turns overnight auto-apply on.
 *
 * Until this existed the feature could only be enabled by someone with database
 * access, which made it unshippable however well the pipeline worked.
 *
 * The browser's timezone is sent with the request because the overnight sweep
 * selects users by their LOCAL hour. Without it the column stays null, the cron
 * falls back to UTC, and someone in the Americas would get their "overnight"
 * run in the early evening — the one thing the feature promises not to do.
 */
export default function AutoApplyToggle({ initialEnabled, weeklyCap, planEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (saving || !planEnabled) return
    const next = !enabled
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/apex/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: next,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      // Only move the switch once the server confirms. Flipping optimistically
      // would tell someone their applications are running when they are not.
      if (!res.ok) {
        setError(res.status === 403 ? "Auto-apply is a Pro Max feature." : "Couldn't save that — try again.")
        return
      }
      const data = await res.json().catch(() => null)
      setEnabled(data?.prefs?.enabled ?? next)
    } catch {
      setError("Couldn't reach the server — try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={cn(
      "mb-6 rounded-lg border p-4",
      enabled ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white",
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Moon className={cn("mt-0.5 h-4 w-4 shrink-0", enabled ? "text-emerald-600" : "text-slate-400")} />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {enabled ? "Auto-apply is on" : "Auto-apply is off"}
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {enabled
                ? `We'll apply to up to ${weeklyCap} of your strongest matches a week, overnight in your timezone.`
                : `Turn this on and we'll apply to up to ${weeklyCap} of your strongest matches a week while you sleep.`}
            </p>
            {!planEnabled && (
              <p className="mt-1 text-xs text-amber-700">
                Not available on your plan yet.
              </p>
            )}
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Enable overnight auto-apply"
          disabled={saving || !planEnabled}
          onClick={() => void toggle()}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
            enabled ? "bg-emerald-600" : "bg-slate-300",
            (saving || !planEnabled) && "cursor-not-allowed opacity-60",
          )}
        >
          <span className={cn(
            "inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform",
            enabled ? "translate-x-[22px]" : "translate-x-0.5",
          )}>
            {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
          </span>
        </button>
      </div>

      {enabled && (
        <p className="mt-3 border-t border-emerald-200 pt-3 text-xs text-slate-600">
          Only roles matching 85% or better. We never apply twice to the same job, and
          we&apos;ll leave anything we can&apos;t complete for you rather than send it half-filled.
        </p>
      )}
    </section>
  )
}

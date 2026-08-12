"use client"

import { useState } from "react"
import Link from "next/link"
import { Bell, ChevronRight } from "lucide-react"
import type { UserEmailPreferences } from "@/lib/email/preferences"

const TYPES: { key: keyof UserEmailPreferences; title: string; desc: string }[] = [
  { key: "weekly_digest", title: "Weekly digest", desc: "Mondays — your scorecard, watched companies, and the week in H-1B sponsorship." },
  { key: "layoff_alerts", title: "Layoff alerts", desc: "When a watched company reports a layoff event." },
  { key: "scorecard_milestones", title: "Scorecard milestones", desc: "When your shared scorecard hits 10, 100, 1,000 views." },
  { key: "opt_expiration", title: "OPT expiration reminders", desc: "90 / 30 / 7 days before your OPT ends (requires a date below)." },
  { key: "lottery_brief", title: "Lottery season brief", desc: "One email in the spring when H-1B lottery results land." },
]

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? "bg-orange-500" : "bg-slate-300"}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">{children}</section>
}

export function EmailPreferencesClient({
  initialPrefs,
  watched,
}: {
  initialPrefs: UserEmailPreferences
  watched: { company_id: string; name: string }[]
}) {
  const [prefs, setPrefs] = useState(initialPrefs)
  const [list, setList] = useState(watched)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : prefs.timezone

  async function save(patch: Partial<UserEmailPreferences>) {
    setPrefs((p) => ({ ...p, ...patch }))
    const res = await fetch("/api/email/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (res.ok) setSavedAt("Saved")
  }

  async function unwatch(companyId: string) {
    setList((l) => l.filter((c) => c.company_id !== companyId))
    await fetch("/api/watchlist", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    })
  }

  async function unsubscribeAll() {
    if (!confirm("Unsubscribe from every Hireoven email? You can re-enable any type later.")) return
    await fetch("/api/email/unsubscribe-all", { method: "POST" })
    setPrefs((p) => ({
      ...p,
      weekly_digest: false,
      layoff_alerts: false,
      scorecard_milestones: false,
      opt_expiration: false,
      lottery_brief: false,
    }))
    setSavedAt("Unsubscribed from all")
  }

  return (
    <div>
      {/* D6: job alerts (saved searches) are the source of new-match
          notifications, so they live here in notification settings. */}
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Bell className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Job alerts</p>
              <p className="mt-0.5 text-sm text-slate-500">
                Saved searches that notify you the moment a matching role is posted.
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/alerts"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Manage alerts
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </Card>

      <Card>
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">What we send</h2>
        <div className="mt-3 divide-y divide-slate-100">
          {TYPES.map((t) => (
            <div key={t.key} className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">{t.title}</p>
                <p className="mt-0.5 text-sm text-slate-500">{t.desc}</p>
              </div>
              <Toggle on={Boolean(prefs[t.key])} onChange={(v) => save({ [t.key]: v })} />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">When we send the weekly</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={prefs.weekly_send_day}
            onChange={(e) => save({ weekly_send_day: Number(e.target.value) })}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
          <select
            value={prefs.weekly_send_hour}
            onChange={(e) => save({ weekly_send_hour: Number(e.target.value) })}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
            ))}
          </select>
          <span className="text-sm text-slate-500">{prefs.timezone}</span>
          {browserTz && browserTz !== prefs.timezone && (
            <button onClick={() => save({ timezone: browserTz })} className="text-sm font-medium text-orange-600 hover:underline">
              Use {browserTz}
            </button>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">OPT timing (optional)</h2>
        <p className="mt-1 text-sm text-slate-500">Used only to time expiration reminders. Delete any time.</p>
        <div className="mt-4 flex flex-wrap gap-5">
          <label className="text-sm">
            <span className="block text-slate-600">OPT end date</span>
            <input
              type="date"
              defaultValue={prefs.opt_end_date ?? ""}
              onChange={(e) => save({ opt_end_date: e.target.value || null })}
              className="mt-1 rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-600">STEM OPT end date</span>
            <input
              type="date"
              defaultValue={prefs.stem_opt_end_date ?? ""}
              onChange={(e) => save({ stem_opt_end_date: e.target.value || null })}
              className="mt-1 rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">Watched companies</h2>
        {list.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">You&rsquo;re not watching any companies yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {list.map((c) => (
              <li key={c.company_id} className="flex items-center justify-between py-2.5">
                <span className="text-sm text-slate-800">{c.name}</span>
                <button onClick={() => unwatch(c.company_id)} className="text-sm font-medium text-slate-400 hover:text-red-600">
                  Unwatch
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-6 flex items-center justify-between">
        <span className="text-xs text-slate-400">{savedAt}</span>
        <button onClick={unsubscribeAll} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">
          Unsubscribe from everything
        </button>
      </div>
    </div>
  )
}

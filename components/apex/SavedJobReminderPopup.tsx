"use client"

/**
 * Saved-but-not-applied reminder popup.
 *
 * Surfaces jobs you saved in the last 3 days but haven't applied to yet
 * (fresh intent — nudge to apply before momentum fades). Data comes from
 * /api/apex/saved-reminder. Shows at most once per browser session and honours
 * a localStorage snooze. High-energy / colorful by design — it's a nudge.
 */
import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Bookmark, Clock3, Sparkles, X } from "lucide-react"

type SavedReminderJob = {
  applicationId: string
  jobId: string | null
  jobTitle: string
  companyName: string
  daysOld: number
  logoUrl: string | null
}

const SESSION_KEY = "apex-saved-reminder-shown-v1"
const SNOOZE_KEY = "apex-saved-reminder-snooze-until"
const DAY_MS = 24 * 60 * 60 * 1000

/** Deterministic vibrant gradient per company (logo fallback). */
const AVATAR_GRADIENTS = [
  "from-fuchsia-500 to-pink-500",
  "from-indigo-500 to-violet-500",
  "from-sky-500 to-cyan-400",
  "from-amber-500 to-orange-500",
  "from-emerald-500 to-teal-400",
  "from-rose-500 to-red-500",
]
function gradientFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "★"
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase()
}

function CompanyAvatar({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false)
  if (logoUrl && !failed) {
    return (
      <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={name}
          className="h-full w-full object-contain p-1"
          onError={() => setFailed(true)}
          loading="lazy"
        />
      </span>
    )
  }
  return (
    <span
      className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${gradientFor(
        name,
      )} text-sm font-bold text-white shadow-sm`}
    >
      {initials(name)}
    </span>
  )
}

export default function SavedJobReminderPopup() {
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [jobs, setJobs] = useState<SavedReminderJob[]>([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (typeof window === "undefined") return

    // Preview mode: ?apexReminder=preview shows the popup with sample data
    // (bypasses guards + the API) so the visual can be reviewed quickly.
    if (window.location.search.includes("apexReminder=preview")) {
      setJobs([
        { applicationId: "p1", jobId: null, jobTitle: "Senior Product Designer", companyName: "Linear", daysOld: 1, logoUrl: "https://img.logo.dev/linear.app" },
        { applicationId: "p2", jobId: null, jobTitle: "Staff Software Engineer", companyName: "Ramp", daysOld: 2, logoUrl: "https://img.logo.dev/ramp.com" },
        { applicationId: "p3", jobId: null, jobTitle: "Growth Marketing Lead", companyName: "Notion Labs", daysOld: 3, logoUrl: null },
      ])
      setTotal(5)
      setOpen(true)
      return
    }

    if (window.sessionStorage.getItem(SESSION_KEY)) return
    const snoozeUntil = Number(window.localStorage.getItem(SNOOZE_KEY) || 0)
    if (snoozeUntil && Date.now() < snoozeUntil) return

    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/apex/saved-reminder", { cache: "no-store" })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { jobs?: SavedReminderJob[]; total?: number }
        const list = data.jobs ?? []
        if (cancelled || list.length === 0) return
        setJobs(list.slice(0, 4))
        setTotal(data.total ?? list.length)
        window.sessionStorage.setItem(SESSION_KEY, "1")
        window.setTimeout(() => !cancelled && setOpen(true), 650)
      } catch {
        /* network hiccup — stay silent, it's only a nudge */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  function close() {
    setLeaving(true)
    window.setTimeout(() => setOpen(false), 200)
  }
  function snooze() {
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + DAY_MS))
    } catch {
      /* ignore */
    }
    close()
  }
  function dismiss() {
    // Saved jobs age out of the 3-day window quickly; suppress for 3 days.
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + 3 * DAY_MS))
    } catch {
      /* ignore */
    }
    close()
  }

  if (!open) return null

  const count = total
  const extra = count - jobs.length

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Saved jobs reminder"
    >
      <button
        type="button"
        onClick={snooze}
        aria-label="Close reminder"
        className={`absolute inset-0 bg-slate-900/50 backdrop-blur-sm ${
          leaving ? "opacity-0 transition-opacity duration-200" : "animate-fade-in-backdrop"
        }`}
      />

      <div
        className={`relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-[0_30px_80px_-20px_rgba(79,70,229,0.45)] ring-1 ring-black/5 ${
          leaving ? "scale-95 opacity-0 transition-all duration-200" : "animate-scale-in"
        }`}
      >
        {/* colorful animated header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-fuchsia-500 to-amber-400 px-6 pb-8 pt-7 text-white">
          <div className="animate-hue-float absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
          <div className="animate-hue-float absolute -bottom-14 -left-8 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
          {["left-8 top-5", "right-12 top-8", "left-1/2 top-3", "right-6 bottom-6", "left-10 bottom-4"].map(
            (pos, i) => (
              <Sparkles
                key={pos}
                className={`absolute ${pos} h-3.5 w-3.5 text-white/70`}
                style={{ animation: `pulse-ring 2.4s ease-in-out ${i * 0.3}s infinite` }}
              />
            ),
          )}

          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="absolute right-3 top-3 rounded-full p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative flex items-center gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/40 backdrop-blur">
              <Bookmark className="h-6 w-6" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">Apex reminder</p>
              <h2 className="text-lg font-extrabold leading-tight drop-shadow-sm">
                Don&apos;t ghost your saved jobs 👀
              </h2>
            </div>
          </div>
          <p className="relative mt-3 text-sm font-medium text-white/90">
            You saved{" "}
            <span className="font-bold">
              {count} role{count === 1 ? "" : "s"}
            </span>{" "}
            this week but haven&apos;t applied yet. A quick apply keeps you in the running.
          </p>
        </div>

        {/* job list */}
        <div className="space-y-2 px-5 py-5">
          {jobs.map((job) => (
            <div
              key={job.applicationId}
              className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 transition hover:border-indigo-200 hover:bg-indigo-50/40"
            >
              <CompanyAvatar name={job.companyName} logoUrl={job.logoUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">{job.jobTitle}</p>
                <p className="truncate text-xs text-slate-500">{job.companyName}</p>
              </div>
              <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">
                <Clock3 className="h-3 w-3" />
                {job.daysOld === 0 ? "today" : `${job.daysOld}d`}
              </span>
            </div>
          ))}
          {extra > 0 && (
            <p className="pl-1 pt-0.5 text-xs font-medium text-slate-400">
              + {extra} more saved {extra === 1 ? "role" : "roles"}
            </p>
          )}
        </div>

        {/* actions */}
        <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={snooze}
            className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            Remind me tomorrow
          </button>
          <Link
            href="/dashboard/applications"
            onClick={dismiss}
            className="group ml-auto inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 transition hover:shadow-xl hover:shadow-fuchsia-500/30 active:scale-[0.98]"
          >
            Apply now
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </div>
  )
}

"use client"

/**
 * Skill-gap → learning engine UI. Fetches /api/grow/skill-gap and renders the
 * highest-leverage skills to learn: roles unlocked, pay signal, and a course
 * CTA. Falls back to clear "set up your profile / resume" states when we can't
 * compute a gap yet.
 */
import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowUpRight, GraduationCap, Loader2, Sparkles, TrendingUp } from "lucide-react"

type Course = { provider: string; title: string; url: string }
type Gap = {
  skill: string
  jobsRequiring: number
  oneAway: number
  medianSalary: number | null
  salaryUplift: number | null
  course: Course
}
type Data = {
  gaps: Gap[]
  targetJobs: number
  eligibleNow: number
  haveSkills: number
  targetRoles: string[]
  needsProfile?: boolean
  needsResume?: boolean
}

function k(n: number): string {
  return `$${Math.round(n / 1000)}K`
}

export default function SkillGapEngine() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch("/api/grow/skill-gap", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Mapping your skills against live roles…
        </div>
      </div>
    )
  }

  if (data?.needsResume) {
    return (
      <EmptyState
        title="Add a resume to map your skills"
        body="We compare the skills on your resume against live postings for your target roles. Upload one to see what to learn next."
        ctaHref="/dashboard/resume"
        ctaLabel="Add your resume"
      />
    )
  }
  if (data?.needsProfile) {
    return (
      <EmptyState
        title="Tell us your target roles"
        body="Set the roles you're aiming for and we'll show which skills unlock the most of them — and what they pay."
        ctaHref="/dashboard/apex"
        ctaLabel="Set target roles"
      />
    )
  }
  if (!data || data.gaps.length === 0) {
    return (
      <EmptyState
        title="You're well-matched to your target roles"
        body={
          data && data.targetJobs > 0
            ? `Across ${data.targetJobs.toLocaleString()} live ${data.targetRoles[0] ?? "target"} postings, you already cover the skills they ask for. We'll surface new gaps as the market shifts.`
            : "We couldn't find enough live postings for your target roles yet. Check back as new roles land."
        }
        ctaHref="/dashboard"
        ctaLabel="Browse the feed"
      />
    )
  }

  const top = data.gaps[0]
  const maxJobs = Math.max(...data.gaps.map((g) => g.jobsRequiring), 1)

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      {/* Hero recommendation */}
      {top.oneAway > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-5">
          <div className="flex items-center gap-2 text-emerald-700">
            <Sparkles className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Highest-leverage next skill</p>
          </div>
          <p className="mt-2 text-[20px] font-bold leading-tight text-slate-900">
            Learn {top.skill} → unlock {top.oneAway} role{top.oneAway === 1 ? "" : "s"} you&apos;re one skill away from
          </p>
          <p className="mt-1 text-[13.5px] text-slate-600">
            {top.skill} appears in {top.jobsRequiring} of your {data.targetJobs.toLocaleString()} target postings
            {top.medianSalary ? `, paying a median of ${k(top.medianSalary)}` : ""}
            {top.salaryUplift && top.salaryUplift > 2000 ? ` — ${k(top.salaryUplift)} above your target average` : ""}.
          </p>
          <a
            href={top.course.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700"
          >
            <GraduationCap className="h-4 w-4" />
            {top.course.title} · {top.course.provider}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      )}

      {/* Coverage summary */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Target postings" value={data.targetJobs.toLocaleString()} />
        <Stat label="Already eligible" value={data.eligibleNow.toLocaleString()} accent="text-emerald-600" />
        <Stat label="Your skills" value={data.haveSkills.toLocaleString()} />
      </div>

      {/* Gap list */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Skills ranked by what they unlock</p>
        </div>
        <ul className="divide-y divide-slate-100">
          {data.gaps.map((g) => (
            <li key={g.skill} className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[14.5px] font-semibold text-slate-800">{g.skill}</p>
                  {g.oneAway > 0 && (
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                      {g.oneAway} one away
                    </span>
                  )}
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-slate-300" style={{ width: `${(g.jobsRequiring / maxJobs) * 100}%` }} />
                </div>
                <p className="mt-1 text-[11.5px] text-slate-400">
                  in {g.jobsRequiring} postings
                  {g.medianSalary ? ` · median ${k(g.medianSalary)}` : ""}
                  {g.salaryUplift && g.salaryUplift > 2000 ? (
                    <span className="text-emerald-600"> · <TrendingUp className="inline h-3 w-3" /> +{k(g.salaryUplift)}</span>
                  ) : null}
                </p>
              </div>
              <a
                href={g.course.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700"
              >
                <GraduationCap className="h-3.5 w-3.5" />
                Learn
              </a>
            </li>
          ))}
        </ul>
      </div>

      <p className="px-1 text-[11px] text-slate-400">
        Unlock counts reflect live postings for {data.targetRoles.slice(0, 2).join(" / ") || "your target roles"}. Course
        links may be affiliate links that support Hireoven at no cost to you.
      </p>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <p className={`text-[20px] font-bold tabular-nums ${accent ?? "text-slate-900"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-medium text-slate-400">{label}</p>
    </div>
  )
}

function EmptyState({ title, body, ctaHref, ctaLabel }: { title: string; body: string; ctaHref: string; ctaLabel: string }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
        <GraduationCap className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-[18px] font-bold text-slate-900">{title}</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500">{body}</p>
      <Link
        href={ctaHref}
        className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-slate-800"
      >
        {ctaLabel}
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

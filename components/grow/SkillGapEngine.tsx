"use client"

/**
 * Skill-gap → learning engine UI. Fetches /api/grow/skill-gap and renders the
 * highest-leverage skills to learn: roles unlocked, pay signal, and a course
 * CTA. Falls back to clear "set up your profile / resume" states when we can't
 * compute a gap yet.
 */
import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  BookOpen,
  Check,
  GraduationCap,
  Loader2,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"

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

const RANK_RING = [
  "ring-2 ring-emerald-400 bg-emerald-500 text-white",
  "ring-2 ring-sky-400 bg-sky-500 text-white",
  "ring-2 ring-violet-400 bg-violet-500 text-white",
]
const BAR_COLOR = ["bg-emerald-400", "bg-sky-400", "bg-violet-400", "bg-slate-300"]

export default function SkillGapEngine() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  // Skills the user has claimed from this page. These are gaps, so the action
  // is "I actually have this" — a correction to the analysis, not an aspiration.
  // It appends to the résumé's top_skills, which is what the matcher scores on.
  const [claimed, setClaimed] = useState<Set<string>>(new Set())
  const [claiming, setClaiming] = useState<string | null>(null)
  const [claimError, setClaimError] = useState<string | null>(null)

  async function claimSkill(skill: string) {
    setClaiming(skill)
    setClaimError(null)
    try {
      const res = await fetch("/api/resume/skills/affirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: [skill] }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Failed (${res.status})`)
      }
      setClaimed((prev) => new Set(prev).add(skill))
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Could not save that skill.")
    } finally {
      setClaiming(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetch("/api/grow/skill-gap", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2.5 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-[14px]">Mapping your skills against live roles…</span>
        </div>
      </div>
    )
  }

  if (data?.needsResume) {
    return (
      <EmptyState
        icon={<BookOpen className="h-6 w-6" />}
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
        icon={<Target className="h-6 w-6" />}
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
        icon={<Sparkles className="h-6 w-6" />}
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
    <div className="space-y-5">

      {/* ── Hero recommendation ───────────────────────────────────────── */}
      {top.oneAway > 0 && (
        <div className="overflow-hidden rounded-xl border border-orange-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div>
            <div className="flex items-center gap-2 text-emerald-700">
              <Zap className="h-3.5 w-3.5 fill-emerald-500 stroke-none" />
              <p className="text-[11px] font-bold uppercase tracking-[0.2em]">Highest-leverage next skill</p>
            </div>
            <p className="mt-2 text-xl font-semibold leading-snug text-slate-950">
              Learn {top.skill} → unlock{" "}
              <span className="text-emerald-600">{top.oneAway} role{top.oneAway === 1 ? "" : "s"}</span>{" "}
              you&apos;re one skill away from
            </p>
            <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-slate-600">
              {top.skill} appears in {top.jobsRequiring.toLocaleString()} of your {data.targetJobs.toLocaleString()} target postings
              {top.medianSalary ? `, paying a median of ${k(top.medianSalary)}` : ""}
              {top.salaryUplift && top.salaryUplift > 2000 ? ` — ${k(top.salaryUplift)} above your target average` : ""}.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <a
                href={top.course.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-slate-800"
              >
                <GraduationCap className="h-4 w-4" />
                <span>{top.course.title}</span>
                <span className="opacity-70">·</span>
                <span className="opacity-80">{top.course.provider}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              {top.salaryUplift && top.salaryUplift > 2000 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 border border-emerald-200 px-3 py-1 text-[12px] font-semibold text-emerald-700">
                  <TrendingUp className="h-3.5 w-3.5" />
                  +{k(top.salaryUplift)} salary uplift
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Coverage stats ─────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={<Target className="h-4 w-4" />}
          iconClass="bg-slate-100 text-slate-600"
          value={data.targetJobs.toLocaleString()}
          label="Target postings"
        />
        <StatCard
          icon={<Sparkles className="h-4 w-4" />}
          iconClass="bg-emerald-100 text-emerald-600"
          value={data.eligibleNow.toLocaleString()}
          label="Already eligible"
          valueClass="text-emerald-600"
        />
        <StatCard
          icon={<Zap className="h-4 w-4" />}
          iconClass="bg-sky-100 text-sky-600"
          value={data.haveSkills.toLocaleString()}
          label="Your skills"
          valueClass="text-sky-600"
        />
      </div>

      {/* ── Gap list ───────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-100 px-5 py-3.5 flex items-center justify-between">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Skills ranked by what they unlock
          </p>
          <p className="text-[11px] text-slate-400">{data.gaps.length} gap{data.gaps.length !== 1 ? "s" : ""} found</p>
        </div>
        <ul className="divide-y divide-slate-100">
          {data.gaps.map((g, idx) => {
            const barCol = BAR_COLOR[Math.min(idx, BAR_COLOR.length - 1)]
            const ringStyle = RANK_RING[idx] ?? "bg-slate-100 text-slate-400"
            return (
              <li key={g.skill} className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-slate-50/70 sm:flex-row sm:items-center sm:gap-4">
                {/* Rank badge */}
                <div
                  className={cn(
                    "shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold",
                    ringStyle
                  )}
                >
                  {idx + 1}
                </div>

                {/* Main content */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <p className="truncate text-[14.5px] font-semibold text-slate-800">{g.skill}</p>
                    {g.oneAway > 0 && (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">
                        <Zap className="h-2.5 w-2.5" />
                        {g.oneAway} one away
                      </span>
                    )}
                    {g.salaryUplift && g.salaryUplift > 2000 && (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[10.5px] font-semibold text-sky-700">
                        <TrendingUp className="h-2.5 w-2.5" />
                        +{k(g.salaryUplift)}
                      </span>
                    )}
                  </div>

                  {/* Bar */}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500", barCol)}
                      style={{ width: `${(g.jobsRequiring / maxJobs) * 100}%` }}
                    />
                  </div>

                  <p className="mt-1 text-[11.5px] text-slate-400">
                    in {g.jobsRequiring.toLocaleString()} postings
                    {g.medianSalary ? ` · median ${k(g.medianSalary)}` : ""}
                  </p>

                  {/* Correct the analysis: claiming adds the skill to the résumé
                      the matcher scores against, so the feed re-ranks. */}
                  {claimed.has(g.skill) ? (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-700">
                      <Check className="h-3 w-3 shrink-0" aria-hidden />
                      Added to your resume — jobs needing {g.skill} will rank higher
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => claimSkill(g.skill)}
                      disabled={claiming === g.skill}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[11.5px] font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-60"
                    >
                      {claiming === g.skill ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        <Plus className="h-3 w-3 shrink-0" aria-hidden />
                      )}
                      I already have {g.skill}
                    </button>
                  )}
                </div>

                {/* Course link */}
                <a
                  href={g.course.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex shrink-0 flex-col items-start gap-0.5 sm:items-end"
                  title={`${g.course.title} on ${g.course.provider}`}
                >
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 shadow-xs transition group-hover:border-emerald-300 group-hover:bg-emerald-50 group-hover:text-emerald-700 group-hover:shadow-sm">
                    <GraduationCap className="h-3.5 w-3.5" />
                    Learn
                  </span>
                  <span className="text-[10px] text-slate-400 group-hover:text-slate-500">{g.course.provider}</span>
                </a>
              </li>
            )
          })}
        </ul>
        {claimError && (
          <p className="border-t border-slate-100 px-5 py-3 text-[12.5px] font-medium text-rose-700">
            {claimError}
          </p>
        )}
      </div>

      <p className="px-1 text-[11px] text-slate-400">
        Unlock counts reflect live postings for {data.targetRoles.slice(0, 2).join(" / ") || "your target roles"}. Course
        links may be affiliate links that support Hireoven at no cost to you.
      </p>
    </div>
  )
}

function StatCard({
  icon,
  iconClass,
  value,
  label,
  valueClass = "text-slate-900",
}: {
  icon: React.ReactNode
  iconClass: string
  value: string
  label: string
  valueClass?: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", iconClass)}>
        {icon}
      </div>
      <div>
        <p className={cn("text-[22px] font-bold tabular-nums leading-none", valueClass)}>{value}</p>
        <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      </div>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  icon: React.ReactNode
  title: string
  body: string
  ctaHref: string
  ctaLabel: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
        {icon}
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

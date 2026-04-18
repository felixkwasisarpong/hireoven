"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { BellRing, ExternalLink } from "lucide-react"
import { MatchScorePill } from "@/components/matching/MatchScorePill"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"
import { explainScore } from "@/lib/matching/score-explainer"
import { createClient } from "@/lib/supabase/client"
import type { JobWithMatchScore } from "@/types"

const SYSTEM_ALERT_NAME = "System: strong matches"

function BreakdownBar({
  label,
  value,
}: {
  label: string
  value: number | null | undefined
}) {
  const safeValue = Math.max(0, Math.min(100, value ?? 0))

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
        <span>{label}</span>
        <span className="tracking-normal text-slate-600">{safeValue}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[#FF5C18]"
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  )
}

export default function MatchesPage() {
  const { primaryResume } = useResumeContext()
  const [userId, setUserId] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(70)
  const [jobs, setJobs] = useState<JobWithMatchScore[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [notifyEnabled, setNotifyEnabled] = useState(false)
  const [isSavingNotify, setIsSavingNotify] = useState(false)

  useEffect(() => {
    let cancelled = false
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled) return
        setUserId(data.user?.id ?? null)
      })
      .catch((error) => {
        console.warn("Failed to load matches user", error)
        if (!cancelled) setUserId(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!primaryResume || primaryResume.parse_status !== "complete") {
      setJobs([])
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)

    fetch(`/api/match/feed?limit=120&within=7d&minScore=${threshold}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return []
        const payload = (await response.json()) as { jobs?: JobWithMatchScore[] }
        return payload.jobs ?? []
      })
      .then((data) => {
        if (cancelled) return
        setJobs(data)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [primaryResume, threshold])

  useEffect(() => {
    if (!userId) return

    let cancelled = false
    const supabase = createClient()

    ;(supabase
      .from("job_alerts")
      .select("id, is_active")
      .eq("user_id", userId)
      .eq("name", SYSTEM_ALERT_NAME)
      .limit(1)
      .maybeSingle() as any)
      .then(({ data }: { data: { is_active?: boolean } | null }) => {
        if (cancelled) return
        setNotifyEnabled(Boolean(data?.is_active))
      })

    return () => {
      cancelled = true
    }
  }, [userId])

  const grouped = useMemo(() => {
    const strong = jobs.filter((job) => (job.match_score?.overall_score ?? 0) >= 85)
    const good = jobs.filter((job) => {
      const score = job.match_score?.overall_score ?? 0
      return score >= 70 && score < 85
    })
    const potential = jobs.filter((job) => {
      const score = job.match_score?.overall_score ?? 0
      return score >= 60 && score < 70
    })

    return { strong, good, potential }
  }, [jobs])

  async function toggleNotifications(nextValue: boolean) {
    if (!userId) return

    setIsSavingNotify(true)
    const supabase = createClient()
    const { data: existing } = await ((supabase
      .from("job_alerts")
      .select("id")
      .eq("user_id", userId)
      .eq("name", SYSTEM_ALERT_NAME)
      .limit(1)
      .maybeSingle()) as any)

    if ((existing as { id?: string } | null)?.id) {
      await (supabase.from("job_alerts") as any)
        .update({ is_active: nextValue })
        .eq("id", (existing as { id: string }).id)
    } else if (nextValue) {
      await (supabase.from("job_alerts") as any).insert({
        user_id: userId,
        name: SYSTEM_ALERT_NAME,
        keywords: null,
        locations: null,
        seniority_levels: null,
        employment_types: null,
        remote_only: false,
        sponsorship_required: false,
        company_ids: null,
        is_active: true,
      })
    }

    setNotifyEnabled(nextValue)
    setIsSavingNotify(false)
  }

  if (!primaryResume || primaryResume.parse_status !== "complete") {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          kicker="Personalized matches"
          title="Upload a resume to unlock ranked matches"
          description="Once your primary resume is parsed, Hireoven will score the feed for you automatically."
        />

        <section className="rounded-[20px] border border-dashed border-slate-300 bg-white px-8 py-14 text-center">
          <p className="text-lg font-semibold text-slate-900">No resume available for matching</p>
          <p className="mt-2 text-sm text-slate-500">
            Upload a parsed primary resume first, then come back here for your ranked opportunities.
          </p>
          <Link
            href="/dashboard/resume"
            className="mt-5 inline-flex rounded-[14px] bg-[#FF5C18] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
          >
            Go to resume
          </Link>
        </section>
      </div>
    )
  }

  const totalStrongMatches = jobs.filter((job) => (job.match_score?.overall_score ?? 0) >= 70).length

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        kicker="Personalized matches"
        title={`${totalStrongMatches} strong matches for you`}
        description="Jobs where your resume scores 70% or higher, sorted by match quality and freshness."
        meta={
          <span className="rounded-full border border-[#FFD2B8] bg-[#FFF8F4] px-3 py-1.5 text-xs font-semibold text-[#9A3412]">
            Threshold {threshold}%+
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setThreshold(70)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                threshold === 70
                  ? "bg-[#FF5C18] text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              Strong only
            </button>
            <button
              type="button"
              onClick={() => setThreshold(60)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                threshold === 60
                  ? "bg-[#FF5C18] text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              Include 60%+
            </button>
          </div>
        }
      />

      <section className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Get notified when strong matches drop
            </p>
            <p className="mt-1 text-sm text-slate-500">
              We’ll keep watch for jobs scoring 70% or higher against your primary resume.
            </p>
          </div>

          <button
            type="button"
            disabled={isSavingNotify}
            onClick={() => void toggleNotifications(!notifyEnabled)}
            className={`inline-flex items-center gap-2 rounded-[14px] px-4 py-2.5 text-sm font-semibold transition ${
              notifyEnabled
                ? "bg-[#062246] text-white"
                : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300"
            }`}
          >
            <BellRing className="h-4 w-4" />
            {notifyEnabled ? "Alerts enabled" : "Alert me on new strong matches"}
          </button>
        </div>
      </section>

      {isLoading ? (
        <section className="rounded-[20px] border border-slate-200/80 bg-white p-6 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <div className="space-y-4">
            <div className="h-6 w-48 animate-pulse rounded-full bg-slate-100" />
            <div className="h-28 animate-pulse rounded-[18px] bg-slate-100" />
            <div className="h-28 animate-pulse rounded-[18px] bg-slate-100" />
          </div>
        </section>
      ) : jobs.length === 0 ? (
        <section className="rounded-[20px] border border-dashed border-slate-300 bg-white px-8 py-14 text-center">
          <p className="text-lg font-semibold text-slate-900">No strong matches yet</p>
          <p className="mt-2 text-sm text-slate-500">
            We’ll surface the moment a new role clears your current threshold.
          </p>
          {threshold > 60 && (
            <button
              type="button"
              onClick={() => setThreshold(60)}
              className="mt-5 inline-flex rounded-[14px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
            >
              Lower threshold to 60%
            </button>
          )}
        </section>
      ) : (
        <div className="space-y-6">
          {[
            { label: "Strong matches (85%+)", jobs: grouped.strong },
            { label: "Good matches (70-84%)", jobs: grouped.good },
            ...(threshold <= 60 ? [{ label: "Potential matches (60-69%)", jobs: grouped.potential }] : []),
          ]
            .filter((section) => section.jobs.length > 0)
            .map((section) => (
              <section key={section.label} className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {section.label}
                </h2>

                <div className="space-y-3">
                  {section.jobs.map((job) => {
                    const score = job.match_score
                    if (!score) return null

                    const explanation = explainScore(score, primaryResume, job)

                    return (
                      <article
                        key={job.id}
                        className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-3">
                              <h3 className="text-xl font-semibold text-slate-950">
                                {job.title}
                              </h3>
                              <MatchScorePill
                                score={score.overall_score}
                                method={score.score_method}
                                isLoading={false}
                                size="md"
                                showDisqualifiers
                                isSponsorshipCompatible={score.is_sponsorship_compatible}
                              />
                            </div>
                            <p className="mt-1 text-sm text-slate-500">
                              {job.company.name}
                              {job.location ? ` · ${job.location}` : ""}
                            </p>
                            <p className="mt-3 text-sm leading-6 text-slate-600">
                              {explanation.headline}
                            </p>
                          </div>

                          <Link
                            href={job.apply_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-[14px] bg-[#FF5C18] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
                          >
                            Apply
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </div>

                        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                          <div className="space-y-3 rounded-[18px] border border-slate-200/70 bg-slate-50/70 p-4">
                            <BreakdownBar label="Skills" value={score.skills_score} />
                            <BreakdownBar label="Seniority" value={score.seniority_score} />
                            <BreakdownBar label="Location" value={score.location_score} />
                            <BreakdownBar
                              label="Sponsorship"
                              value={score.sponsorship_score}
                            />
                          </div>

                          <div className="rounded-[18px] border border-slate-200/70 bg-white p-4">
                            {explanation.strengths.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                  Strengths
                                </p>
                                <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
                                  {explanation.strengths.map((item) => (
                                    <li key={item}>• {item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {explanation.concerns.length > 0 && (
                              <div className="mt-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                  Watchouts
                                </p>
                                <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
                                  {explanation.concerns.map((item) => (
                                    <li key={item}>• {item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {explanation.sponsorship_note && (
                              <p className="mt-4 rounded-[14px] border border-[#FFD2B8] bg-[#FFF8F4] px-3 py-2 text-sm text-[#9A3412]">
                                {explanation.sponsorship_note}
                              </p>
                            )}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  )
}

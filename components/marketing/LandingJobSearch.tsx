"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Search, MapPin, ShieldCheck, Sparkles } from "lucide-react"
import {
  mapApiJobToLandingJob,
  type ApiJob,
  type LandingJob,
  type Sponsorship,
} from "@/lib/jobs/landing-search-types"

const APP_ORIGIN = "" // same-origin fetch

function SponsorshipBadge({ kind, petitions }: { kind: Sponsorship; petitions: number | null }) {
  if (kind === "filed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        <ShieldCheck className="h-3 w-3" />
        {petitions && petitions > 0 ? `${petitions.toLocaleString()} H-1B petitions on file` : "Sponsorship on file"}
      </span>
    )
  }
  if (kind === "likely") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
        <Sparkles className="h-3 w-3" />
        Visa language detected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
      No filings found
    </span>
  )
}

function Logo({ name, url }: { name: string | null; url: string | null }) {
  const [broken, setBroken] = useState(false)
  const letter = (name?.trim()?.[0] ?? "?").toUpperCase()
  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt=""
        width={40}
        height={40}
        onError={() => setBroken(true)}
        className="h-10 w-10 shrink-0 rounded-xl border border-slate-200/70 bg-white object-contain"
      />
    )
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-[15px] font-bold text-slate-400">
      {letter}
    </div>
  )
}

function JobCard({ job }: { job: LandingJob }) {
  return (
    <a
      href={`/jobs/${job.id}`}
      className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left transition hover:border-emerald-200 hover:shadow-sm"
    >
      <Logo name={job.company} url={job.companyLogoUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-900">{job.title}</p>
          {job.fresh && <span className="shrink-0 text-[12px] text-slate-400">{job.fresh}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
          {job.company && <span className="truncate font-medium text-slate-600">{job.company}</span>}
          {(job.isRemote || job.location) && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {job.isRemote ? "Remote" : job.location}
            </span>
          )}
          {job.salaryLabel && <span className="font-medium text-slate-600">{job.salaryLabel}</span>}
        </div>
        <div className="mt-2">
          <SponsorshipBadge kind={job.sponsorship} petitions={job.petitions1yr} />
        </div>
      </div>
    </a>
  )
}

export default function LandingJobSearch({
  defaultQuery,
  initialJobs,
}: {
  defaultQuery: string
  initialJobs: LandingJob[]
}) {
  const [query, setQuery] = useState(defaultQuery)
  const [jobs, setJobs] = useState<LandingJob[]>(initialJobs)
  const [loading, setLoading] = useState(false)
  const [touched, setTouched] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async (q: string) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    try {
      const res = await fetch(`${APP_ORIGIN}/api/jobs?q=${encodeURIComponent(q)}&limit=8`, {
        signal: ac.signal,
      })
      if (!res.ok) throw new Error(`search failed (${res.status})`)
      const data = (await res.json()) as { jobs?: ApiJob[] }
      setJobs((data.jobs ?? []).map(mapApiJobToLandingJob))
    } catch (err) {
      if ((err as Error).name !== "AbortError") setJobs([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced live search once the visitor starts typing. The initial default
  // results are server-rendered, so we don't fetch on mount.
  useEffect(() => {
    if (!touched) return
    const t = setTimeout(() => run(query), 280)
    return () => clearTimeout(t)
  }, [query, touched, run])

  // Fallback: if the server render produced no results (e.g. a build without DB
  // access), fetch the default query once on mount so the box is never stuck empty.
  useEffect(() => {
    if (initialJobs.length === 0) run(defaultQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          run(query)
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setTouched(true)
            setQuery(e.target.value)
          }}
          placeholder="Try 'software engineer' or 'data analyst'"
          aria-label="Search jobs"
          className="w-full rounded-2xl border border-slate-300 bg-white py-4 pl-12 pr-28 text-[16px] text-slate-900 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
        />
        <button
          type="submit"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
        >
          Search
        </button>
      </form>

      {/* Trust row — the spec's three lines, including the honest limit. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Public DOL &amp; USCIS data
        </span>
        <span>·</span>
        <span>Free, no credit card</span>
        <span>·</span>
        <span>Historical signals, not guarantees</span>
      </div>

      <div className="mt-5 min-h-[120px] space-y-2">
        {loading && jobs.length === 0 ? (
          <div className="py-8 text-center text-[14px] text-slate-400">Searching…</div>
        ) : jobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-[14px] text-slate-500">
            No live roles match that yet — try a broader title.
          </div>
        ) : (
          <>
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
            <div className="pt-2 text-center">
              <a
                href={`/signup?next=${encodeURIComponent("/dashboard")}`}
                className="text-[13px] font-semibold text-emerald-700 underline-offset-2 hover:underline"
              >
                Save this search &amp; get alerts — free →
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

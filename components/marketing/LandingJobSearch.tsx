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
      <span className="inline-flex items-center gap-1 border border-[#38e08a]/25 bg-[#38e08a]/12 px-2 py-0.5 text-[11px] font-semibold text-[#38e08a]">
        <ShieldCheck className="h-3 w-3" />
        {petitions && petitions > 0 ? `${petitions.toLocaleString()} H-1B petitions on file` : "Sponsorship on file"}
      </span>
    )
  }
  if (kind === "likely") {
    return (
      <span className="inline-flex items-center gap-1 border border-[#f5a623]/25 bg-[#f5a623]/12 px-2 py-0.5 text-[11px] font-semibold text-[#f5a623]">
        <Sparkles className="h-3 w-3" />
        Visa language detected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-2 py-0.5 text-[11px] font-medium text-[#ccd6cf]/55">
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
        className="h-10 w-10 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] object-contain"
      />
    )
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[15px] font-bold text-[#ccd6cf]/45">
      {letter}
    </div>
  )
}

function JobCard({ job }: { job: LandingJob }) {
  return (
    <a
      href={`/jobs/${job.id}`}
      className="term-panel-hover flex items-start gap-3 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-4 py-3.5 text-left"
    >
      <Logo name={job.company} url={job.companyLogoUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">{job.title}</p>
          {job.fresh && <span className="shrink-0 text-[12px] text-[#ccd6cf]/45">{job.fresh}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[#ccd6cf]/55">
          {job.company && <span className="truncate font-medium text-[#ccd6cf]/80">{job.company}</span>}
          {(job.isRemote || job.location) && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {job.isRemote ? "Remote" : job.location}
            </span>
          )}
          {job.salaryLabel && <span className="font-medium text-[#ccd6cf]/80">{job.salaryLabel}</span>}
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
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#ccd6cf]/45" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setTouched(true)
            setQuery(e.target.value)
          }}
          placeholder="Try 'software engineer' or 'data analyst'"
          aria-label="Search jobs"
          className="w-full border border-[rgba(120,200,160,0.26)] bg-[#0a0e0c] py-4 pl-12 pr-28 text-[16px] text-[#ccd6cf] outline-none transition placeholder:text-[#ccd6cf]/40 focus:border-[#38e08a]"
        />
        <button
          type="submit"
          className="term-btn term-btn-amber absolute right-2 top-1/2 -translate-y-1/2 justify-center px-5 py-2.5"
        >
          Search
        </button>
      </form>

      {/* Trust row — the spec's three lines, including the honest limit. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[#ccd6cf]/55">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5 text-[#f5a623]" /> Public DOL &amp; USCIS data
        </span>
        <span>·</span>
        <span>Free, no credit card</span>
        <span>·</span>
        <span>Historical signals, not guarantees</span>
      </div>

      <div className="mt-5 min-h-[120px] space-y-2">
        {loading && jobs.length === 0 ? (
          <div className="py-8 text-center text-[14px] text-[#ccd6cf]/45">Searching…</div>
        ) : jobs.length === 0 ? (
          <div className="border border-dashed border-[rgba(120,200,160,0.2)] py-8 text-center text-[14px] text-[#ccd6cf]/55">
            No live roles match that yet — try a broader title.
          </div>
        ) : (
          <>
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
            <div className="pt-2 text-center">
              <a
                href={`/signup?next=${encodeURIComponent("/dashboard/onboarding")}`}
                className="text-[13px] font-semibold text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]"
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

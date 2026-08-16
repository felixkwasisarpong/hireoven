"use client"

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from "lucide-react"
import { ApplyAgentFlow } from "@/components/apex/ApplyAgentFlow"
import type { ApplyAgentJob } from "@/lib/apex/apply-agent/types"
import { cn } from "@/lib/utils"

type Classification =
  | "ats_board"
  | "branded_site_resolved_to_ats"
  | "branded_site_recorded"
  | "unsupported_or_blocked_site"

type SponsorshipTone = "sponsors" | "strong" | "moderate" | "limited" | "unknown"

type ScoutJob = ApplyAgentJob & {
  sponsorshipTone?: SponsorshipTone
  matchedSkills: string[]
  missingSkills: string[]
  alreadyTracked: boolean
}

type ScoutResponse = {
  source: {
    submittedUrl: string
    scannedUrl: string | null
    classification: Classification
    companyId: string | null
    companyName: string | null
    domain: string | null
    atsType: string | null
    atsIdentifier: string | null
    directAtsUrl: string | null
    harvestQueued: boolean
    outcomeReason: string | null
  }
  jobs: ScoutJob[]
}

const CLASSIFICATION_LABELS: Record<Classification, string> = {
  ats_board: "ATS board",
  branded_site_resolved_to_ats: "Career Site / ATS",
  branded_site_recorded: "Career Site",
  unsupported_or_blocked_site: "Needs crawler",
}

/** Scan stages, shown in order while the POST is in flight. */
const STAGES = ["Career site scanned", "ATS detected", "Discovering open roles"] as const

function defaultSelection(jobs: ScoutJob[]) {
  const strong = jobs
    .filter((job) => !job.alreadyTracked && (job.matchScore ?? 0) >= 70)
    .slice(0, 5)
  const fallback = jobs.filter((job) => !job.alreadyTracked).slice(0, 3)
  return new Set((strong.length > 0 ? strong : fallback).map((job) => job.jobId))
}

/**
 * Match colour ramp. Every value clears 4.5:1 on white so the score stays
 * readable, and the bar reuses the same hue as its number.
 */
function matchTone(score: number | null) {
  if (score == null) return { text: "text-slate-500", bar: "bg-slate-400" }
  if (score >= 90) return { text: "text-teal-700", bar: "bg-teal-600" }
  if (score >= 70) return { text: "text-blue-700", bar: "bg-blue-600" }
  if (score >= 55) return { text: "text-amber-700", bar: "bg-amber-500" }
  return { text: "text-slate-500", bar: "bg-slate-400" }
}

/**
 * Sponsorship pill colours, keyed off the semantic tone the API returns rather
 * than substring-matching the label. Every pairing clears 4.5:1.
 */
const SPONSORSHIP_TONE: Record<SponsorshipTone, string> = {
  sponsors: "border-emerald-200 bg-emerald-50 text-emerald-700",
  strong:   "border-cyan-200 bg-cyan-50 text-cyan-800",
  moderate: "border-amber-200 bg-amber-50 text-amber-800",
  limited:  "border-slate-200 bg-slate-100 text-slate-600",
  unknown:  "border-slate-200 bg-white text-slate-500",
}

function companyInitial(name: string | null) {
  return (name?.trim()?.[0] ?? "?").toUpperCase()
}

export function CareerSiteScoutPageClient() {
  const searchParams = useSearchParams()
  const initialUrl = searchParams.get("url")?.trim() ?? ""
  const autoScannedUrlRef = useRef<string | null>(null)
  const [url, setUrl] = useState("")
  const [autoFilled, setAutoFilled] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [stage, setStage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScoutResponse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applyJobs, setApplyJobs] = useState<ApplyAgentJob[] | null>(null)

  const selectedJobs = useMemo(
    () => (result ? result.jobs.filter((job) => selected.has(job.jobId)) : []),
    [result, selected],
  )

  // Advance the visible stage while the request is in flight. The labels are
  // the real steps the scan performs; the detail text on each row is filled
  // from the response, never invented.
  useEffect(() => {
    if (!isLoading) return
    const timers = [
      setTimeout(() => setStage(1), 900),
      setTimeout(() => setStage(2), 2100),
    ]
    return () => timers.forEach(clearTimeout)
  }, [isLoading])

  const scanUrl = useCallback(async (rawUrl: string, fromApex = false) => {
    const trimmedUrl = rawUrl.trim()
    if (!trimmedUrl || isLoading) return

    setUrl(trimmedUrl)
    setAutoFilled(fromApex)
    setIsLoading(true)
    setStage(0)
    setError(null)
    setResult(null)
    setApplyJobs(null)
    try {
      const response = await fetch("/api/apex/career-site-scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? "Career site scan failed")
      const scout = data as ScoutResponse
      setResult(scout)
      setSelected(defaultSelection(scout.jobs))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Career site scan failed")
    } finally {
      setIsLoading(false)
    }
  }, [isLoading])

  useEffect(() => {
    if (!initialUrl || autoScannedUrlRef.current === initialUrl) return
    autoScannedUrlRef.current = initialUrl
    void scanUrl(initialUrl, true)
  }, [initialUrl, scanUrl])

  function scan(event: FormEvent) {
    event.preventDefault()
    void scanUrl(url)
  }

  function toggleJob(jobId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  function continueWithSelected() {
    if (selectedJobs.length === 0) return
    setApplyJobs(
      selectedJobs.map(({ matchedSkills, missingSkills, alreadyTracked, ...job }) => job),
    )
  }

  // ── Handoff: resume tailoring and application live in the apply agent ──
  if (applyJobs) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Site Scout</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">Application Queue</h1>
          </div>
          <button
            type="button"
            onClick={() => setApplyJobs(null)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Back to results
          </button>
        </div>
        <ApplyAgentFlow
          initialJobs={applyJobs}
          requireSponsorshipSignal={false}
          onDone={() => setApplyJobs(null)}
        />
      </div>
    )
  }

  const stageDetail = [
    result?.source.scannedUrl ? "complete" : isLoading ? "" : "complete",
    result?.source.atsType ?? (isLoading ? "" : "not detected"),
    result ? `${result.jobs.length} found` : "in progress",
  ]

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-950">Career Site Scout</h1>
      </div>

      {/* ── URL bar ── */}
      <form onSubmit={scan}>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Career page URL
        </p>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <label className="sr-only" htmlFor="career-site-url">Career site URL</label>
            <input
              id="career-site-url"
              value={url}
              onChange={(event) => { setUrl(event.target.value); setAutoFilled(false) }}
              placeholder="https://company.com/careers"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-4 pr-36 text-[15px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500"
            />
            {autoFilled ? (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">
                Auto-filled from Apex
              </span>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={isLoading || !url.trim()}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-[14px] font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {isLoading ? "Scanning…" : "Scan site"}
          </button>
        </div>

        {/* Indeterminate progress rail under the field while scanning */}
        {isLoading ? (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-full w-1/3 animate-[scout-rail_1.1s_ease-in-out_infinite] rounded-full bg-blue-600" />
          </div>
        ) : null}
      </form>

      <style>{`@keyframes scout-rail{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>

      {/* ── Stage checklist ── */}
      {(isLoading || result) && !error ? (
        <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
          {STAGES.map((label, index) => {
            const done = result ? true : index < stage
            const active = !result && index === stage
            return (
              <div key={label} className="flex items-center gap-3 px-5 py-3.5">
                {done ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-teal-600" aria-hidden />
                ) : active ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-500" aria-hidden />
                ) : (
                  <span className="h-5 w-5 shrink-0 rounded-full border-2 border-slate-200" aria-hidden />
                )}
                <span className={cn("flex-1 text-[14.5px]", done || active ? "text-slate-900" : "text-slate-400")}>
                  {label}{active ? "…" : ""}
                </span>
                <span className="text-[13px] text-slate-400">{stageDetail[index]}</span>
              </div>
            )
          })}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {/* ── Skeleton while roles load ── */}
      {isLoading ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Open roles</p>
          <div className="mt-4 space-y-5">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-4">
                <span className="h-5 w-5 shrink-0 rounded bg-slate-100" />
                <div className="flex-1 space-y-2">
                  <span className="block h-3 rounded bg-slate-100" style={{ width: `${52 - row * 8}%` }} />
                  <span className="block h-2.5 w-1/4 rounded bg-slate-100" />
                </div>
                <span className="h-3 w-24 shrink-0 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Results ── */}
      {result && !isLoading ? (
        <div className="mt-4 space-y-4">
          {/* Source header */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[15px] font-bold text-white">
              {companyInitial(result.source.companyName)}
            </span>
            <span className="text-[15px] font-semibold text-slate-950">
              {result.source.companyName ?? "Unknown company"}
            </span>
            <span className="text-[13px] text-slate-500">
              · {CLASSIFICATION_LABELS[result.source.classification]}
              {result.source.atsType ? ` · ${result.source.atsType}` : ""}
            </span>
            <span className="ml-auto flex items-center gap-3">
              {result.source.domain ? (
                <span className="hidden text-[13px] text-slate-400 sm:inline">{result.source.domain}</span>
              ) : null}
              {result.source.harvestQueued ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Harvest queued
                </span>
              ) : null}
            </span>
          </div>

          {result.jobs.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
              No open roles came back from this scan. The source was recorded for the crawler.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-2 px-1">
                <span className="text-[15px] font-semibold text-slate-950">
                  {result.jobs.length} role{result.jobs.length === 1 ? "" : "s"} found
                </span>
                <span className="text-[13px] text-slate-500">· ranked by match to your profile</span>
              </div>

              <div className="space-y-3">
                {result.jobs.map((job) => {
                  const checked = selected.has(job.jobId)
                  const tone = matchTone(job.matchScore)
                  const sponsClass = SPONSORSHIP_TONE[job.sponsorshipTone ?? "unknown"]
                  return (
                    <div
                      key={job.jobId}
                      className={cn(
                        "rounded-xl border bg-white px-5 py-4 shadow-sm transition",
                        checked ? "border-blue-600 ring-1 ring-blue-600" : "border-slate-200",
                        job.alreadyTracked && "opacity-60",
                      )}
                    >
                      <div className="flex gap-4">
                        <button
                          type="button"
                          onClick={() => toggleJob(job.jobId)}
                          disabled={job.alreadyTracked}
                          aria-label={checked ? `Deselect ${job.jobTitle}` : `Select ${job.jobTitle}`}
                          aria-pressed={checked}
                          className={cn(
                            "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition",
                            checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white",
                            job.alreadyTracked && "cursor-not-allowed",
                          )}
                        >
                          {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : null}
                        </button>

                        <div className="min-w-0 flex-1">
                          <h2 className="text-[15.5px] font-semibold text-slate-950">{job.jobTitle}</h2>
                          <p className="mt-0.5 text-[13.5px] text-slate-500">
                            {[job.location, job.company].filter(Boolean).join(" · ") || "Location not stated"}
                          </p>

                          {job.matchedSkills.length > 0 || job.missingSkills.length > 0 ? (
                            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                              {job.matchedSkills.length > 0 ? (
                                <>
                                  <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
                                    Matched
                                  </span>
                                  {job.matchedSkills.slice(0, 4).map((skill) => (
                                    <span
                                      key={`m-${job.jobId}-${skill}`}
                                      className="rounded-md bg-blue-50 px-2 py-0.5 text-[12px] font-medium text-blue-700"
                                    >
                                      {skill}
                                    </span>
                                  ))}
                                </>
                              ) : null}
                              {job.missingSkills.length > 0 ? (
                                <>
                                  <span className="ml-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
                                    Missing
                                  </span>
                                  {job.missingSkills.slice(0, 3).map((skill) => (
                                    <span
                                      key={`x-${job.jobId}-${skill}`}
                                      className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-600"
                                    >
                                      {skill}
                                    </span>
                                  ))}
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        {/* Right rail: sponsorship signal over the match score */}
                        <div className="flex w-[132px] shrink-0 flex-col items-end gap-2">
                          {job.sponsorshipSignal ? (
                            <span className={cn("rounded-md border px-2 py-1 text-[11.5px] font-semibold", sponsClass)}>
                              {job.sponsorshipSignal}
                            </span>
                          ) : null}
                          {job.alreadyTracked ? (
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11.5px] font-medium text-slate-500">
                              Tracked
                            </span>
                          ) : null}
                          <div className="w-full">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
                                Match
                              </span>
                              <span className={cn("text-[26px] font-bold leading-none tabular-nums", tone.text)}>
                                {job.matchScore ?? "—"}
                              </span>
                            </div>
                            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-200">
                              <div
                                className={cn("h-full rounded-full", tone.bar)}
                                style={{ width: `${Math.max(0, Math.min(100, job.matchScore ?? 0))}%` }}
                              />
                            </div>
                          </div>
                          {job.applyUrl ? (
                            <a
                              href={job.applyUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-400 transition hover:text-slate-700"
                            >
                              Open <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Footer action bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-[13.5px] text-slate-500">
                  <span className="font-semibold text-slate-900">
                    {selectedJobs.length} of {result.jobs.length} role{result.jobs.length === 1 ? "" : "s"} selected
                  </span>
                  {" · source recorded for every role"}
                </p>
                <button
                  type="button"
                  onClick={continueWithSelected}
                  disabled={selectedJobs.length === 0}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 text-[15px] font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

"use client"

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  Search,
  Server,
} from "lucide-react"
import { ApplyAgentFlow } from "@/components/apex/ApplyAgentFlow"
import type { ApplyAgentJob } from "@/lib/apex/apply-agent/types"
import { cn } from "@/lib/utils"

type Classification =
  | "ats_board"
  | "branded_site_resolved_to_ats"
  | "branded_site_recorded"
  | "unsupported_or_blocked_site"

type ScoutJob = ApplyAgentJob & {
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
  branded_site_resolved_to_ats: "Resolved ATS",
  branded_site_recorded: "Source recorded",
  unsupported_or_blocked_site: "Needs crawler",
}

function scoreTone(score: number | null) {
  if (score == null) return "border-slate-200 bg-slate-50 text-slate-600"
  if (score >= 85) return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (score >= 70) return "border-blue-200 bg-blue-50 text-blue-700"
  if (score >= 55) return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-slate-200 bg-slate-50 text-slate-600"
}

function defaultSelection(jobs: ScoutJob[]) {
  const strong = jobs
    .filter((job) => !job.alreadyTracked && (job.matchScore ?? 0) >= 70)
    .slice(0, 5)
  const fallback = jobs.filter((job) => !job.alreadyTracked).slice(0, 3)
  return new Set((strong.length > 0 ? strong : fallback).map((job) => job.jobId))
}

export function CareerSiteScoutPageClient() {
  const searchParams = useSearchParams()
  const initialUrl = searchParams.get("url")?.trim() ?? ""
  const autoScannedUrlRef = useRef<string | null>(null)
  const [url, setUrl] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScoutResponse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applyJobs, setApplyJobs] = useState<ApplyAgentJob[] | null>(null)

  const selectedJobs = useMemo(() => {
    if (!result) return []
    return result.jobs.filter((job) => selected.has(job.jobId))
  }, [result, selected])

  const scanUrl = useCallback(async (rawUrl: string) => {
    const trimmedUrl = rawUrl.trim()
    if (!trimmedUrl || isLoading) return

    setUrl(trimmedUrl)
    setIsLoading(true)
    setError(null)
    setApplyJobs(null)
    try {
      const response = await fetch("/api/apex/career-site-scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error ?? "Career site scan failed")
      }
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
    void scanUrl(initialUrl)
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
    setApplyJobs(selectedJobs.map(({ matchedSkills, missingSkills, alreadyTracked, ...job }) => job))
  }

  if (applyJobs) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Site Scout</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">Application Queue</h1>
          </div>
          <button
            type="button"
            onClick={() => setApplyJobs(null)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
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

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Apex</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Career Site Scout</h1>
        </div>
        {result?.source.harvestQueued ? (
          <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            <Server className="h-4 w-4" aria-hidden />
            Harvest queued
          </div>
        ) : null}
      </div>

      <form onSubmit={scan} className="flex flex-col gap-3 border-y border-slate-200 bg-white py-4 md:flex-row">
        <label className="sr-only" htmlFor="career-site-url">Career site URL</label>
        <input
          id="career-site-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://company.com/careers"
          className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3 text-sm outline-none ring-0 transition focus:border-slate-900"
        />
        <button
          type="submit"
          disabled={isLoading || !url.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
          Scan Site
        </button>
      </form>

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {result ? (
        <div className="mt-6 space-y-5">
          <div className="grid gap-3 border-b border-slate-200 pb-5 md:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Company</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{result.source.companyName ?? "Unknown"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Source</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">
                {CLASSIFICATION_LABELS[result.source.classification]}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">ATS</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">
                {result.source.atsType ?? "Custom"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Jobs</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{result.jobs.length}</p>
            </div>
          </div>

          {result.jobs.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
              No open jobs were returned from this scan. The source was recorded for the crawler.
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{selectedJobs.length} selected</p>
                  <p className="text-xs text-slate-500">Selected jobs enter resume tailoring before application handoff.</p>
                </div>
                <button
                  type="button"
                  onClick={continueWithSelected}
                  disabled={selectedJobs.length === 0}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <div className="divide-y divide-slate-200 border-y border-slate-200">
                {result.jobs.map((job) => {
                  const checked = selected.has(job.jobId)
                  return (
                    <div key={job.jobId} className="grid gap-3 py-4 md:grid-cols-[32px_minmax(0,1fr)_auto] md:items-start">
                      <button
                        type="button"
                        onClick={() => toggleJob(job.jobId)}
                        disabled={job.alreadyTracked}
                        className={cn(
                          "mt-1 flex h-6 w-6 items-center justify-center rounded border text-white transition",
                          checked ? "border-blue-600 bg-blue-600" : "border-slate-300 bg-white",
                          job.alreadyTracked && "cursor-not-allowed opacity-40",
                        )}
                        aria-label={checked ? "Deselect job" : "Select job"}
                      >
                        {checked ? <Check className="h-4 w-4" aria-hidden /> : null}
                      </button>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-semibold text-slate-950">{job.jobTitle}</h2>
                          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", scoreTone(job.matchScore))}>
                            {job.matchScore == null ? "Unscored" : `${job.matchScore}%`}
                          </span>
                          {job.alreadyTracked ? (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
                              Tracked
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                          {[job.company, job.location, job.sponsorshipSignal].filter(Boolean).join(" | ")}
                        </p>
                        {job.matchedSkills.length > 0 || job.missingSkills.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {job.matchedSkills.slice(0, 4).map((skill) => (
                              <span key={`m-${job.jobId}-${skill}`} className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                                {skill}
                              </span>
                            ))}
                            {job.missingSkills.slice(0, 3).map((skill) => (
                              <span key={`x-${job.jobId}-${skill}`} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                                {skill}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {job.applyUrl ? (
                        <a
                          href={job.applyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                          aria-label="Open job"
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden />
                        </a>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

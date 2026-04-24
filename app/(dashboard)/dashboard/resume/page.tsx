"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { FileText, Loader2, Sparkles, Trash2 } from "lucide-react"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"
import ParsedResumeView from "@/components/resume/ParsedResumeView"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import ResumeScoreCard from "@/components/resume/ResumeScoreCard"
import ResumeUploader from "@/components/resume/ResumeUploader"
import { useToast } from "@/components/ui/ToastProvider"
import { cn } from "@/lib/utils"
import type { Resume } from "@/types"

function scoreTone(score: number | null) {
  const value = score ?? 0
  if (value >= 71) return "text-emerald-600 border-emerald-200 bg-emerald-50"
  if (value >= 41) return "text-amber-600 border-amber-200 bg-amber-50"
  return "text-red-600 border-red-200 bg-red-50"
}

function ProcessingResumeCard({ resume }: { resume: Resume }) {
  return (
    <div className="surface-card p-6">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFF1E8] text-[#062246]">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
        <div>
          <p className="text-lg font-semibold text-gray-900">
            {resume.name ?? resume.file_name}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            AI is reading your resume and turning it into structured data.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <div className="h-24 animate-pulse rounded-3xl bg-gray-100" />
        <div className="h-16 animate-pulse rounded-3xl bg-gray-100" />
        <div className="h-40 animate-pulse rounded-3xl bg-gray-100" />
      </div>
    </div>
  )
}

function FailedResumeCard({
  resume,
  onReplace,
}: {
  resume: Resume
  onReplace: () => void
}) {
  return (
    <div className="surface-card border-red-200 p-6">
      <p className="text-lg font-semibold text-gray-900">{resume.name ?? resume.file_name}</p>
      <p className="mt-2 text-sm leading-6 text-gray-600">
        Hireoven could not finish parsing this file. Try replacing it with a cleaner PDF or DOCX export.
      </p>
      <button
        type="button"
        onClick={onReplace}
        className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[#FF5C18] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
      >
        Replace resume
      </button>
    </div>
  )
}

export default function ResumePage() {
  const {
    resumes,
    primaryResume,
    hasResume,
    isLoading,
    refresh,
    upsertResume,
    removeResume,
  } = useResumeContext()
  const { pushToast } = useToast()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [analysisMeta, setAnalysisMeta] = useState<
    Record<string, { improvements: number; jobId: string | null; jobTitle: string | null }>
  >({})

  useEffect(() => {
    if (resumes.length === 0) {
      setAnalysisMeta({})
      return
    }

    async function loadAnalysisMeta() {
      const resumeIds = resumes.map((resume) => resume.id)
      const qs = new URLSearchParams({ resume_ids: resumeIds.join(",") })
      const res = await fetch(`/api/resume/analyses?${qs}`, {
        credentials: "include",
        cache: "no-store",
      })
      if (!res.ok) {
        setAnalysisMeta({})
        return
      }
      const body = (await res.json()) as {
        analyses?: Array<{
          resume_id: string
          job_id: string | null
          recommendations: Array<unknown> | null
          created_at: string
          job_title: string | null
        }>
      }
      const analyses = body.analyses ?? []

      const latestByResume = new Map<
        string,
        { jobId: string | null; improvements: number; jobTitle: string | null }
      >()

      for (const analysis of analyses) {
        if (latestByResume.has(analysis.resume_id)) continue
        latestByResume.set(analysis.resume_id, {
          jobId: analysis.job_id,
          improvements: analysis.recommendations?.length ?? 0,
          jobTitle: analysis.job_title,
        })
      }

      const next: Record<
        string,
        { improvements: number; jobId: string | null; jobTitle: string | null }
      > = {}
      latestByResume.forEach((value, resumeId) => {
        next[resumeId] = {
          improvements: value.improvements,
          jobId: value.jobId,
          jobTitle: value.jobTitle ?? null,
        }
      })

      setAnalysisMeta(next)
    }

    void loadAnalysisMeta()
  }, [resumes])

  useEffect(() => {
    if (!expandedId && resumes[0]) {
      setExpandedId(resumes[0].id)
    }
  }, [expandedId, resumes])

  async function handleDelete(resume: Resume) {
    if (!window.confirm(`Delete ${resume.name ?? resume.file_name}?`)) return

    setPendingActionId(resume.id)
    const response = await fetch(`/api/resume/${resume.id}`, {
      method: "DELETE",
    })
    setPendingActionId(null)

    if (!response.ok) {
      pushToast({
        tone: "error",
        title: "Could not delete resume",
        description: "Please try again.",
      })
      return
    }

    removeResume(resume.id)
    await refresh()
    pushToast({
      tone: "success",
      title: "Resume deleted",
      description: "Your uploaded resume was removed.",
    })
  }

  async function handleSetPrimary(resume: Resume) {
    setPendingActionId(resume.id)
    const response = await fetch(`/api/resume/${resume.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_primary: true }),
    })
    setPendingActionId(null)

    if (!response.ok) {
      pushToast({
        tone: "error",
        title: "Could not set primary resume",
      })
      return
    }

    await refresh()
    pushToast({
      tone: "success",
      title: "Primary resume updated",
      description: `${resume.name ?? resume.file_name} is now your default resume.`,
    })
  }

  async function handleSaveName(resume: Resume) {
    const nextName = nameDrafts[resume.id] ?? resume.name ?? ""
    setPendingActionId(resume.id)
    const response = await fetch(`/api/resume/${resume.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nextName }),
    })
    setPendingActionId(null)

    if (!response.ok) {
      pushToast({
        tone: "error",
        title: "Could not save resume name",
      })
      return
    }

    const updated = (await response.json()) as Resume
    upsertResume(updated)
    pushToast({
      tone: "success",
      title: "Resume name saved",
    })
  }

  async function handleDownload(resume: Resume) {
    const response = await fetch(`/api/resume/${resume.id}`, { cache: "no-store" })
    if (!response.ok) {
      pushToast({
        tone: "error",
        title: "Could not prepare download",
      })
      return
    }

    const data = (await response.json()) as Resume & { download_url?: string }
    window.open(data.download_url ?? data.file_url, "_blank", "noopener,noreferrer")
  }

  return (
    <main className="app-page">
      <div className="app-shell max-w-[1320px] space-y-6">
        <DashboardPageHeader
          kicker="Resume intelligence"
          title="Turn your resume into structured data Hireoven can work with"
          description="Upload up to three resume variants, let AI parse them into a usable profile, and unlock faster job triage across the rest of the product."
          backHref="/dashboard"
          backLabel="Back to dashboard"
          meta={
            <div className="rounded-full border border-slate-200 bg-slate-50/85 px-3 py-1.5 text-sm font-medium text-[#062246]">
              {resumes.length}/3 resumes uploaded
            </div>
          }
        />

        {(resumes.length < 3 || !hasResume) && (
          <section id="resume-upload">
            <ResumeUploader
              onUploadComplete={(resume) => {
                upsertResume(resume)
                setExpandedId(resume.id)
              }}
              showPrompt={!hasResume}
            />
          </section>
        )}

        {!isLoading && !hasResume && (
          <section className="surface-card py-10 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-[#FFF1E8] text-[#062246]">
              <Sparkles className="h-7 w-7" />
            </div>
            <h2 className="mt-5 text-2xl font-semibold text-gray-900">
              Upload your resume to unlock the rest of Hireoven
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-gray-500">
              The moment you upload, Hireoven starts scoring resume quality, extracting your experience, and preparing match scoring for every job you view next.
            </p>
          </section>
        )}

        {isLoading && (
          <div className="space-y-4">
            <div className="surface-card h-44 animate-pulse" />
            <div className="surface-card h-96 animate-pulse" />
          </div>
        )}

        {!isLoading && resumes.length > 0 && (
          <div className="space-y-5">
            {resumes.map((resume) => {
              const isExpanded = expandedId === resume.id
              const isBusy = pendingActionId === resume.id
              const topSkills = resume.top_skills?.slice(0, 5) ?? []
              const meta = analysisMeta[resume.id]

              if (resume.parse_status === "processing") {
                return <ProcessingResumeCard key={resume.id} resume={resume} />
              }

              if (resume.parse_status === "failed") {
                return (
                  <FailedResumeCard
                    key={resume.id}
                    resume={resume}
                    onReplace={() =>
                      document.getElementById("resume-upload")?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                  />
                )
              }

              return (
                <section
                  key={resume.id}
                  className="surface-card overflow-hidden"
                >
                  <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="space-y-5 px-5 py-5 md:px-6 md:py-6">
                      <div className="flex flex-wrap items-center gap-3">
                        {resume.is_primary && (
                          <span className="rounded-full bg-[#FFF1E8] px-3 py-1.5 text-sm font-medium text-[#062246]">
                            Primary resume
                          </span>
                        )}
                        <span
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-sm font-medium",
                            scoreTone(resume.resume_score)
                          )}
                        >
                          {resume.resume_score ?? 0} score
                        </span>
                        <span className="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-500">
                          {resume.years_of_experience ?? 0} years experience
                        </span>
                      </div>

                      <div>
                        <h2 className="text-2xl font-semibold text-gray-900">
                          {resume.full_name ?? resume.name ?? resume.file_name}
                        </h2>
                        <p className="mt-2 text-sm text-gray-500">
                          {resume.primary_role ?? "Role being analyzed"} · {resume.file_name}
                        </p>
                      </div>

                      <div className="section-divider-grid sm:grid sm:grid-cols-[minmax(0,2fr)_1fr_1fr] sm:divide-x sm:divide-slate-200/80">
                        <div className="section-divider-item">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                            Top skills
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {topSkills.length > 0 ? (
                              topSkills.map((skill) => (
                                <span
                                  key={skill}
                                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-sm font-medium text-gray-700"
                                >
                                  {skill}
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-gray-500">Still analyzing</span>
                            )}
                          </div>
                        </div>

                        <div className="section-divider-item border-t border-slate-200/80 sm:border-t-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                            Experience entries
                          </p>
                          <p className="mt-3 text-2xl font-semibold text-gray-900">
                            {resume.work_experience?.length ?? 0}
                          </p>
                        </div>

                        <div className="section-divider-item border-t border-slate-200/80 sm:border-t-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                            Education entries
                          </p>
                          <p className="mt-3 text-2xl font-semibold text-gray-900">
                            {resume.education?.length ?? 0}
                          </p>
                        </div>
                      </div>

                      <div className="toolbar-strip">
                        <Link
                          href={
                            meta?.jobId
                              ? `/dashboard/resume/edit?jobId=${meta.jobId}`
                              : "/dashboard/resume/edit"
                          }
                          className="inline-flex items-center gap-2 rounded-2xl bg-[#FF5C18] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
                        >
                          <Sparkles className="h-4 w-4" />
                          Edit resume
                          {meta?.improvements ? (
                            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium">
                              {meta.improvements} suggested
                            </span>
                          ) : null}
                        </Link>

                        {meta?.jobId && meta.jobTitle && (
                          <Link
                            href={`/dashboard/resume/edit?jobId=${meta.jobId}`}
                            className="rounded-2xl border border-[#FFD2B8] bg-[#FFF7F2] px-4 py-2.5 text-sm font-medium text-[#062246] transition hover:bg-[#FFF1E8]"
                          >
                            Optimize for {meta.jobTitle}
                          </Link>
                        )}

                        <label className="flex min-w-[220px] flex-1 items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
                          <FileText className="h-4 w-4 text-gray-400" />
                          <input
                            value={nameDrafts[resume.id] ?? resume.name ?? ""}
                            onChange={(event) =>
                              setNameDrafts((current) => ({
                                ...current,
                                [resume.id]: event.target.value,
                              }))
                            }
                            placeholder="Custom name"
                            className="w-full bg-transparent text-sm text-gray-700 outline-none"
                          />
                        </label>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleSaveName(resume)}
                          className="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-60"
                        >
                          Save name
                        </button>

                        {!resume.is_primary && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleSetPrimary(resume)}
                            className="rounded-2xl border border-[#FFD2B8] bg-[#FFF7F2] px-4 py-2.5 text-sm font-medium text-[#062246] transition hover:bg-[#FFF1E8] disabled:opacity-60"
                          >
                            Set as primary
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            document.getElementById("resume-upload")?.scrollIntoView({ behavior: "smooth", block: "start" })
                          }
                          className="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                        >
                          Replace resume
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDownload(resume)}
                          className="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                        >
                          Download original
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDelete(resume)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-slate-200/80 bg-slate-50/55 px-5 py-5 md:px-6 md:py-6 xl:border-l xl:border-t-0">
                      <ResumeScoreCard resume={resume} />
                    </div>
                  </div>

                  <div className="border-t border-slate-200/80 bg-slate-50/65">
                    <button
                      type="button"
                      onClick={() => setExpandedId((current) => (current === resume.id ? null : resume.id))}
                      className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left md:px-6"
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-900">View full parse</p>
                        <p className="mt-1 text-sm text-gray-500">
                          Contact, summary, experience, education, skills, and projects.
                        </p>
                      </div>
                      <span className="rounded-full border border-gray-200 px-3 py-1 text-sm font-medium text-gray-600">
                        {isExpanded ? "Collapse" : "Expand"}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-200 px-5 py-5 md:px-6">
                        <ParsedResumeView resume={resume} />
                      </div>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {primaryResume && (
          <section className="surface-inset p-6">
            <p className="text-sm font-semibold text-[#062246]">
              Your primary resume is parsed - product features can use it
            </p>
            <p className="mt-2 text-sm leading-7 text-gray-600">
              Hireoven already ships resume analysis/editing, autofill, cover letters, and match scoring on top of{" "}
              <span className="font-medium text-gray-900">{primaryResume.name ?? primaryResume.file_name}</span>.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Job feed
              </Link>
              <Link
                href="/dashboard/resume/edit"
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Resume editor
              </Link>
              <Link
                href="/dashboard/autofill"
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Autofill profile
              </Link>
              <Link
                href="/dashboard/cover-letters"
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Cover letters
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

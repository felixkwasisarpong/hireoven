"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { FileText, Loader2, Sparkles, Trash2 } from "lucide-react"
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
    <div className="surface-card rounded-none p-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-sm border border-slate-200/80 bg-slate-50/90 text-[#ea580c]">
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
        <div className="h-24 animate-pulse bg-slate-100" />
        <div className="h-16 animate-pulse bg-slate-100" />
        <div className="h-40 animate-pulse bg-slate-100" />
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
    <div className="surface-card rounded-none border-red-200 p-6 shadow-sm">
      <p className="text-lg font-semibold text-gray-900">{resume.name ?? resume.file_name}</p>
      <p className="mt-2 text-sm leading-6 text-gray-600">
        Hireoven could not finish parsing this file. Try replacing it with a cleaner PDF or DOCX export.
      </p>
      <button
        type="button"
        onClick={onReplace}
        className="mt-5 inline-flex items-center gap-2 rounded-sm bg-[#FF5C18] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
      >
        Replace resume
      </button>
    </div>
  )
}

export default function ResumeWorkspaceSection() {
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
    <div className="space-y-8">
      {(resumes.length < 3 || !hasResume) && (
        <section id="resume-upload">
          <ResumeUploader
            onUploadComplete={(resume) => {
              upsertResume(resume)
              setExpandedId(resume.id)
              void refresh()
              window.dispatchEvent(new Event("hireoven:resumes-changed"))
            }}
            showPrompt={!hasResume}
          />
        </section>
      )}

      {!isLoading && !hasResume && (
        <section className="surface-card rounded-none border-slate-200/90 py-12 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-sm border border-slate-200/80 bg-slate-50/80 text-[#ea580c]">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="mt-6 font-serif text-2xl font-normal tracking-tight text-gray-900 sm:text-[1.65rem]">
            Upload your resume to unlock the rest of Hireoven
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-slate-600">
            The moment you upload, Hireoven starts scoring resume quality, extracting your experience, and preparing match scoring for every job you view next.
          </p>
        </section>
      )}

      {isLoading && (
        <div className="space-y-4">
          <div className="surface-card h-44 animate-pulse rounded-none shadow-sm" />
          <div className="surface-card h-96 animate-pulse rounded-none shadow-sm" />
        </div>
      )}

      {!isLoading && resumes.length > 0 && (
        <div className="space-y-8">
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
                className="surface-card overflow-hidden rounded-none border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              >
                <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="space-y-0">
                    <div className="space-y-6 border-b border-slate-200/85 px-6 py-7 md:px-9 md:py-8">
                      <div className="flex flex-wrap items-center gap-2">
                        {resume.is_primary && (
                          <span className="rounded-sm border border-amber-200/90 bg-amber-50/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-900/90">
                            Primary
                          </span>
                        )}
                        <span
                          className={cn(
                            "rounded-sm border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em]",
                            scoreTone(resume.resume_score)
                          )}
                        >
                          {resume.resume_score ?? 0} quality
                        </span>
                        <span className="rounded-sm border border-slate-200/90 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.1em] text-slate-600">
                          {resume.years_of_experience ?? 0} yrs experience
                        </span>
                      </div>

                      <div className="border-b border-slate-200/70 pb-6">
                        <h2 className="font-serif text-3xl font-normal tracking-[-0.02em] text-slate-900 sm:text-[2rem]">
                          {resume.full_name ?? resume.name ?? resume.file_name}
                        </h2>
                        <p className="mt-1.5 text-sm text-slate-600">
                          {resume.primary_role ?? "Role being analyzed"}{" "}
                          <span className="text-slate-400">·</span> {resume.file_name}
                        </p>
                      </div>
                    </div>

                    <div className="section-divider-grid rounded-none border-slate-200/80 sm:grid sm:grid-cols-[minmax(0,2fr)_1fr_1fr] sm:divide-x sm:divide-slate-200/80">
                      <div className="section-divider-item">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Top skills
                        </p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {topSkills.length > 0 ? (
                            topSkills.map((skill) => (
                              <span
                                key={skill}
                                className="border border-slate-200/90 bg-white px-2 py-0.5 text-xs font-medium text-slate-700"
                              >
                                {skill}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-slate-500">Still analyzing</span>
                          )}
                        </div>
                      </div>

                      <div className="section-divider-item border-t border-slate-200/80 sm:border-t-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Experience
                        </p>
                        <p className="mt-2 font-serif text-2xl font-normal text-slate-900">
                          {resume.work_experience?.length ?? 0}
                        </p>
                      </div>

                      <div className="section-divider-item border-t border-slate-200/80 sm:border-t-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Education
                        </p>
                        <p className="mt-2 font-serif text-2xl font-normal text-slate-900">
                          {resume.education?.length ?? 0}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 border-b border-slate-200/85 px-6 py-5 md:px-9">
                      <div className="toolbar-strip border-0 pt-0">
                        <Link
                          href={
                            meta?.jobId
                              ? `/dashboard/resume/studio?mode=tailor&jobId=${meta.jobId}`
                              : "/dashboard/resume/studio?mode=preview"
                          }
                          className="inline-flex items-center gap-2 rounded-sm bg-[#FF5C18] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
                        >
                          <Sparkles className="h-4 w-4" />
                          Edit resume
                          {meta?.improvements ? (
                            <span className="border border-white/25 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                              {meta.improvements} suggested
                            </span>
                          ) : null}
                        </Link>

                        {meta?.jobId && meta.jobTitle && (
                          <Link
                            href={`/dashboard/resume/studio?mode=tailor&jobId=${meta.jobId}`}
                            className="rounded-sm border border-[#FFD2B8] bg-[#FFF7F2] px-4 py-2 text-sm font-medium text-[#ea580c] transition hover:bg-[#FFF1E8]"
                          >
                            Optimize for {meta.jobTitle}
                          </Link>
                        )}

                        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-sm border border-slate-200/90 bg-white px-3 py-2">
                          <FileText className="h-3.5 w-3.5 text-slate-400" />
                          <input
                            value={nameDrafts[resume.id] ?? resume.name ?? ""}
                            onChange={(event) =>
                              setNameDrafts((current) => ({
                                ...current,
                                [resume.id]: event.target.value,
                              }))
                            }
                            placeholder="Custom name"
                            className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                          />
                        </label>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleSaveName(resume)}
                          className="rounded-sm border border-slate-200/90 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Save name
                        </button>

                        {!resume.is_primary && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleSetPrimary(resume)}
                            className="rounded-sm border border-amber-200/80 bg-amber-50/50 px-3 py-2 text-sm font-medium text-amber-950/90 transition hover:bg-amber-50 disabled:opacity-60"
                          >
                            Set as primary
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            document.getElementById("resume-upload")?.scrollIntoView({ behavior: "smooth", block: "start" })
                          }
                          className="rounded-sm border border-slate-200/90 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          Replace resume
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDownload(resume)}
                          className="rounded-sm border border-slate-200/90 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          Download original
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDelete(resume)}
                          className="inline-flex items-center gap-1.5 rounded-sm border border-red-200/90 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-200/85 bg-[#FAFAF9] px-5 py-6 md:px-6 md:py-7 xl:border-l xl:border-t-0">
                    <ResumeScoreCard resume={resume} />
                  </div>
                </div>

                <div className="border-t border-slate-200/90 bg-slate-50/40">
                  <button
                    type="button"
                    onClick={() => setExpandedId((current) => (current === resume.id ? null : resume.id))}
                    className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition hover:bg-slate-50/80 md:px-9"
                  >
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Parsed content
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Contact, summary, experience, education, skills, and projects.
                      </p>
                    </div>
                    <span className="shrink-0 border border-slate-200/90 bg-white px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-slate-600">
                      {isExpanded ? "Hide" : "Show"}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-200/85 bg-white px-4 py-6 sm:px-6 md:px-8 md:py-7">
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
        <section className="surface-inset rounded-none border-slate-200/90 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
            Primary resume in use
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Analysis, autofill, cover letters, and match scoring use{" "}
            <span className="font-medium text-slate-900">{primaryResume.name ?? primaryResume.file_name}</span>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-sm border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-50"
            >
              Job feed
            </Link>
            <Link
              href="/dashboard/resume/studio?mode=preview"
              className="inline-flex items-center rounded-sm border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-50"
            >
              Resume editor
            </Link>
            <Link
              href="/dashboard/autofill"
              className="inline-flex items-center rounded-sm border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-50"
            >
              Autofill profile
            </Link>
            <Link
              href="/dashboard/cover-letters"
              className="inline-flex items-center rounded-sm border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-50"
            >
              Cover letters
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}

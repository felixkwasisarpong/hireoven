"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  Undo2,
  Wand2,
} from "lucide-react"
import BulletEditor from "@/components/resume/BulletEditor"
import KeywordInjector from "@/components/resume/KeywordInjector"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import VersionHistory from "@/components/resume/VersionHistory"
import { useToast } from "@/components/ui/ToastProvider"
import { useResumeEditor } from "@/lib/hooks/useResumeEditor"
import { useResumeAnalysis } from "@/lib/hooks/useResumeAnalysis"
import { applyResumeEditContent } from "@/lib/resume/state"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import type {
  Company,
  Job,
  Resume,
  ResumeEditSuggestion,
  ResumeSnapshot,
  Skills,
  WorkExperience,
} from "@/types"

type JobWithCompany = Job & { company: Company | null }
type SuggestionTab = "keywords" | "suggestions" | "impact"

function formatSavedState(
  saveState: "idle" | "saving" | "saved" | "error",
  lastSavedAt: string | null
) {
  if (saveState === "saving") return "Saving..."
  if (saveState === "error") return "Save failed - retrying..."
  if (!lastSavedAt) return "All changes saved"

  const secondsAgo = Math.max(
    1,
    Math.floor((Date.now() - new Date(lastSavedAt).getTime()) / 1000)
  )

  if (secondsAgo < 60) return `Saved ${secondsAgo} seconds ago`
  const minutes = Math.floor(secondsAgo / 60)
  return `Saved ${minutes} minute${minutes === 1 ? "" : "s"} ago`
}

function EditableCard({
  title,
  subtitle,
  children,
  defaultOpen = true,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="rounded-[28px] border border-gray-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.05)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
        </div>
        <ChevronDown
          className={cn("h-5 w-5 text-gray-400 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="border-t border-gray-100 px-5 py-5">{children}</div>}
    </section>
  )
}

function countSuggestedImprovements(suggestions: ResumeEditSuggestion[]) {
  return suggestions.filter((suggestion) => suggestion.was_accepted == null).length
}

function buildSkillsCounts(skills: Skills | null) {
  const normalized = skills ?? {
    technical: [],
    soft: [],
    languages: [],
    certifications: [],
  }

  return [
    ["Technical", normalized.technical],
    ["Soft", normalized.soft],
    ["Languages", normalized.languages],
    ["Certifications", normalized.certifications],
  ] as const
}

export default function ResumeEditPage() {
  const searchParams = useSearchParams()
  const jobId = searchParams.get("jobId")
  const { resumes, primaryResume, upsertResume } = useResumeContext()
  const { pushToast } = useToast()
  const [job, setJob] = useState<JobWithCompany | null>(null)
  const [activeTab, setActiveTab] = useState<SuggestionTab>("keywords")
  const [keywordToInject, setKeywordToInject] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [skillsToRemove, setSkillsToRemove] = useState<string[]>([])
  const versionHistoryRef = useRef<HTMLDivElement | null>(null)

  const editableResume = useMemo(
    () =>
      resumes.find((resume) => resume.is_primary && resume.parse_status === "complete") ??
      resumes.find((resume) => resume.parse_status === "complete") ??
      null,
    [resumes]
  )

  if (!editableResume) {
    return (
      <main className="app-page">
        <div className="mx-auto max-w-3xl rounded-[32px] border border-white/80 bg-white/90 p-10 text-center shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <p className="text-2xl font-semibold text-gray-900">Upload a parsed resume first</p>
          <p className="mt-3 text-sm leading-7 text-gray-500">
            Hireoven needs a complete resume before the AI editor can suggest targeted improvements.
          </p>
          <Link
            href="/dashboard/resume"
            className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[#FF5C18] px-5 py-3 text-sm font-semibold text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to resume uploads
          </Link>
        </div>
      </main>
    )
  }

  const {
    resume,
    suggestions,
    saveState,
    lastSavedAt,
    updateSection,
    queueSuggestion,
    setSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useResumeEditor(editableResume)

  const { analysis, isAnalyzing, isLoading, triggerAnalysis, refetch } = useResumeAnalysis(
    editableResume?.id ?? null,
    jobId
  )

  useEffect(() => {
    if (!jobId) return
    const supabase = createClient()
    const targetJobId = jobId

    async function loadJob() {
      const { data } = await (supabase
        .from("jobs")
        .select("*, company:companies(*)")
        .eq("id", targetJobId)
        .single() as any)

      setJob((data as JobWithCompany | null) ?? null)
    }

    void loadJob()
  }, [jobId])

  useEffect(() => {
    if (!jobId || !editableResume || analysis || isLoading || isAnalyzing) return
    void triggerAnalysis()
  }, [analysis, editableResume, isAnalyzing, isLoading, jobId, triggerAnalysis])

  useEffect(() => {
    const missingSkills = analysis?.missing_skills ?? []
    const currentSkills = new Set((resume.skills?.technical ?? []).map((skill) => skill.toLowerCase()))

    setSkillsToRemove(
      (resume.skills?.technical ?? []).filter((skill) =>
        ["microsoft office", "windows xp", "internet explorer", "wordperfect"].includes(
          skill.toLowerCase()
        )
      )
    )

    if (missingSkills.length > 0) {
      // Keep missing skills visible in the UI, but don't auto-add them.
      const filtered = missingSkills.filter((skill) => !currentSkills.has(skill.toLowerCase()))
      if (filtered.length > 0) {
        pushToast({
          tone: "info",
          title: "Job-specific gaps loaded",
          description: `${filtered.slice(0, 3).join(", ")} stand out as missing from this resume.`,
        })
      }
    }
    // One-time nudge when job analysis arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.id])

  const missingKeywords = analysis?.missing_keywords ?? []
  const missingSkills = analysis?.missing_skills ?? []
  const keywordDensity = analysis?.keyword_density ?? {}

  const projectedScore = useMemo(() => {
    const base = analysis?.overall_score ?? 67
    const keywordLift = suggestions.reduce(
      (sum, suggestion) => sum + Math.min(4, suggestion.keywords_added?.length ?? 0),
      0
    )
    const structuralLift = suggestions.filter((item) => item.section === "summary").length * 3
    return Math.min(100, base + keywordLift + structuralLift)
  }, [analysis?.overall_score, suggestions])

  async function handleSummaryRewrite() {
    setSummaryLoading(true)
    const response = await fetch("/api/resume/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resumeId: resume.id,
        section: "summary",
        originalContent: resume.summary ?? "",
        editType: "rewrite",
        jobId,
        missingKeywords,
        context: { field: "summary" },
      }),
    })
    const data = await response.json()
    setSummaryLoading(false)

    if (!response.ok) {
      pushToast({ tone: "error", title: "Could not generate summary", description: data.error })
      return
    }

    const suggestion: ResumeEditSuggestion = {
      id: data.editId,
      user_id: resume.user_id,
      resume_id: resume.id,
      job_id: jobId,
      section: "summary",
      original_content: resume.summary ?? "",
      suggested_content: data.suggestion,
      edit_type: "rewrite",
      keywords_added: data.keywordsAdded ?? [],
      was_accepted: null,
      feedback: null,
      context: { field: "summary" },
      created_at: new Date().toISOString(),
    }
    queueSuggestion(suggestion)
    setSuggestions((current) => [suggestion, ...current.filter((item) => item.id !== suggestion.id)])
    setActiveTab("suggestions")
  }

  async function handleImproveAllBullets(entry: WorkExperience, experienceIndex: number) {
    const results = await Promise.all(
      entry.achievements.map(async (achievement, bulletIndex) => {
        const response = await fetch("/api/resume/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resumeId: resume.id,
            section: "work_experience",
            originalContent: achievement,
            editType: "rewrite",
            jobId,
            missingKeywords,
            context: { experienceIndex, bulletIndex, field: "achievement" },
          }),
        })
        const data = await response.json()
        if (!response.ok) return null

        return {
          id: data.editId,
          user_id: resume.user_id,
          resume_id: resume.id,
          job_id: jobId,
          section: "work_experience",
          original_content: achievement,
          suggested_content: data.suggestion,
          edit_type: "rewrite",
          keywords_added: data.keywordsAdded ?? [],
          was_accepted: null,
          feedback: null,
          context: { experienceIndex, bulletIndex, field: "achievement" },
          created_at: new Date().toISOString(),
        } satisfies ResumeEditSuggestion
      })
    )

    const validResults = results.filter(Boolean) as ResumeEditSuggestion[]
    if (validResults.length === 0) return
    setSuggestions((current) => [...validResults, ...current])
    setActiveTab("suggestions")
  }

  async function handleDownloadPdf() {
    const response = await fetch(`/api/resume/download?resumeId=${resume.id}`, { cache: "no-store" })
    if (!response.ok) {
      pushToast({ tone: "error", title: "Could not export PDF" })
      return
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${(resume.name ?? resume.file_name).replace(/\.[^.]+$/, "")}.pdf`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function handleOpenOriginal() {
    const response = await fetch(`/api/resume/${resume.id}`, { cache: "no-store" })
    if (!response.ok) {
      pushToast({ tone: "error", title: "Could not load original file" })
      return
    }
    const data = (await response.json()) as Resume & { download_url?: string }
    window.open(data.download_url ?? data.file_url, "_blank", "noopener,noreferrer")
  }

  async function restoreSnapshot(snapshot: ResumeSnapshot) {
    const nextResume = {
      ...resume,
      ...snapshot,
    } as Resume

    updateSection("summary", snapshot.summary ?? "")
    updateSection("work_experience", snapshot.work_experience ?? [])
    updateSection("education", snapshot.education ?? [])
    updateSection("skills", snapshot.skills ?? { technical: [], soft: [], languages: [], certifications: [] })
    updateSection("projects", snapshot.projects ?? [])
    upsertResume(nextResume)
    pushToast({
      tone: "success",
      title: "Version restored",
      description: "The saved version has been restored into the editor.",
    })
  }

  function reorderBullet(experienceIndex: number, fromIndex: number, toIndex: number) {
    const current = [...(resume.work_experience ?? [])]
    const targetExperience = current[experienceIndex]
    if (!targetExperience) return

    const nextAchievements = [...targetExperience.achievements]
    const [moved] = nextAchievements.splice(fromIndex, 1)
    nextAchievements.splice(toIndex, 0, moved)

    current[experienceIndex] = {
      ...targetExperience,
      achievements: nextAchievements,
    }

    updateSection("work_experience", current)
  }

  return (
    <main className="app-page">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/dashboard/resume"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 transition hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to resumes
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canUndo}
              onClick={undo}
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-700 disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" />
              Undo
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={redo}
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-700 disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              Redo
            </button>
          </div>
        </div>

        {job && (
          <section className="rounded-[28px] border border-[#FFD2B8] bg-[#FFF8F4] px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#FF5C18]">
              Editing for target role
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-gray-900">
                {job.title} at {job.company?.name ?? "Company"}
              </h1>
              <span className="rounded-full border border-[#FFD2B8] bg-white px-3 py-1.5 text-sm font-medium text-[#062246]">
                {analysis?.overall_score ?? "-"}% current match
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Suggestions on the right are grounded in this real job description, not generic resume advice.
            </p>
          </section>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.72fr)]">
          <div className="space-y-5">
            <EditableCard
              title="Summary"
              subtitle="Tight, human, role-aware. Aim for 300–500 characters."
            >
              <div className="space-y-4">
                <textarea
                  value={resume.summary ?? ""}
                  onChange={(event) => updateSection("summary", event.target.value)}
                  className="min-h-[160px] w-full rounded-3xl border border-gray-200 bg-[#FAFCFF] px-4 py-4 text-sm leading-7 text-gray-800 outline-none transition focus:border-[#7DD3FC]"
                  placeholder="Add a summary that says what you do, your level, and what you bring."
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-medium text-gray-400">
                    {(resume.summary ?? "").length} characters
                  </p>
                  <button
                    type="button"
                    disabled={summaryLoading}
                    onClick={() => void handleSummaryRewrite()}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#FF5C18] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E] disabled:opacity-60"
                  >
                    {summaryLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4" />
                    )}
                    {resume.summary ? "Rewrite with AI" : "Generate summary"}
                  </button>
                </div>
              </div>
            </EditableCard>

            <EditableCard
              title="Work experience"
              subtitle="Rewrite bullets one by one or improve a whole role in one pass."
            >
              <div className="space-y-5">
                {(resume.work_experience ?? []).map((experience, experienceIndex) => (
                  <article key={`${experience.company}-${experience.title}-${experienceIndex}`} className="rounded-3xl border border-gray-200 bg-[#FAFCFF] p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input
                            value={experience.title}
                            onChange={(event) => {
                              const next = [...(resume.work_experience ?? [])]
                              next[experienceIndex] = { ...experience, title: event.target.value }
                              updateSection("work_experience", next)
                            }}
                            className="rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none"
                          />
                          <input
                            value={experience.company}
                            onChange={(event) => {
                              const next = [...(resume.work_experience ?? [])]
                              next[experienceIndex] = { ...experience, company: event.target.value }
                              updateSection("work_experience", next)
                            }}
                            className="rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none"
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <input
                            value={experience.start_date}
                            onChange={(event) => {
                              const next = [...(resume.work_experience ?? [])]
                              next[experienceIndex] = { ...experience, start_date: event.target.value }
                              updateSection("work_experience", next)
                            }}
                            className="rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none"
                            placeholder="Start date"
                          />
                          <input
                            value={experience.end_date ?? ""}
                            onChange={(event) => {
                              const next = [...(resume.work_experience ?? [])]
                              next[experienceIndex] = {
                                ...experience,
                                end_date: event.target.value || null,
                                is_current: event.target.value.length === 0 ? true : experience.is_current,
                              }
                              updateSection("work_experience", next)
                            }}
                            className="rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none"
                            placeholder="End date"
                          />
                          <label className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={experience.is_current}
                              onChange={(event) => {
                                const next = [...(resume.work_experience ?? [])]
                                next[experienceIndex] = { ...experience, is_current: event.target.checked }
                                updateSection("work_experience", next)
                              }}
                            />
                            Current role
                          </label>
                        </div>
                        <textarea
                          value={experience.description}
                          onChange={(event) => {
                            const next = [...(resume.work_experience ?? [])]
                            next[experienceIndex] = { ...experience, description: event.target.value }
                            updateSection("work_experience", next)
                          }}
                          className="min-h-[80px] w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm leading-6 text-gray-700 outline-none"
                          placeholder="Describe the scope of this role."
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleImproveAllBullets(experience, experienceIndex)}
                          className="rounded-2xl border border-[#FFD2B8] bg-white px-3.5 py-2 text-sm font-medium text-[#062246]"
                        >
                          Improve all bullets
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      {experience.achievements.map((achievement, bulletIndex) => (
                        <div
                          key={`${experience.company}-${bulletIndex}`}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData(
                              "text/plain",
                              JSON.stringify({ experienceIndex, bulletIndex })
                            )
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault()
                            const payload = JSON.parse(event.dataTransfer.getData("text/plain")) as {
                              experienceIndex: number
                              bulletIndex: number
                            }
                            if (payload.experienceIndex !== experienceIndex) return
                            reorderBullet(experienceIndex, payload.bulletIndex, bulletIndex)
                          }}
                        >
                          <BulletEditor
                            content={achievement}
                            onUpdate={(newContent) => {
                              const next = [...(resume.work_experience ?? [])]
                              const nextAchievements = [...experience.achievements]
                              nextAchievements[bulletIndex] = newContent
                              next[experienceIndex] = { ...experience, achievements: nextAchievements }
                              updateSection("work_experience", next)
                            }}
                            onDelete={() => {
                              const next = [...(resume.work_experience ?? [])]
                              next[experienceIndex] = {
                                ...experience,
                                achievements: experience.achievements.filter((_, index) => index !== bulletIndex),
                              }
                              updateSection("work_experience", next)
                            }}
                            resumeId={resume.id}
                            jobId={jobId ?? undefined}
                            missingKeywords={missingKeywords}
                            experienceIndex={experienceIndex}
                            bulletIndex={bulletIndex}
                            roleTitle={experience.title}
                            companyName={experience.company}
                            onQueueSuggestion={queueSuggestion}
                            onAcceptSuggestion={async (editId) => {
                              const updated = (await acceptSuggestion(editId)) as Resume | null
                              if (updated) {
                                upsertResume(updated)
                              }
                            }}
                            onRejectSuggestion={rejectSuggestion}
                          />
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const next = [...(resume.work_experience ?? [])]
                        next[experienceIndex] = {
                          ...experience,
                          achievements: [...experience.achievements, "Added bullet"],
                        }
                        updateSection("work_experience", next)
                      }}
                      className="mt-4 rounded-2xl border border-dashed border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:border-[#7DD3FC] hover:bg-white"
                    >
                      Add bullet
                    </button>
                  </article>
                ))}
              </div>
            </EditableCard>

            <EditableCard
              title="Skills"
              subtitle="Click to remove, type to add, and keep the most relevant skills obvious."
            >
              <div className="space-y-4">
                {buildSkillsCounts(resume.skills).map(([label, values]) => (
                  <div key={label}>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                      {label}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {values.map((skill) => (
                        <button
                          key={skill}
                          type="button"
                          onClick={() => {
                            const key = label.toLowerCase() as keyof Skills
                            const nextSkills = {
                              ...(resume.skills ?? {
                                technical: [],
                                soft: [],
                                languages: [],
                                certifications: [],
                              }),
                              [key]: (resume.skills?.[key] ?? []).filter((item) => item !== skill),
                            } as Skills

                            updateSection("skills", nextSkills)
                          }}
                          className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:border-red-200 hover:text-red-600"
                        >
                          {skill}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="rounded-2xl border border-gray-200 bg-[#FAFCFF] px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                    Add skill
                  </p>
                  <input
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return
                      const target = event.currentTarget
                      const value = target.value.trim()
                      if (!value) return
                      const nextSkills = {
                        ...(resume.skills ?? {
                          technical: [],
                          soft: [],
                          languages: [],
                          certifications: [],
                        }),
                        technical: Array.from(new Set([...(resume.skills?.technical ?? []), value])),
                      } satisfies Skills
                      updateSection("skills", nextSkills)
                      target.value = ""
                    }}
                    className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none"
                    placeholder="Type a skill and press Enter"
                  />
                </div>

                {missingSkills.length > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                    <p className="text-sm font-semibold text-amber-800">Suggested to add</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {missingSkills.map((skill) => (
                        <button
                          key={skill}
                          type="button"
                          onClick={() => {
                            const nextSkills = {
                              ...(resume.skills ?? {
                                technical: [],
                                soft: [],
                                languages: [],
                                certifications: [],
                              }),
                              technical: Array.from(new Set([...(resume.skills?.technical ?? []), skill])),
                            } satisfies Skills
                            updateSection("skills", nextSkills)
                          }}
                          className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800"
                        >
                          + {skill}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {skillsToRemove.length > 0 && (
                  <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
                    <p className="text-sm font-semibold text-gray-900">Consider removing</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {skillsToRemove.map((skill) => (
                        <span
                          key={skill}
                          className="rounded-full border border-gray-200 bg-[#FAFCFF] px-3 py-1.5 text-sm font-medium text-gray-500"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </EditableCard>

            <EditableCard title="Education" subtitle="Usually stable, but editable when the parser misses details.">
              <div className="space-y-4">
                {(resume.education ?? []).map((entry, index) => (
                  <div key={`${entry.institution}-${index}`} className="grid gap-2 rounded-2xl border border-gray-200 bg-[#FAFCFF] p-4 sm:grid-cols-2">
                    {[
                      ["Institution", entry.institution, "institution"],
                      ["Degree", entry.degree, "degree"],
                      ["Field", entry.field, "field"],
                      ["GPA", entry.gpa ?? "", "gpa"],
                      ["Start date", entry.start_date, "start_date"],
                      ["End date", entry.end_date ?? "", "end_date"],
                    ].map(([label, value, key]) => (
                      <label key={`${label}-${index}`} className="block">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                          {label}
                        </span>
                        <input
                          value={value}
                          onChange={(event) => {
                            const next = [...(resume.education ?? [])]
                            next[index] = { ...entry, [key]: event.target.value || null }
                            updateSection("education", next)
                          }}
                          className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none"
                        />
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </EditableCard>

            <EditableCard title="Projects" subtitle="Useful for keyword coverage and skill proof.">
              <div className="space-y-4">
                {(resume.projects ?? []).map((project, index) => (
                  <div key={`${project.name}-${index}`} className="rounded-2xl border border-gray-200 bg-[#FAFCFF] p-4">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={project.name}
                        onChange={(event) => {
                          const next = [...(resume.projects ?? [])]
                          next[index] = { ...project, name: event.target.value }
                          updateSection("projects", next)
                        }}
                        className="rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none"
                        placeholder="Project name"
                      />
                      <input
                        value={project.url ?? ""}
                        onChange={(event) => {
                          const next = [...(resume.projects ?? [])]
                          next[index] = { ...project, url: event.target.value || null }
                          updateSection("projects", next)
                        }}
                        className="rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none"
                        placeholder="Project URL"
                      />
                    </div>
                    <textarea
                      value={project.description}
                      onChange={(event) => {
                        const next = [...(resume.projects ?? [])]
                        next[index] = { ...project, description: event.target.value }
                        updateSection("projects", next)
                      }}
                      className="mt-3 min-h-[90px] w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm leading-6 text-gray-700 outline-none"
                    />
                  </div>
                ))}
              </div>
            </EditableCard>

            <div ref={versionHistoryRef}>
              <VersionHistory
                resume={resume}
                jobLabel={job ? `${job.title} at ${job.company?.name ?? "Company"}` : null}
                onRestore={async (snapshot) => restoreSnapshot(snapshot)}
              />
            </div>
          </div>

          <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
            <section className="rounded-[28px] border border-gray-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.05)]">
              <div className="flex flex-wrap gap-2">
                {[
                  ["keywords", "Missing keywords"],
                  ["suggestions", `Suggestions (${countSuggestedImprovements(suggestions)})`],
                  ["impact", "Score impact"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key as SuggestionTab)}
                    className={cn(
                      "rounded-full px-3.5 py-2 text-sm font-medium transition",
                      activeTab === key
                        ? "bg-[#FF5C18] text-white"
                        : "border border-gray-200 text-gray-600 hover:bg-gray-50"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === "keywords" && (
                <div className="mt-5 space-y-3">
                  {jobId && missingKeywords.length === 0 && (isAnalyzing || isLoading) && (
                    <div className="rounded-2xl border border-[#FFD9C2] bg-[#FFF8F4] px-4 py-4 text-sm text-[#062246]">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading role-specific keyword gaps…
                      </div>
                    </div>
                  )}

                  {missingKeywords.map((keyword) => (
                    <div key={keyword} className="rounded-2xl border border-gray-200 bg-[#FAFCFF] px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{keyword}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-gray-400">
                            Appears {keywordDensity[keyword] ?? 1} time{(keywordDensity[keyword] ?? 1) === 1 ? "" : "s"} in JD
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setKeywordToInject(keyword)}
                          className="rounded-2xl border border-[#FFD2B8] bg-white px-3 py-2 text-sm font-medium text-[#062246]"
                        >
                          Add to resume
                        </button>
                      </div>
                    </div>
                  ))}

                  {missingKeywords.length === 0 && !isAnalyzing && !isLoading && (
                    <div className="rounded-2xl border border-dashed border-gray-300 bg-[#FAFCFF] px-4 py-5 text-sm text-gray-500">
                      No missing keywords surfaced yet. This resume is already covering the basics for this role.
                    </div>
                  )}
                </div>
              )}

              {activeTab === "suggestions" && (
                <div className="mt-5 space-y-3">
                  {suggestions.map((suggestion) => (
                    <article key={suggestion.id} className="rounded-2xl border border-gray-200 bg-[#FAFCFF] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                          {suggestion.section === "summary" ? "Summary" : "Experience"}
                        </p>
                        {suggestion.edit_type && (
                          <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-500">
                            {suggestion.edit_type.replace("_", " ")}
                          </span>
                        )}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-gray-500 line-through decoration-gray-300">
                        {suggestion.original_content}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-gray-800">
                        {suggestion.suggested_content}
                      </p>
                      {(suggestion.keywords_added?.length ?? 0) > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {suggestion.keywords_added?.map((keyword) => (
                            <span
                              key={keyword}
                              className="rounded-full border border-[#FFD2B8] bg-white px-2.5 py-1 text-[11px] font-medium text-[#062246]"
                            >
                              {keyword}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const updated = (await acceptSuggestion(suggestion.id)) as Resume | null
                              if (updated) {
                                upsertResume(updated)
                                pushToast({ tone: "success", title: "Suggestion accepted" })
                              }
                            } catch (error) {
                              pushToast({
                                tone: "error",
                                title: "Could not accept suggestion",
                                description:
                                  error instanceof Error ? error.message : "Please try again.",
                              })
                            }
                          }}
                          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                        >
                          <Check className="h-4 w-4" />
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await rejectSuggestion(suggestion.id)
                              pushToast({ tone: "info", title: "Suggestion dismissed" })
                            } catch (error) {
                              pushToast({
                                tone: "error",
                                title: "Could not reject suggestion",
                                description:
                                  error instanceof Error ? error.message : "Please try again.",
                              })
                            }
                          }}
                          className="rounded-2xl border border-red-200 px-3.5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const response = await fetch("/api/resume/edit", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                resumeId: resume.id,
                                section: suggestion.section,
                                originalContent: suggestion.original_content,
                                editType: suggestion.edit_type,
                                jobId,
                                missingKeywords,
                                context: suggestion.context,
                              }),
                            })
                            const data = await response.json()
                            if (!response.ok) return
                            const regenerated = {
                              ...suggestion,
                              id: data.editId,
                              suggested_content: data.suggestion,
                              keywords_added: data.keywordsAdded ?? [],
                            } satisfies ResumeEditSuggestion
                            setSuggestions((current) =>
                              [regenerated, ...current.filter((item) => item.id !== suggestion.id)]
                            )
                          }}
                          className="rounded-2xl border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-white"
                        >
                          Regenerate
                        </button>
                      </div>
                    </article>
                  ))}

                  {suggestions.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-gray-300 bg-[#FAFCFF] px-4 py-5 text-sm text-gray-500">
                      AI suggestions will queue here for review. Nothing is applied automatically.
                    </div>
                  )}
                </div>
              )}

              {activeTab === "impact" && (
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl border border-[#FFD9C2] bg-[#FFF8F4] p-4">
                    <p className="text-sm font-semibold text-[#062246]">
                      Accepting all suggestions would increase your match score from{" "}
                      <span className="font-bold">{analysis?.overall_score ?? 67}</span> to{" "}
                      <span className="font-bold">{projectedScore}</span>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-gray-200 bg-[#FAFCFF] px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                        Pending suggestions
                      </p>
                      <p className="mt-2 text-3xl font-semibold text-gray-900">
                        {suggestions.length}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-[#FAFCFF] px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                        Keywords covered
                      </p>
                      <p className="mt-2 text-3xl font-semibold text-gray-900">
                        {suggestions.reduce((sum, item) => sum + (item.keywords_added?.length ?? 0), 0)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {showOriginal && (
              <section className="rounded-[28px] border border-gray-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.05)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                  Original snapshot
                </p>
                <div className="mt-4 space-y-4 text-sm leading-6 text-gray-600">
                  <div>
                    <p className="font-semibold text-gray-900">Summary</p>
                    <p>{editableResume.summary ?? "No summary in original parse."}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Top skills</p>
                    <p>{(editableResume.top_skills ?? []).join(", ") || "No skills extracted."}</p>
                  </div>
                </div>
              </section>
            )}
          </aside>
        </div>

        <div className="sticky bottom-4 z-20 rounded-[28px] border border-white/80 bg-white/95 px-5 py-4 shadow-[0_24px_70px_rgba(15,23,42,0.14)] backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
              <span className="rounded-full border border-[#FFD9C2] bg-[#FFF8F4] px-3 py-1.5 font-medium text-[#062246]">
                {formatSavedState(saveState, lastSavedAt)}
              </span>
              {job && (
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="rounded-full border border-gray-200 px-3 py-1.5 font-medium text-gray-700"
                >
                  Re-analyze for {job.title}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700"
              >
                <Download className="h-4 w-4" />
                Download as PDF
              </button>
              <button
                type="button"
                onClick={() => versionHistoryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700"
              >
                <Save className="h-4 w-4" />
                Save as new version
              </button>
              <button
                type="button"
                onClick={() => setShowOriginal((current) => !current)}
                className="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700"
              >
                {showOriginal ? "Hide original" : "View original"}
              </button>
              <button
                type="button"
                onClick={() => void handleOpenOriginal()}
                className="rounded-2xl bg-[#FF5C18] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
              >
                Open uploaded file
              </button>
            </div>
          </div>
        </div>
      </div>

      <KeywordInjector
        keyword={keywordToInject ?? ""}
        open={Boolean(keywordToInject)}
        resume={resume}
        jobId={jobId ?? undefined}
        onClose={() => setKeywordToInject(null)}
        onQueueSuggestion={queueSuggestion}
        onAcceptSuggestion={async (editId) => {
          const updated = (await acceptSuggestion(editId)) as Resume | null
          if (updated) {
            upsertResume(updated)
          }
        }}
      />
    </main>
  )
}

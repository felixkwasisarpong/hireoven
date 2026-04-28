
"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Eye,
  FileText,
  FilePlus2,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useToast } from "@/components/ui/ToastProvider"
import {
  RESUME_HANDOFF_EVENT,
  readResumeHandoff,
  removeResumeHandoff,
} from "@/lib/resume/local-resume-handoff"
import { useResumeHubData } from "@/lib/resume/use-resume-hub-data"
import {
  MAX_RESUME_SIZE_BYTES,
  isResumeFilename,
  isResumeMimeType,
} from "@/lib/resume/constants"
import { cn } from "@/lib/utils"
import type { Resume } from "@/types"
import type { ResumeStatus } from "@/types/resume-hub"

type UploadPhase = "idle" | "uploading" | "processing" | "done" | "error"

type FilterValue = "all" | ResumeStatus
type SortValue = "latest" | "oldest" | "ats" | "match"

const FILTERS: { label: string; value: FilterValue }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Draft", value: "draft" },
  { label: "Tailored", value: "tailored" },
  { label: "Archived", value: "archived" },
]

const SORT_OPTIONS: { label: string; value: SortValue }[] = [
  { label: "Latest updated", value: "latest" },
  { label: "Oldest", value: "oldest" },
  { label: "Highest ATS score", value: "ats" },
  { label: "Highest match score", value: "match" },
]

const STATUS_META: Record<ResumeStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  draft: { label: "Draft", className: "bg-indigo-50 text-[#5B4DFF] border-indigo-100" },
  tailored: { label: "Tailored", className: "bg-orange-50 text-orange-600 border-orange-100" },
  archived: { label: "Archived", className: "bg-slate-100 text-slate-500 border-slate-200" },
}

function deriveStatus(resume: Resume): ResumeStatus {
  if (resume.archived_at) return "archived"
  if (resume.is_primary) return "active"
  if (resume.parse_status !== "complete") return "draft"
  return "draft"
}

function fmtDate(value?: string | null) {
  if (!value) return { date: "Not updated", time: "–" }
  const date = new Date(value)
  return {
    date: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    time: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  }
}

function ScoreCircle({ score, tone }: { score?: number | null; tone: "ats" | "match" }) {
  const safeScore = score ?? 0
  const color = tone === "ats" ? "#16A34A" : safeScore >= 80 ? "#16A34A" : safeScore >= 65 ? "#2563EB" : "#F97316"
  const circumference = 2 * Math.PI * 18
  const dash = (Math.min(100, Math.max(0, safeScore)) / 100) * circumference

  return (
    <div className="relative flex h-12 w-12 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="18" fill="none" stroke="#E8EEF7" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r="18"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <span className="text-[11px] font-bold text-slate-900 tabular-nums">{score ?? "–"}%</span>
    </div>
  )
}

function StatusPill({ status }: { status: ResumeStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold", meta.className)}>
      {meta.label}
    </span>
  )
}

function ResumeThumb({ resume }: { resume: Resume }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const title = resume.full_name ?? resume.name ?? resume.file_name
  const role = resume.primary_role ?? "Resume"
  const summary = resume.summary ?? resume.raw_text?.split(/\s+/).slice(0, 12).join(" ") ?? "Resume preview"
  const isPdf = /pdf/i.test(resume.file_type ?? resume.file_name)
  const canRenderFile = Boolean(resume.storage_path && resume.file_type !== "generated")

  useEffect(() => {
    let cancelled = false

    async function loadPreviewUrl() {
      if (!canRenderFile) {
        setPreviewUrl(null)
        return
      }

      const response = await fetch(`/api/resume/${resume.id}`, { cache: "no-store" })
      if (!response.ok) return
      const data = (await response.json()) as Resume & { download_url?: string }
      if (!cancelled) setPreviewUrl(data.download_url ?? data.file_url ?? null)
    }

    void loadPreviewUrl()

    return () => {
      cancelled = true
    }
  }, [canRenderFile, resume.id])

  return (
    <div className="h-[64px] w-[48px] shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
      {previewUrl && isPdf ? (
        <iframe
          title={`${title} thumbnail`}
          src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&page=1&zoom=35`}
          className="pointer-events-none h-full w-full rounded-sm border-0 bg-white"
        />
      ) : (
        <div className="h-full overflow-hidden rounded-sm border border-slate-100 bg-slate-50 px-1.5 py-1.5">
          <p className="truncate text-[5px] font-bold uppercase tracking-wide text-slate-700">{title}</p>
          <p className="mt-0.5 truncate text-[4.5px] font-semibold text-[#5B4DFF]">{role}</p>
          <div className="mt-1.5 space-y-0.5">
            {summary.split(/\s+/).slice(0, 8).map((word, index) => (
              <div
                key={`${word}-${index}`}
                className={cn(
                  "h-0.5 rounded bg-slate-200",
                  index % 3 === 0 ? "w-full" : index % 3 === 1 ? "w-10/12" : "w-8/12"
                )}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
        <FileText className="h-6 w-6" />
      </div>
      <p className="mt-4 text-[14px] font-semibold text-slate-700">
        {hasFilter ? "No resumes match this filter" : "Your library is empty"}
      </p>
      <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-relaxed text-slate-400">
        {hasFilter ? "Try a different filter or upload a new resume." : "Upload a resume or use AI Studio to create one."}
      </p>
    </div>
  )
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border px-3 text-[12px] font-semibold transition",
        active
          ? "border-[#5B4DFF] bg-indigo-50 text-[#5B4DFF]"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      )}
    >
      {label} ({count})
    </button>
  )
}

export default function ResumeLibraryView({ topSlot }: { topSlot?: ReactNode }) {
  const { resumes, isLoading, refresh, removeResume, upsertResume } = useResumeContext()
  const { data: hubData, refresh: refreshHubData } = useResumeHubData()
  const { pushToast } = useToast()
  const [filter, setFilter] = useState<FilterValue>("all")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortValue>("latest")
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [handoffResumes, setHandoffResumes] = useState<Resume[]>([])
  const [apiResumes, setApiResumes] = useState<Resume[]>([])
  const [isFetchingLibrary, setIsFetchingLibrary] = useState(true)

  // Upload state
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle")
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadFileName, setUploadFileName] = useState("")
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadedAtsScore, setUploadedAtsScore] = useState<number | null>(null)

  async function loadLibraryResumes() {
    setIsFetchingLibrary(true)
    try {
      const response = await fetch("/api/resume", { credentials: "include", cache: "no-store" })
      if (!response.ok) throw new Error("Failed to load resume library")
      setApiResumes((await response.json()) as Resume[])
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Could not load resume library",
        description: error instanceof Error ? error.message : "Please refresh and try again.",
      })
    } finally {
      setIsFetchingLibrary(false)
    }
  }

  function triggerUpload() {
    fileInputRef.current?.click()
  }

  function cancelUpload() {
    xhrRef.current?.abort()
    setUploadPhase("idle")
    setUploadProgress(0)
    setUploadFileName("")
    setUploadError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function pollUploadStatus(resumeId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise<void>((r) => setTimeout(r, 2000))
      try {
        const res = await fetch(`/api/resume/${resumeId}/status`, { cache: "no-store" })
        if (!res.ok) continue
        const status = (await res.json()) as { parse_status?: string; ats_score?: number }
        if (status.parse_status === "complete") {
          const resumeRes = await fetch(`/api/resume/${resumeId}`, { cache: "no-store" })
          if (resumeRes.ok) upsertResume((await resumeRes.json()) as Resume)
          setUploadedAtsScore(status.ats_score ?? null)
          await refresh()
          await loadLibraryResumes()
          void refreshHubData()
          window.dispatchEvent(new Event("hireoven:resumes-changed"))
          setUploadPhase("done")
          return
        }
        if (status.parse_status === "failed") {
          setUploadError("AI parsing failed — you can still view the resume.")
          setUploadPhase("error")
          return
        }
      } catch {
        // retry
      }
    }
    setUploadError("Parsing timed out. Your resume was saved — refresh to view it.")
    setUploadPhase("error")
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!fileInputRef.current) return
    fileInputRef.current.value = ""
    if (!file) return

    if (!isResumeMimeType(file.type) && !isResumeFilename(file.name)) {
      pushToast({ tone: "error", title: "Invalid file type", description: "Please upload a PDF or DOCX file." })
      return
    }
    if (file.size > MAX_RESUME_SIZE_BYTES) {
      pushToast({ tone: "error", title: "File too large", description: "Maximum file size is 5 MB." })
      return
    }

    setUploadFileName(file.name)
    setUploadProgress(0)
    setUploadError(null)
    setUploadedAtsScore(null)
    setUploadPhase("uploading")

    const formData = new FormData()
    formData.append("file", file)

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100))
      }
    })

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText) as { resumeId?: string; id?: string; resume?: { id?: string } }
        const resumeId = data.resumeId ?? data.id ?? data.resume?.id
        if (resumeId) {
          setUploadPhase("processing")
          setUploadProgress(100)
          void pollUploadStatus(resumeId)
        } else {
          setUploadError("Upload succeeded but no resume ID was returned.")
          setUploadPhase("error")
        }
      } else {
        const body = (() => { try { return JSON.parse(xhr.responseText) as { error?: string } } catch { return {} } })()
        setUploadError((body as { error?: string }).error ?? "Upload failed. Please try again.")
        setUploadPhase("error")
      }
    })

    xhr.addEventListener("error", () => {
      setUploadError("Network error. Please check your connection and try again.")
      setUploadPhase("error")
    })

    xhr.addEventListener("abort", () => {
      setUploadPhase("idle")
    })

    xhr.open("POST", "/api/resume/upload")
    xhr.withCredentials = true
    xhr.send(formData)
  }

  useEffect(() => {
    void refresh()
    void loadLibraryResumes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  useEffect(() => {
    function syncHandoff() {
      setHandoffResumes(readResumeHandoff())
      void loadLibraryResumes()
    }

    syncHandoff()
    window.addEventListener(RESUME_HANDOFF_EVENT, syncHandoff)
    window.addEventListener("storage", syncHandoff)
    return () => {
      window.removeEventListener(RESUME_HANDOFF_EVENT, syncHandoff)
      window.removeEventListener("storage", syncHandoff)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visibleResumes = useMemo(() => {
    const byId = new Map<string, Resume>()
    for (const resume of handoffResumes) byId.set(resume.id, resume)
    for (const resume of resumes) byId.set(resume.id, resume)
    for (const resume of apiResumes) byId.set(resume.id, resume)
    return Array.from(byId.values())
  }, [apiResumes, handoffResumes, resumes])

  const enriched = useMemo(() => {
    return visibleResumes.map((resume) => ({
      resume,
      status: hubData.resumeMeta[resume.id]?.status ?? deriveStatus(resume),
      name: resume.name ?? resume.file_name,
      role: hubData.resumeMeta[resume.id]?.linkedJobTitle ?? resume.primary_role ?? "Role not detected",
      matchScore: hubData.resumeMeta[resume.id]?.matchScore ?? null,
      atsScore: resume.ats_score ?? resume.resume_score,
      updated: fmtDate(resume.updated_at),
    }))
  }, [hubData.resumeMeta, visibleResumes])

  const counts = useMemo(
    () => ({
      all: enriched.length,
      active: enriched.filter((item) => item.status === "active").length,
      draft: enriched.filter((item) => item.status === "draft").length,
      tailored: enriched.filter((item) => item.status === "tailored").length,
      archived: enriched.filter((item) => item.status === "archived").length,
    }),
    [enriched]
  )

  const filtered = useMemo(() => {
    let result = filter === "all" ? [...enriched] : enriched.filter((item) => item.status === filter)
    const q = search.trim().toLowerCase()
    if (q) {
      result = result.filter((item) => item.name.toLowerCase().includes(q) || item.role.toLowerCase().includes(q))
    }
    result.sort((a, b) => {
      if (sort === "ats") return (b.atsScore ?? -1) - (a.atsScore ?? -1)
      if (sort === "match") return (b.matchScore ?? -1) - (a.matchScore ?? -1)
      const diff = new Date(b.resume.updated_at).getTime() - new Date(a.resume.updated_at).getTime()
      return sort === "latest" ? diff : -diff
    })
    return result
  }, [enriched, filter, search, sort])

  async function handleSetPrimary(id: string) {
    setPendingId(id)
    const res = await fetch(`/api/resume/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_primary: true }),
    })
    setPendingId(null)
    if (!res.ok) {
      pushToast({ tone: "error", title: "Could not update primary resume" })
      return
    }
    await refresh()
    await refreshHubData()
    await loadLibraryResumes()
    pushToast({ tone: "success", title: "Primary resume updated" })
  }

  async function handleArchive(resume: Resume, archived: boolean) {
    setPendingId(resume.id)
    const res = await fetch(`/api/resume/${resume.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    })
    setPendingId(null)
    if (!res.ok) {
      pushToast({ tone: "error", title: archived ? "Could not archive resume" : "Could not restore resume" })
      return
    }
    const updated = (await res.json()) as Resume
    setApiResumes((current) => current.map((item) => (item.id === resume.id ? updated : item)))
    await refresh()
    await refreshHubData()
    await loadLibraryResumes()
    pushToast({ tone: "success", title: archived ? "Resume archived" : "Resume restored" })
  }

  async function handleDuplicate(resume: Resume) {
    setPendingId(resume.id)
    const res = await fetch(`/api/resume/${resume.id}/duplicate`, { method: "POST" })
    setPendingId(null)
    if (!res.ok) {
      pushToast({ tone: "error", title: "Could not duplicate resume" })
      return
    }
    const data = (await res.json()) as { resume: Resume }
    setApiResumes((current) => [data.resume, ...current])
    await refresh()
    await refreshHubData()
    await loadLibraryResumes()
    pushToast({ tone: "success", title: "Resume duplicated" })
  }

  async function handleCreateVersion(resume: Resume) {
    setPendingId(resume.id)
    const res = await fetch(`/api/resume/${resume.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${resume.name ?? resume.file_name} snapshot`,
        changes_summary: "Created from the resume library.",
      }),
    })
    setPendingId(null)
    if (!res.ok) {
      pushToast({ tone: "error", title: "Could not create version" })
      return
    }
    await refreshHubData()
    pushToast({ tone: "success", title: "New version created" })
  }

  async function handleDelete(resume: Resume) {
    if (!window.confirm(`Delete "${resume.name ?? resume.file_name}"?`)) return
    setPendingId(resume.id)
    const res = await fetch(`/api/resume/${resume.id}`, { method: "DELETE" })
    setPendingId(null)
    if (!res.ok) {
      pushToast({ tone: "error", title: "Could not delete resume" })
      return
    }
    removeResume(resume.id)
    removeResumeHandoff(resume.id)
    setApiResumes((current) => current.filter((item) => item.id !== resume.id))
    await refresh()
    await refreshHubData()
    await loadLibraryResumes()
    pushToast({ tone: "success", title: "Resume deleted" })
  }

  async function handleView(resume: Resume) {
    const res = await fetch(`/api/resume/${resume.id}`, { cache: "no-store" })
    if (!res.ok) {
      pushToast({ tone: "error", title: "Could not open resume" })
      return
    }
    const data = (await res.json()) as Resume & { download_url?: string }
    const url = data.download_url ?? data.file_url
    if (!url) {
      pushToast({ tone: "error", title: "Resume file is not available" })
      return
    }
    window.open(url, "_blank", "noopener,noreferrer")
  }

  async function handleDownload(resume: Resume) {
    const res = await fetch(`/api/resume/${resume.id}`, { cache: "no-store" })
    if (!res.ok) {
      pushToast({ tone: "error", title: "Could not prepare download" })
      return
    }
    const data = (await res.json()) as Resume & { download_url?: string }
    const url = data.download_url ?? data.file_url
    if (!url) {
      pushToast({ tone: "error", title: "Resume file is not available" })
      return
    }
    const link = document.createElement("a")
    link.href = url
    link.download = resume.file_name
    link.rel = "noopener noreferrer"
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <main className="min-h-[calc(100vh-8.5rem)] bg-[#FAFBFF]">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleFileSelected}
      />

      <div className="w-full max-w-none space-y-3 px-4 py-3 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-slate-950">Resume Library</h1>
            <p className="mt-1 text-[13px] text-slate-500">Manage all your resumes in one place</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={triggerUpload}
              disabled={uploadPhase !== "idle"}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#5B4DFF] px-4 text-[13px] font-semibold text-white transition hover:bg-[#493EE6] disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              New Resume
            </button>
          </div>
        </div>


        {topSlot}

        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search resumes by name, role or keyword..."
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#5B4DFF] focus:ring-2 focus:ring-[#5B4DFF]/10"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <FilterChip
                  key={item.value}
                  label={item.label}
                  count={counts[item.value]}
                  active={filter === item.value}
                  onClick={() => setFilter(item.value)}
                />
              ))}
            </div>

            <label className="relative inline-flex h-9 items-center">
              <span className="sr-only">Sort resumes</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortValue)}
                className="h-9 appearance-none rounded-lg border border-slate-200 bg-white py-0 pl-3 pr-8 text-[12px] font-semibold text-slate-700 outline-none transition hover:bg-slate-50 focus:border-[#5B4DFF] focus:ring-2 focus:ring-[#5B4DFF]/10"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    Sort: {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-slate-500" />
            </label>
          </div>
        </div>

        {isLoading || isFetchingLibrary ? (
          <div className="h-[520px] animate-pulse rounded-2xl bg-slate-100" />
        ) : filtered.length === 0 ? (
          <EmptyState hasFilter={filter !== "all" || search.trim().length > 0} />
        ) : (
          <div className="w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid min-w-[1320px] grid-cols-[minmax(340px,2fr)_minmax(190px,1fr)_120px_130px_170px_120px_250px] items-center border-b border-slate-100 bg-white px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
              <div>Resume</div>
              <div>Target Role</div>
              <div className="text-center">ATS Score</div>
              <div className="text-center">Match Score</div>
              <div>Last Updated</div>
              <div>Status</div>
              <div className="text-right">Actions</div>
            </div>

            <div className="divide-y divide-slate-100">
              {filtered.map(({ resume, status, name, role, matchScore, atsScore, updated }) => (
                <div
                  key={resume.id}
                  className="grid min-w-[1320px] grid-cols-[minmax(340px,2fr)_minmax(190px,1fr)_120px_130px_170px_120px_250px] items-center px-5 py-3 transition hover:bg-slate-50/80"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <ResumeThumb resume={resume} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[13px] font-bold text-slate-950">{name}</p>
                        {resume.is_primary && <Star className="h-3.5 w-3.5 shrink-0 fill-[#5B4DFF] text-[#5B4DFF]" />}
                      </div>
                      <p className="mt-1 truncate text-[12px] text-slate-500">{role}</p>
                    </div>
                  </div>

                  <div className="truncate text-[12px] font-medium text-slate-600">{role}</div>

                  <div className="flex justify-center">
                    <ScoreCircle score={atsScore} tone="ats" />
                  </div>

                  <div className="flex justify-center">
                    <ScoreCircle score={matchScore} tone="match" />
                  </div>

                  <div className="text-[12px] text-slate-600">
                    <p>{updated.date}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{updated.time}</p>
                  </div>

                  <div>
                    <StatusPill status={status} />
                  </div>

                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={pendingId === resume.id}
                      onClick={() => void handleView(resume)}
                      className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-[#5B4DFF] disabled:opacity-40"
                      title="View resume"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <Link
                      href={`/dashboard/resume/studio?mode=preview&resumeId=${resume.id}`}
                      className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-[#5B4DFF]"
                      title="Edit resume"
                    >
                      <Edit3 className="h-4 w-4" />
                    </Link>
                    <button
                      type="button"
                      disabled={pendingId === resume.id}
                      onClick={() => void handleDownload(resume)}
                      className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-[#5B4DFF] disabled:opacity-40"
                      title="Download resume"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <details className="relative">
                      <summary
                        className={cn(
                          "flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-[#5B4DFF]",
                          pendingId === resume.id && "pointer-events-none opacity-40"
                        )}
                        title="More actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </summary>
                      <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 text-left shadow-lg">
                        <button
                          type="button"
                          onClick={() => void handleDuplicate(resume)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Duplicate resume
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSetPrimary(resume.id)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Star className="h-3.5 w-3.5" />
                          Set active resume
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleArchive(resume, status !== "archived")}
                          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Archive className="h-3.5 w-3.5" />
                          {status === "archived" ? "Restore resume" : "Archive resume"}
                        </button>
                        <Link
                          href={`/dashboard/resume/studio?mode=tailor&resumeId=${resume.id}`}
                          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Tailor resume
                        </Link>
                        <button
                          type="button"
                          onClick={() => void handleCreateVersion(resume)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <FilePlus2 className="h-3.5 w-3.5" />
                          Create new version
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(resume)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete resume
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              ))}
            </div>

            <div className="min-w-[1320px] flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <p className="text-[12px] text-slate-500">
                Showing 1 to {filtered.length} of {visibleResumes.length} resumes
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-300"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-[#5B4DFF] text-[12px] font-semibold text-white"
                >
                  1
                </button>
                <button
                  type="button"
                  disabled
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-300"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Full-page dimmed upload overlay */}
      {uploadPhase !== "idle" && (
        <div className="animate-fade-in-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="relative mx-4 w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">

            {/* Loading state */}
            {(uploadPhase === "uploading" || uploadPhase === "processing") && (
              <div className="flex flex-col items-center gap-5 text-center">
                {/* Spinning ring */}
                <div className="relative flex h-20 w-20 items-center justify-center">
                  <svg className="absolute inset-0 h-full w-full animate-spin" viewBox="0 0 80 80" fill="none">
                    <circle cx="40" cy="40" r="34" stroke="#E0E7FF" strokeWidth="6" />
                    <path
                      d="M40 6 a34 34 0 0 1 34 34"
                      stroke="#5B4DFF"
                      strokeWidth="6"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
                    {uploadPhase === "uploading"
                      ? <Upload className="h-5 w-5 text-[#5B4DFF]" />
                      : <Sparkles className="h-5 w-5 animate-pulse text-[#5B4DFF]" />
                    }
                  </div>
                </div>

                <div>
                  <p className="text-[15px] font-semibold text-slate-800">
                    {uploadPhase === "uploading" ? "Uploading your resume…" : "Reading your resume…"}
                  </p>
                  <p className="mt-1 max-w-[220px] text-[13px] text-slate-500">
                    {uploadPhase === "uploading"
                      ? `${uploadProgress}% — hang tight`
                      : "Our AI is scanning and parsing your file"}
                  </p>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  {uploadPhase === "uploading" ? (
                    <div
                      className="h-full rounded-full bg-[#5B4DFF] transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  ) : (
                    <div className="h-full w-full animate-[shimmer_1.6s_linear_infinite] rounded-full bg-gradient-to-r from-indigo-200 via-[#5B4DFF] to-indigo-200 bg-[length:200%_100%]" />
                  )}
                </div>

                {uploadPhase === "uploading" && (
                  <button
                    type="button"
                    onClick={cancelUpload}
                    className="text-[12px] font-medium text-slate-400 hover:text-slate-600"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}

            {/* Done state */}
            {uploadPhase === "done" && (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                </div>
                <div>
                  <p className="text-[16px] font-semibold text-slate-800">Resume uploaded!</p>
                  <p className="mt-1 text-[13px] text-slate-500">
                    {uploadedAtsScore != null
                      ? `ATS score: ${uploadedAtsScore}/100 — it&apos;s in your library.`
                      : "It's now in your resume library."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUploadPhase("idle")}
                  className="mt-1 w-full rounded-xl bg-[#5B4DFF] px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#493EE6]"
                >
                  Done
                </button>
              </div>
            )}

            {/* Error state */}
            {uploadPhase === "error" && (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-50">
                  <X className="h-10 w-10 text-red-500" />
                </div>
                <div>
                  <p className="text-[16px] font-semibold text-slate-800">Upload failed</p>
                  <p className="mt-1 text-[13px] text-slate-500">{uploadError ?? "Please try again."}</p>
                </div>
                <div className="mt-1 flex w-full gap-2">
                  <button
                    type="button"
                    onClick={() => setUploadPhase("idle")}
                    className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => { setUploadPhase("idle"); triggerUpload() }}
                    className="flex-1 rounded-xl bg-[#5B4DFF] px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#493EE6]"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

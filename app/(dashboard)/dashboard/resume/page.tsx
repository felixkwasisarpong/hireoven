"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  BarChart3,
  BarChart4,
  BrainCircuit,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Edit3,
  Eye,
  FileText,
  Globe2,
  History,
  Layers,
  Lightbulb,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Shield,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Trophy,
  Upload,
  Wand2,
  Zap,
} from "lucide-react"

import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useToast } from "@/components/ui/ToastProvider"
import { publishLocalNotification } from "@/lib/hooks/useNotifications"
import { writeResumeHandoff } from "@/lib/resume/local-resume-handoff"
import {
  MAX_RESUME_SIZE_BYTES,
  isResumeFilename,
  isResumeMimeType,
} from "@/lib/resume/constants"
import { buildResumeScoreBreakdown as buildDetailedResumeScoreBreakdown } from "@/lib/resume/hub"
import { buildResumeScoreBreakdown, buildResumeSnapshot } from "@/lib/resume/scoring"
import { useResumeHubData } from "@/lib/resume/use-resume-hub-data"
import { cn } from "@/lib/utils"

import type { Resume, ResumeSnapshot, ResumeVersion } from "@/types"
import type { ResumeStatus } from "@/types/resume-hub"

/** Hub tab ids for in-page state, Quick Actions, and `?tab=` deep links. Primary nav is `ResumeSubNav` in the layout. */
type TabId = "overview" | "library" | "generate" | "edit" | "tailor"

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function scoreColor(score: number | null) {
  const v = score ?? 0
  if (v >= 71) return { text: "text-emerald-600", ring: "#10B981", label: "Excellent" }
  if (v >= 41) return { text: "text-amber-600",   ring: "#F59E0B", label: "Good"      }
  return             { text: "text-red-500",       ring: "#EF4444", label: "Needs work"}
}

function deriveStatus(resume: Resume): ResumeStatus {
  if (resume.is_primary) return "active"
  if (resume.parse_status !== "complete") return "draft"
  return "draft"
}

const STATUS_META: Record<ResumeStatus, { label: string; dot: string; text: string; bg: string; border: string }> = {
  active:   { label: "Active",   dot: "bg-blue-500",   text: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-200"   },
  draft:    { label: "Draft",    dot: "bg-slate-400",  text: "text-slate-600",  bg: "bg-slate-100", border: "border-slate-200"  },
  tailored: { label: "Tailored", dot: "bg-violet-500", text: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200" },
  archived: { label: "Archived", dot: "bg-slate-300",  text: "text-slate-400",  bg: "bg-slate-50",  border: "border-slate-200"  },
}

// Score donut (reused across tabs)
function ScoreDonut({
  score,
  size = 80,
  strokeWidth = 7,
}: {
  score: number | null
  size?: number
  strokeWidth?: number
}) {
  const v = score ?? 0
  const c = scoreColor(v)
  const r = size / 2 - strokeWidth
  const circ = 2 * Math.PI * r
  const dash = (Math.min(100, v) / 100) * circ

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="-rotate-90 absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={c.ring} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <div className="flex flex-col items-center leading-none">
        <span className={cn("font-bold tabular-nums", c.text, size >= 72 ? "text-xl" : "text-[13px]")}>
          {score ?? "–"}
        </span>
        {size >= 72 && (
          <span className={cn("mt-0.5 text-[11px] font-semibold", c.text)}>{c.label}</span>
        )}
      </div>
    </div>
  )
}

// Mini donut for table rows
function MiniDonut({ score }: { score: number | null }) {
  const v = score ?? 0
  const c = scoreColor(v)
  const r = 16
  const circ = 2 * Math.PI * r
  const dash = (Math.min(100, v) / 100) * circ

  return (
    <div className="relative flex h-10 w-10 items-center justify-center">
      <svg className="-rotate-90 absolute inset-0" width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="#E2E8F0" strokeWidth="3.5" />
        <circle cx="20" cy="20" r={r} fill="none" stroke={c.ring} strokeWidth="3.5"
          strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} />
      </svg>
      <span className={cn("text-[11px] font-bold tabular-nums leading-none", c.text)}>
        {score ?? "–"}
      </span>
    </div>
  )
}

// Panel section heading
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[17px] font-bold text-slate-900">{children}</h2>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW PANEL
// ─────────────────────────────────────────────────────────────────────────────

function ResumePreviewThumb({ resume }: { resume: Resume }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const title = resume.full_name ?? resume.name ?? resume.file_name
  const role = resume.primary_role ?? "Resume"
  const summary = resume.summary ?? resume.raw_text?.split(/\s+/).slice(0, 18).join(" ") ?? "Parsed resume preview"
  const skills = (resume.top_skills ?? []).slice(0, 3)
  const canRenderFile = Boolean(resume.storage_path && resume.file_type !== "generated")
  const isPdf = /pdf/i.test(resume.file_type ?? resume.file_name)

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
    <div className="h-[132px] w-[104px] overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      {previewUrl && isPdf ? (
        <iframe
          title={`${title} preview`}
          src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&page=1&zoom=55`}
          className="h-full w-full rounded border border-slate-100 bg-white"
        />
      ) : (
      <div className="h-full overflow-hidden rounded border border-slate-100 bg-slate-50 px-2 py-2">
        <p className="truncate text-[7px] font-bold uppercase tracking-wide text-slate-700">{title}</p>
        <p className="mt-0.5 truncate text-[6px] font-medium text-[#5B4DFF]">{role}</p>
        <div className="mt-2 space-y-1">
          {summary.split(/\s+/).slice(0, 10).map((word, index) => (
            <div
              key={`${word}-${index}`}
              className={cn("h-1 rounded bg-slate-200", index % 3 === 0 ? "w-full" : index % 3 === 1 ? "w-10/12" : "w-8/12")}
            />
          ))}
        </div>
        <div className="mt-3 space-y-1">
          <div className="h-1 w-7/12 rounded bg-slate-300" />
          {(skills.length ? skills : ["Skills", "Experience", "Projects"]).map((skill) => (
            <p key={skill} className="truncate text-[6px] leading-none text-slate-500">{skill}</p>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}

function StatIconCircle({
  icon: Icon,
  iconClass,
  bgClass,
}: {
  icon: React.ElementType
  iconClass: string
  bgClass: string
}) {
  return (
    <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full", bgClass)}>
      <Icon className={cn("h-6 w-6", iconClass)} />
    </div>
  )
}

function formatShortDateTime(value: string | null | undefined) {
  if (!value) return { date: "Not updated", time: "–", compact: "Not updated" }
  const date = new Date(value)
  const dateText = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  const timeText = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  return { date: dateText, time: timeText, compact: `${dateText}, ${timeText}` }
}

function scoreCaption(score: number | null, good: string, empty: string) {
  if (score == null) return empty
  if (score >= 80) return good
  if (score >= 60) return "Good baseline. Review the next recommended fix."
  return "Needs attention. Start with the lowest scoring area."
}

function validateResumeUpload(file: File) {
  if ((!isResumeMimeType(file.type) && !isResumeFilename(file.name)) || file.size > MAX_RESUME_SIZE_BYTES) {
    return "Upload a PDF or DOCX resume that is 5MB or smaller."
  }

  return null
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

type UploadStatusResponse = {
  parse_status: Resume["parse_status"]
  parse_error?: string | null
  resume_score?: number | null
  ats_score?: number | null
}

function ResumeUploadAction({
  children,
  className,
  onUploaded,
}: {
  children: React.ReactNode
  className: string
  onUploaded?: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { upsertResume, refresh } = useResumeContext()
  const { pushToast } = useToast()
  const [uploadPhase, setUploadPhase] = useState<"idle" | "uploading" | "processing">("idle")

  async function pollResumeStatus(resumeId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const statusResponse = await fetch(`/api/resume/${resumeId}/status`, { cache: "no-store" })
      if (statusResponse.ok) {
        const status = (await statusResponse.json()) as UploadStatusResponse

        if (status.parse_status === "complete") {
          const resumeResponse = await fetch(`/api/resume/${resumeId}`, { cache: "no-store" })
          if (resumeResponse.ok) {
            upsertResume((await resumeResponse.json()) as Resume)
          }
          await refresh()
          window.dispatchEvent(new Event("hireoven:resumes-changed"))
          pushToast({
            tone: "success",
            title: "Resume parsed",
            description: status.ats_score != null
              ? `ATS score is ready: ${status.ats_score}/100.`
              : "Your resume is ready in the library.",
          })
          publishLocalNotification({
            type: "resume",
            tone: "success",
            title: "Resume parsed",
            message: status.ats_score != null
              ? `Your resume is ready. ATS score: ${status.ats_score}/100.`
              : "Your resume is ready in the library.",
            href: "/dashboard/resume/library",
          })
          return
        }

        if (status.parse_status === "failed") {
          await refresh()
          window.dispatchEvent(new Event("hireoven:resumes-changed"))
          pushToast({
            tone: "error",
            title: "Resume parsing failed",
            description: status.parse_error ?? "The file uploaded, but Hireoven could not read it.",
          })
          publishLocalNotification({
            type: "resume",
            tone: "error",
            title: "Resume parsing failed",
            message: status.parse_error ?? "The file uploaded, but Hireoven could not read it.",
            href: "/dashboard/resume/library",
          })
          return
        }
      }

      await wait(2_000)
    }

    pushToast({
      tone: "info",
      title: "Resume is still processing",
      description: "You can keep working. The library will update when parsing finishes.",
    })
    publishLocalNotification({
      type: "resume",
      tone: "info",
      title: "Resume is still processing",
      message: "You can keep working. The library will update when parsing finishes.",
      href: "/dashboard/resume/library",
    })
  }

  async function upload(file: File) {
    const validationError = validateResumeUpload(file)
    if (validationError) {
      pushToast({ tone: "error", title: "Resume upload blocked", description: validationError })
      return
    }

    setUploadPhase("uploading")
    try {
      const formData = new FormData()
      formData.append("file", file)

      const uploadResponse = await fetch("/api/resume/upload", {
        method: "POST",
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as { resume?: Resume; resumeId?: string; error?: string }

      if (!uploadResponse.ok || !uploadBody.resumeId) {
        throw new Error(uploadBody.error ?? "Upload failed")
      }

      let resume = uploadBody.resume
      if (!resume) {
        const resumeResponse = await fetch(`/api/resume/${uploadBody.resumeId}`, { cache: "no-store" })
        if (!resumeResponse.ok) throw new Error("Resume uploaded, but the parsed record could not be loaded")
        resume = (await resumeResponse.json()) as Resume
      }
      upsertResume(resume)
      writeResumeHandoff(resume)
      setUploadPhase("processing")
      pushToast({
        tone: "info",
        title: "Resume uploaded",
        description: "Hireoven is parsing it now. We’ll let you know when the scores are ready.",
      })
      publishLocalNotification({
        type: "resume",
        tone: "info",
        title: "Resume upload started",
        message: `${resume.name ?? resume.file_name} is being parsed. Scores will appear when it is ready.`,
        href: "/dashboard/resume/library",
      })
      await refresh()
      window.dispatchEvent(new Event("hireoven:resumes-changed"))
      onUploaded?.()
      await pollResumeStatus(resume.id)
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Could not upload resume",
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setUploadPhase("idle")
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
      />
      <button
        type="button"
        disabled={uploadPhase !== "idle"}
        onClick={() => inputRef.current?.click()}
        className={className}
      >
        {uploadPhase !== "idle" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{uploadPhase === "uploading" ? "Uploading..." : "Parsing..."}</span>
          </>
        ) : children}
      </button>
    </>
  )
}

function SaveResumeVersionAction({
  children,
  className,
  currentVersionCount,
  onSaved,
}: {
  children: React.ReactNode
  className: string
  currentVersionCount: number
  onSaved?: () => void | Promise<void>
}) {
  const { primaryResume } = useResumeContext()
  const { pushToast } = useToast()
  const [isSaving, setIsSaving] = useState(false)

  async function saveVersion() {
    if (!primaryResume) {
      pushToast({ tone: "error", title: "Upload a resume first" })
      return
    }

    setIsSaving(true)
    try {
      const nextVersionNumber = currentVersionCount + 1
      const response = await fetch(`/api/resume/${primaryResume.id}/versions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_number: nextVersionNumber,
          name: `Version ${nextVersionNumber}`,
          file_url: null,
          snapshot: buildResumeSnapshot(primaryResume),
          changes_summary: "Saved from resume overview.",
        }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) {
        throw new Error(body.error ?? "Could not save version")
      }

      await onSaved?.()
      pushToast({ tone: "success", title: "Resume version saved" })
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Could not save version",
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <button
      type="button"
      disabled={isSaving}
      onClick={() => void saveVersion()}
      className={className}
    >
      {isSaving ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </>
      ) : children}
    </button>
  )
}

function ViewResumeAction({
  resume,
  className,
  children,
}: {
  resume: Resume
  className: string
  children: React.ReactNode
}) {
  const { pushToast } = useToast()
  const [isOpening, setIsOpening] = useState(false)

  async function openResume() {
    setIsOpening(true)
    try {
      const response = await fetch(`/api/resume/${resume.id}`, { cache: "no-store" })
      if (!response.ok) throw new Error("Could not load resume file")
      const data = (await response.json()) as Resume & { download_url?: string }
      const url = data.download_url ?? data.file_url
      if (!url) throw new Error("This resume does not have a file preview yet")
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Could not open resume",
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setIsOpening(false)
    }
  }

  return (
    <button
      type="button"
      disabled={isOpening}
      onClick={() => void openResume()}
      className={className}
    >
      {isOpening ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening...
        </>
      ) : children}
    </button>
  )
}

function CleanOverviewPanel({ onTabChange }: { onTabChange: (tab: TabId) => void }) {
  const { primaryResume, resumes, hasResume, isLoading } = useResumeContext()
  const { data: hubData, refresh: refreshHubData } = useResumeHubData()

  const breakdown = useMemo(() => {
    if (!primaryResume || primaryResume.parse_status !== "complete") return null
    return buildResumeScoreBreakdown(primaryResume)
  }, [primaryResume])

  const detailedScore = useMemo(() => {
    if (!primaryResume || primaryResume.parse_status !== "complete") return null
    return buildDetailedResumeScoreBreakdown(primaryResume)
  }, [primaryResume])

  const meta = primaryResume ? hubData.resumeMeta[primaryResume.id] : null
  const atsScore = detailedScore?.atsReadability ?? primaryResume?.ats_score ?? null
  const completion = breakdown
    ? Math.round(Math.min(100, (breakdown.completeness / 30) * 100 * 1.35))
    : (primaryResume?.resume_score ?? null)
  const matchScore = meta?.matchScore ?? null
  const versionCount = meta?.versionCount ?? resumes.length
  const resumeName = primaryResume?.name ?? primaryResume?.file_name ?? "Untitled resume"
  const role = primaryResume?.primary_role ?? "Role not detected"
  const updated = formatShortDateTime(primaryResume?.updated_at)
  const recentEdits = primaryResume
    ? hubData.recentEdits.filter((edit) => edit.resumeId === primaryResume.id)
    : hubData.recentEdits
  const profile = hubData.profile

  const isSTEM = (primaryResume?.top_skills ?? []).some((skill) =>
    /python|java|machine learning|data|engineer|science|math|statistics/i.test(skill)
  )

  const intlChecks = [
    {
      label: "International profile",
      badge: profile?.isInternational ? "Enabled" : "Not set",
      color: profile?.isInternational ? "text-emerald-600" : "text-slate-500",
      icon: Globe2,
    },
    {
      label: "Sponsorship requirement",
      badge: profile?.needsSponsorship ? "Needed" : "Not marked",
      color: profile?.needsSponsorship ? "text-amber-600" : "text-emerald-600",
      icon: Shield,
    },
    {
      label: "Visa status",
      badge: profile?.visaStatus ? profile.visaStatus.replace(/_/g, " ") : "Not set",
      color: profile?.visaStatus ? "text-[#5B4DFF]" : "text-slate-500",
      icon: FileText,
    },
    {
      label: "STEM resume signals",
      badge: isSTEM ? "Detected" : "Not detected",
      color: isSTEM ? "text-emerald-600" : "text-amber-600",
      icon: Target,
    },
    {
      label: "OPT end date",
      badge: profile?.optEndDate ? formatShortDateTime(profile.optEndDate).date : "Not set",
      color: profile?.optEndDate ? "text-[#5B4DFF]" : "text-slate-500",
      icon: Lightbulb,
    },
  ]

  if (isLoading) {
    return <div className="h-[460px] animate-pulse rounded-2xl bg-slate-100" />
  }

  if (!hasResume) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
          <FileText className="h-6 w-6" />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-slate-800">No resume uploaded yet</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
          Upload your resume or generate one with AI to unlock scoring, tailoring, and version tracking.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ResumeUploadAction
            onUploaded={() => onTabChange("library")}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className="h-4 w-4 text-[#5B4DFF]" />
            Upload Resume
          </ResumeUploadAction>
          <button
            type="button"
            onClick={() => onTabChange("generate")}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#5B4DFF] px-4 text-[13px] font-semibold text-white transition hover:bg-[#493EE6]"
          >
            <Sparkles className="h-4 w-4" />
            Generate with AI
          </button>
        </div>
      </div>
    )
  }

  if (!primaryResume) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 text-sm text-amber-950">
        <p className="font-semibold">No active resume selected</p>
        <p className="mt-1 text-amber-900/90">
          You have resumes in your account, but none is marked primary. Open the library and set one as primary, or upload a new resume.
        </p>
        <button
          type="button"
          onClick={() => onTabChange("library")}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-[13px] font-semibold text-amber-950 transition hover:bg-amber-100/50"
        >
          Go to library
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-3">
        <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="px-4 pb-3 pt-3">
            <SectionHeading>Current Active Resume</SectionHeading>
          </div>
          <div className="grid gap-4 px-4 pb-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex gap-4">
              <ResumePreviewThumb resume={primaryResume} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-[15px] font-bold text-slate-950">{resumeName}</p>
                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-600">Active</span>
                </div>

                <div className="mt-3 space-y-2 text-[13px] text-slate-500">
                  <p className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-slate-500" />
                    <span>Target Role: {role}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-slate-500" />
                    <span>Last Updated: {updated.date} · {updated.time}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-slate-500" />
                    <span>Total Versions: {versionCount}</span>
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <ViewResumeAction
                    resume={primaryResume}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#5B4DFF] px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#493EE6]"
                  >
                    <Eye className="h-4 w-4" />
                    View Resume
                  </ViewResumeAction>
                  <button
                    type="button"
                    onClick={() => onTabChange("edit")}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit Resume
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 divide-x divide-slate-100 border-l border-slate-100 pl-6">
              <div className="flex flex-col items-center justify-center text-center">
                <p className="mb-2 text-[12px] font-medium text-slate-500">Completion Score</p>
                <ScoreDonut score={completion} size={92} strokeWidth={8} />
                <p className="mt-2 text-[12px] text-slate-500">
                  {scoreCaption(completion, "Strong completion from parsed data.", "Waiting for parsed resume data.")}
                </p>
              </div>
              <div className="flex flex-col items-center justify-center text-center">
                <p className="mb-2 text-[12px] font-medium text-slate-500">ATS Readiness Score</p>
                <ScoreDonut score={atsScore} size={92} strokeWidth={8} />
                <p className="mt-2 text-[12px] text-slate-500">
                  {scoreCaption(atsScore, "Loaded from resume scoring.", "Run scoring to load ATS readiness.")}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <SectionHeading>Resume at a Glance</SectionHeading>
          <div className="mt-3 grid grid-cols-4 divide-x divide-slate-100 rounded-xl border border-slate-100 px-2 py-3">
            {[
              { icon: CheckCircle2, bg: "bg-emerald-50", ic: "text-emerald-600", value: completion != null ? `${completion}%` : "–", label: "Completion", sub: completion != null ? "Based on parsed resume data." : "Waiting for parsed resume data." },
              { icon: FileText, bg: "bg-blue-50", ic: "text-blue-600", value: atsScore != null ? `${atsScore}` : "–", suffix: atsScore != null ? "/100" : "", label: "ATS Readiness", sub: atsScore != null ? "Loaded from resume scoring." : "Run scoring to load this." },
              { icon: Target, bg: "bg-orange-50", ic: "text-orange-500", value: matchScore != null ? `${matchScore}%` : "–", label: "Match Score", sub: meta?.linkedJobTitle ?? "Tailor to a job to load this." },
              { icon: History, bg: "bg-indigo-50", ic: "text-[#5B4DFF]", value: versionCount, label: "Versions", sub: "Track and compare your progress." },
            ].map(({ icon, bg, ic, value, suffix, label, sub }) => (
              <div key={label} className="flex items-start gap-4 px-5">
                <StatIconCircle icon={icon} iconClass={ic} bgClass={bg} />
                <div>
                  <p className="text-2xl font-bold leading-none text-slate-950">
                    {value}<span className="text-sm font-medium text-slate-500">{suffix}</span>
                  </p>
                  <p className="mt-1 text-[13px] text-slate-600">{label}</p>
                  <p className="mt-2 max-w-[150px] text-[12px] leading-relaxed text-slate-500">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <SectionHeading>Recommended Next Steps</SectionHeading>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            {(
              [
                { action: "navigate" as const, tab: "tailor" as TabId, icon: Target, bg: "bg-indigo-50", ic: "text-[#5B4DFF]", title: "Tailor to a Job", desc: "Customize your resume for a specific job to increase your match score.", cta: "Tailor Now" },
                { action: "navigate" as const, tab: "edit" as TabId, icon: TrendingUp, bg: "bg-orange-50", ic: "text-orange-500", title: "Improve Impact", desc: "Add measurable results to your bullet points to stand out more.", cta: "Improve Now" },
                { action: "navigate" as const, tab: "edit" as TabId, icon: Shield, bg: "bg-emerald-50", ic: "text-emerald-600", title: "Optimize ATS", desc: "Use AI Studio to improve structure, keywords, and ATS readability.", cta: "Optimize Now" },
                { action: "save-version" as const, icon: FileText, bg: "bg-blue-50", ic: "text-blue-600", title: "Create New Version", desc: "Save a new version before major changes or applying to new roles.", cta: "New Version" },
              ] as const
            ).map((step) => {
              const Icon = step.icon
              return (
              <div key={step.title} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-full", step.bg)}>
                  <Icon className={cn("h-5 w-5", step.ic)} />
                </div>
                <p className="mt-3 text-[13px] font-semibold text-slate-900">{step.title}</p>
                <p className="mt-2 min-h-[44px] text-[12px] leading-relaxed text-slate-500">{step.desc}</p>
                {step.action === "save-version" ? (
                  <SaveResumeVersionAction
                    currentVersionCount={versionCount}
                    onSaved={refreshHubData}
                    className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-[#5B4DFF] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {step.cta}
                  </SaveResumeVersionAction>
                ) : (
                  <button
                    type="button"
                    onClick={() => onTabChange(step.tab)}
                    className="mt-3 h-8 w-full rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-[#5B4DFF] transition hover:bg-slate-50"
                  >
                    {step.cta}
                  </button>
                )}
              </div>
              )
            })}
          </div>
        </section>
      </div>

      <aside className="space-y-3">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <SectionHeading>Quick Actions</SectionHeading>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { id: "qa-preview", tab: "generate" as TabId, icon: Sparkles, bg: "bg-cyan-50", ic: "text-cyan-600", label: "Preview" },
              { id: "qa-tailor", tab: "tailor" as TabId, icon: Target, bg: "bg-red-50", ic: "text-red-500", label: "Tailor resume" },
              { id: "qa-refine", tab: "edit" as TabId, icon: Wand2, bg: "bg-orange-50", ic: "text-orange-500", label: "Refine" },
              { id: "qa-ats", tab: "edit" as TabId, icon: Shield, bg: "bg-indigo-50", ic: "text-[#5B4DFF]", label: "Optimize ATS" },
              { id: "qa-version", kind: "save-version" as const, icon: FileText, bg: "bg-blue-50", ic: "text-blue-600", label: "New Version" },
            ].map((item) => {
              const Icon = item.icon
              const content = (
                <>
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-full", item.bg)}>
                    <Icon className={cn("h-6 w-6", item.ic)} />
                  </div>
                  <span className="text-[12px] font-semibold text-slate-700">{item.label}</span>
                </>
              )

              if ("kind" in item && item.kind === "save-version") {
                return (
                  <SaveResumeVersionAction
                    key={item.id}
                    currentVersionCount={versionCount}
                    onSaved={refreshHubData}
                    className="flex h-[76px] flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-center transition hover:border-indigo-200 hover:bg-indigo-50/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {content}
                  </SaveResumeVersionAction>
                )
              }

              const { tab, label, id } = item

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onTabChange(tab)}
                  className="flex h-[76px] flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-center transition hover:border-indigo-200 hover:bg-indigo-50/20"
                >
                  {content}
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <SectionHeading>Recent AI Improvements</SectionHeading>
            <button type="button" onClick={() => onTabChange("edit")} className="text-[12px] font-semibold text-[#5B4DFF] hover:underline">
              View All
            </button>
          </div>
          <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100">
            {recentEdits.length === 0 && (
              <div className="px-3 py-4 text-[12px] text-slate-400">No AI improvements yet.</div>
            )}
            {recentEdits.map((edit) => (
              <div key={edit.label} className="flex items-center gap-3 px-3 py-3">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                <p className="min-w-0 flex-1 truncate text-[12px] text-slate-700">{edit.label}</p>
                <p className="shrink-0 text-[11px] text-slate-400">{formatShortDateTime(edit.createdAt).compact}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <SectionHeading>International Student Insights</SectionHeading>
            <Link href="/dashboard/international" className="text-[12px] font-semibold text-[#5B4DFF] hover:underline">Learn more</Link>
          </div>
          <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100">
            {intlChecks.map(({ label, badge, color, icon: Icon }) => (
              <div key={label} className="flex items-center gap-3 px-3 py-3">
                <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                <p className="min-w-0 flex-1 truncate text-[12px] text-slate-700">{label}</p>
                <span className={cn("shrink-0 text-[12px] font-semibold", color)}>{badge}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            Resume guidance only. Confirm immigration documentation questions with your DSO or attorney.
          </p>
        </section>
      </aside>
    </div>
  )
}

function OverviewPanel({ onTabChange }: { onTabChange: (tab: TabId) => void }) {
  const { primaryResume, resumes, hasResume, isLoading } = useResumeContext()
  const { data: hubData, refresh: refreshHubData } = useResumeHubData()

  const breakdown = useMemo(() => {
    if (!primaryResume || primaryResume.parse_status !== "complete") return null
    return buildResumeScoreBreakdown(primaryResume)
  }, [primaryResume])

  const meta = primaryResume ? hubData.resumeMeta[primaryResume.id] : null
  const atsScore  = primaryResume?.ats_score ?? primaryResume?.resume_score ?? null
  const completion = breakdown
    ? Math.round(Math.min(100, (breakdown.completeness / 30) * 100 * 1.35))
    : null
  const matchScore = meta?.matchScore ?? null
  const versionCount = meta?.versionCount ?? resumes.length
  const recentEdits = primaryResume
    ? hubData.recentEdits.filter((edit) => edit.resumeId === primaryResume.id)
    : hubData.recentEdits

  const isSTEM = (primaryResume?.top_skills ?? []).some((s) =>
    /python|java|machine learning|data|engineer|science|math|statistics/i.test(s)
  )
  const intlChecks = [
    { label: "Visa-friendly phrasing looks good",          ok: true,   badge: "Good",         color: "text-emerald-600" },
    { label: "Avoid unnecessary immigration details",       ok: true,   badge: "Good",         color: "text-emerald-600" },
    { label: "STEM keyword optimization",                   ok: isSTEM, badge: "Good",         color: "text-emerald-600" },
    { label: "Role-family alignment (H1B/LCA)",             ok: false,  badge: "Needs Review", color: "text-amber-600"   },
    { label: "OPT/STEM OPT documentation reminder",         ok: false,  badge: "View",         color: "text-blue-600"    },
  ]

  if (isLoading) {
    return (
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-52 animate-pulse rounded-2xl bg-slate-100" />
        </div>
        <div className="space-y-5">
          <div className="h-52 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      {/* ── Left column ── */}
      <div className="space-y-5">
        {/* Current Active Resume */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
          <div className="border-b border-slate-100 px-5 py-4">
            <SectionHeading>Current Active Resume</SectionHeading>
          </div>

          {!hasResume ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No resume uploaded yet</p>
            </div>
          ) : primaryResume ? (
            <div className="p-5">
              <div className="flex flex-col gap-5 sm:flex-row">
                {/* Resume info */}
                <div className="flex flex-1 gap-4">
                  {/* Thumbnail */}
                  <div className="flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-slate-200/80 bg-slate-50 p-1.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className={cn("h-1 rounded-full bg-slate-200", i === 0 ? "w-10" : i < 2 ? "w-8" : "w-9")} />
                    ))}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[15px] font-bold text-slate-900">
                        {primaryResume.name ?? primaryResume.file_name}
                      </p>
                      {primaryResume.is_primary && (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="mt-2 space-y-1">
                      <p className="flex items-center gap-2 text-[12.5px] text-slate-500">
                        <Target className="h-3.5 w-3.5 text-slate-400" />
                        Target Role: {primaryResume.primary_role ?? "Not detected"}
                      </p>
                      <p className="flex items-center gap-2 text-[12.5px] text-slate-500">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        Last Updated:{" "}
                        {new Date(primaryResume.updated_at).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </p>
                      <p className="flex items-center gap-2 text-[12.5px] text-slate-500">
                        <Layers className="h-3.5 w-3.5 text-slate-400" />
                        Total Versions: {versionCount}
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onTabChange("edit")}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#4F46E5] px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#4338CA]"
                      >
                        <Eye className="h-3.5 w-3.5" /> View Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => onTabChange("edit")}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 px-3.5 py-2 text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit Resume
                      </button>
                      <button type="button" className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200/90 text-slate-400 hover:bg-slate-50">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Score donuts */}
                <div className="flex shrink-0 gap-6">
                  <div className="text-center">
                    <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      Completion Score
                    </p>
                    <ScoreDonut score={completion} size={88} strokeWidth={8} />
                    <p className="mt-2 text-[11.5px] text-slate-500">
                      {(completion ?? 0) >= 80 ? "Great job! Almost perfect." : "Keep improving!"}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      ATS Readiness Score
                    </p>
                    <ScoreDonut score={atsScore} size={88} strokeWidth={8} />
                    <p className="mt-2 text-[11.5px] text-slate-500">
                      {(atsScore ?? 0) >= 80 ? "Well optimized for ATS." : "Needs optimization."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Resume at a Glance */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
          <div className="border-b border-slate-100 px-5 py-4">
            <SectionHeading>Resume at a Glance</SectionHeading>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0">
            {[
              {
                value: completion != null ? `${completion}%` : "–",
                label: "Completion",
                sub: completion != null && completion >= 80 ? "Well done! Keep it up." : "Upload a resume to score",
                ring: "#10B981",
                score: completion,
              },
              {
                value: atsScore != null ? `${atsScore}/100` : "–",
                label: "ATS Readiness",
                sub: atsScore != null && atsScore >= 70 ? "Very good optimization." : "Needs improvement",
                ring: "#3B82F6",
                score: atsScore,
              },
              {
                value: matchScore != null ? `${matchScore}%` : "–",
                label: "Match Score",
                sub: "Strong match for target roles.",
                ring: "#F59E0B",
                score: matchScore,
              },
              {
                value: versionCount,
                label: "Versions",
                sub: "Track and compare your progress.",
                ring: "#8B5CF6",
                score: null,
              },
            ].map(({ value, label, sub, ring, score }) => (
              <div key={label} className="flex flex-col items-center gap-2 px-4 py-5 text-center">
                {score != null ? (
                  <div className="relative flex h-14 w-14 items-center justify-center">
                    <svg className="-rotate-90 absolute inset-0" width="56" height="56" viewBox="0 0 56 56">
                      <circle cx="28" cy="28" r="22" fill="none" stroke="#E2E8F0" strokeWidth="5" />
                      <circle cx="28" cy="28" r="22" fill="none" stroke={ring} strokeWidth="5"
                        strokeLinecap="round"
                        strokeDasharray={`${(score / 100) * 2 * Math.PI * 22} ${2 * Math.PI * 22}`} />
                    </svg>
                    <CheckCircle2 className="h-5 w-5" style={{ color: ring }} />
                  </div>
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-violet-200 bg-violet-50">
                    <History className="h-5 w-5 text-violet-600" />
                  </div>
                )}
                <div>
                  <p className="text-xl font-bold tabular-nums text-slate-900">{value}</p>
                  <p className="text-[11.5px] font-semibold text-slate-600">{label}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recommended Next Steps */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
          <div className="border-b border-slate-100 px-5 py-4">
            <SectionHeading>Recommended Next Steps</SectionHeading>
          </div>
          <div className="grid gap-0 sm:grid-cols-4 divide-x divide-slate-100">
            {(
              [
                {
                  action: "navigate" as const,
                  tab: "tailor" as TabId,
                  icon: Target,
                  iconBg: "bg-indigo-100",
                  iconColor: "text-indigo-600",
                  title: "Tailor to a Job",
                  desc: "Customize your resume for a specific job to increase your match score.",
                  cta: "Tailor Now",
                  ctaColor: "text-indigo-600",
                },
                {
                  action: "navigate" as const,
                  tab: "edit" as TabId,
                  icon: TrendingUp,
                  iconBg: "bg-orange-100",
                  iconColor: "text-orange-600",
                  title: "Improve Impact",
                  desc: "Add measurable results to your bullet points to stand out more.",
                  cta: "Improve Now",
                  ctaColor: "text-orange-600",
                },
                {
                  action: "navigate" as const,
                  tab: "edit" as TabId,
                  icon: Shield,
                  iconBg: "bg-emerald-100",
                  iconColor: "text-emerald-600",
                  title: "Optimize ATS",
                  desc: "Use AI Studio to improve structure, keywords, and ATS readability.",
                  cta: "Optimize Now",
                  ctaColor: "text-emerald-600",
                },
                {
                  action: "save-version" as const,
                  icon: Layers,
                  iconBg: "bg-blue-100",
                  iconColor: "text-blue-600",
                  title: "Create New Version",
                  desc: "Save a new version before major changes or applying to new roles.",
                  cta: "New Version",
                  ctaColor: "text-blue-600",
                },
              ] as const
            ).map((step) => {
              const Icon = step.icon
              return (
              <div key={step.title} className="flex flex-col gap-3 p-4">
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", step.iconBg)}>
                  <Icon className={cn("h-5 w-5", step.iconColor)} />
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-semibold text-slate-800">{step.title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{step.desc}</p>
                </div>
                {step.action === "save-version" ? (
                  <SaveResumeVersionAction
                    currentVersionCount={versionCount}
                    onSaved={refreshHubData}
                    className={cn("text-left text-[12.5px] font-semibold transition hover:underline disabled:opacity-60", step.ctaColor)}
                  >
                    {step.cta}
                  </SaveResumeVersionAction>
                ) : (
                  <button
                    type="button"
                    onClick={() => onTabChange(step.tab)}
                    className={cn("text-[12.5px] font-semibold transition hover:underline text-left", step.ctaColor)}
                  >
                    {step.cta}
                  </button>
                )}
              </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Right column ── */}
      <div className="space-y-5">
        {/* Quick Actions */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
          <div className="border-b border-slate-100 px-5 py-4">
            <SectionHeading>Quick Actions</SectionHeading>
          </div>
          <div className="grid grid-cols-3 divide-x divide-y divide-slate-100">
            {[
              { id: "ov-qa-preview", tab: "generate" as TabId, icon: Sparkles,  bg: "bg-violet-50", ic: "text-violet-600", label: "Preview" },
              { id: "ov-qa-tailor", tab: "tailor"   as TabId, icon: Target,    bg: "bg-emerald-50",ic: "text-emerald-600",label: "Tailor resume"   },
              { id: "ov-qa-refine", tab: "edit"     as TabId, icon: TrendingUp,bg: "bg-orange-50", ic: "text-orange-500", label: "Refine"  },
              { id: "ov-qa-ats", tab: "edit"     as TabId, icon: Shield,    bg: "bg-amber-50",  ic: "text-amber-600",  label: "Optimize ATS" },
              { id: "ov-qa-ver", kind: "save-version" as const, icon: Layers, bg: "bg-indigo-50", ic: "text-indigo-600", label: "New Version" },
            ].map((item) => {
              const Icon = item.icon
              if ("kind" in item && item.kind === "save-version") {
                return (
                  <SaveResumeVersionAction
                    key={item.id}
                    currentVersionCount={versionCount}
                    onSaved={refreshHubData}
                    className="flex flex-col items-center gap-2 p-4 text-center transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", item.bg)}>
                      <Icon className={cn("h-5 w-5", item.ic)} />
                    </div>
                    <p className="text-[11.5px] font-medium leading-snug text-slate-700">{item.label}</p>
                  </SaveResumeVersionAction>
                )
              }
              const { id, tab, label, bg, ic } = item
              return (
              <button
                key={id}
                type="button"
                onClick={() => onTabChange(tab)}
                className="flex flex-col items-center gap-2 p-4 text-center transition hover:bg-slate-50"
              >
                <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", bg)}>
                  <Icon className={cn("h-5 w-5", ic)} />
                </div>
                <p className="text-[11.5px] font-medium leading-snug text-slate-700">{label}</p>
              </button>
              )
            })}
          </div>
        </div>

        {/* Recent AI Improvements */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <SectionHeading>Recent AI Improvements</SectionHeading>
            <button
              type="button"
              onClick={() => onTabChange("edit")}
              className="text-[12px] font-semibold text-[#4F46E5] hover:underline"
            >
              View All
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {recentEdits.length === 0 && (
              <div className="px-5 py-4 text-[13px] text-slate-400">No AI improvements yet.</div>
            )}
            {recentEdits.map((edit) => (
              <div key={edit.label} className="flex items-center gap-3 px-5 py-3">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                <p className="flex-1 text-[13px] text-slate-700">{edit.label}</p>
                <p className="shrink-0 text-[11.5px] text-slate-400">{formatShortDateTime(edit.createdAt).compact}</p>
              </div>
            ))}
          </div>
        </div>

        {/* International Student Insights */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <SectionHeading>International Student Insights</SectionHeading>
            <button type="button" className="text-[12px] font-semibold text-[#4F46E5] hover:underline">
              Learn more
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {intlChecks.map(({ label, ok, badge, color }) => (
              <div key={label} className="flex items-center gap-3 px-5 py-3">
                <div className={cn("h-2 w-2 shrink-0 rounded-full", ok ? "bg-emerald-500" : "bg-slate-300")} />
                <p className="flex-1 text-[12.5px] text-slate-700">{label}</p>
                <span className={cn("shrink-0 text-[12px] font-semibold", color)}>{badge}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 px-5 py-3">
            <p className="text-[11px] text-slate-400">
              Resume guidance only. Confirm immigration documentation questions with your DSO or attorney.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LIBRARY PANEL
// ─────────────────────────────────────────────────────────────────────────────

type LibraryFilter = "all" | ResumeStatus

function LibraryRowMenu({
  resume,
  onSetPrimary,
  onDelete,
  onDownload,
}: {
  resume: Resume
  onSetPrimary: (id: string) => void
  onDelete: (r: Resume) => void
  onDownload: (r: Resume) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-xl">
            <div className="p-1">
              <button
                type="button"
                onClick={() => { onDownload(resume); setOpen(false) }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5 text-slate-400" /> Download
              </button>
              {!resume.is_primary && (
                <>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={() => { onSetPrimary(resume.id); setOpen(false) }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                  >
                    <Star className="h-3.5 w-3.5 text-slate-400" /> Set as active
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function LibraryPanel({ onTabChange }: { onTabChange: (tab: TabId) => void }) {
  const { resumes, isLoading, refresh, removeResume } = useResumeContext()
  const { pushToast } = useToast()
  const [filter, setFilter] = useState<LibraryFilter>("all")
  const [search, setSearch] = useState("")
  const [sortDesc, setSortDesc] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const counts = useMemo(() => ({
    all:      resumes.length,
    active:   resumes.filter((r) => deriveStatus(r) === "active").length,
    draft:    resumes.filter((r) => deriveStatus(r) === "draft").length,
    tailored: resumes.filter((r) => deriveStatus(r) === "tailored").length,
    archived: resumes.filter((r) => deriveStatus(r) === "archived").length,
  }), [resumes])

  const filtered = useMemo(() => {
    let res = filter === "all" ? [...resumes] : resumes.filter((r) => deriveStatus(r) === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      res = res.filter((r) =>
        (r.name ?? r.file_name).toLowerCase().includes(q) ||
        (r.primary_role ?? "").toLowerCase().includes(q)
      )
    }
    res.sort((a, b) => {
      const diff = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      return sortDesc ? diff : -diff
    })
    return res
  }, [resumes, filter, search, sortDesc])

  async function handleSetPrimary(id: string) {
    setPendingId(id)
    const res = await fetch(`/api/resume/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_primary: true }),
    })
    setPendingId(null)
    if (!res.ok) { pushToast({ tone: "error", title: "Could not update primary resume" }); return }
    await refresh()
    pushToast({ tone: "success", title: "Primary resume updated" })
  }

  async function handleDelete(resume: Resume) {
    if (!window.confirm(`Delete "${resume.name ?? resume.file_name}"?`)) return
    setPendingId(resume.id)
    const res = await fetch(`/api/resume/${resume.id}`, { method: "DELETE" })
    setPendingId(null)
    if (!res.ok) { pushToast({ tone: "error", title: "Could not delete resume" }); return }
    removeResume(resume.id)
    await refresh()
    pushToast({ tone: "success", title: "Resume deleted" })
  }

  async function handleDownload(resume: Resume) {
    const res = await fetch(`/api/resume/${resume.id}`, { cache: "no-store" })
    if (!res.ok) { pushToast({ tone: "error", title: "Could not prepare download" }); return }
    const data = (await res.json()) as Resume & { download_url?: string }
    window.open(data.download_url ?? data.file_url, "_blank", "noopener,noreferrer")
  }

  const FILTER_TABS: { value: LibraryFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "draft", label: "Draft" },
    { value: "tailored", label: "Tailored" },
    { value: "archived", label: "Archived" },
  ]

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold text-slate-900">Resume Library</h2>
          <p className="text-[13px] text-slate-500">Manage all your resumes in one place</p>
        </div>
        <button
          type="button"
          onClick={() => onTabChange("generate")}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#4F46E5] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4338CA]"
        >
          <Plus className="h-4 w-4" /> New Resume
        </button>
      </div>

      {/* Search + sort */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resumes by name, role or keyword…"
            className="w-full rounded-xl border border-slate-200/90 bg-white py-2.5 pl-9 pr-4 text-[13px] outline-none placeholder:text-slate-400 focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5]/20"
          />
        </div>
        <button
          type="button"
          onClick={() => setSortDesc((d) => !d)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !sortDesc && "rotate-180")} />
          Sort: {sortDesc ? "Latest Updated" : "Oldest first"}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-0 overflow-x-auto border-b border-slate-200">
        {FILTER_TABS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 pb-3 pt-1 text-[13px] font-medium transition",
              filter === f.value
                ? "border-[#4F46E5] text-[#4F46E5]"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            )}
          >
            {f.label}
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
              filter === f.value ? "bg-[#4F46E5] text-white" : "bg-slate-100 text-slate-500"
            )}>
              {counts[f.value]}
            </span>
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {/* Table */}
      {!isLoading && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  {[
                    { label: "RESUME",       cls: "pl-5 pr-4 w-[28%]" },
                    { label: "TARGET ROLE",  cls: "px-4 w-[17%]"      },
                    { label: "ATS SCORE",    cls: "px-4 w-[12%]"      },
                    { label: "MATCH SCORE",  cls: "px-4 w-[12%]"      },
                    { label: "STATUS",       cls: "px-4 w-[12%]"      },
                    { label: "UPDATED",      cls: "px-4 w-[13%]"      },
                    { label: "",             cls: "px-4 pr-5 w-[6%]"  },
                  ].map((col) => (
                    <th
                      key={col.label}
                      className={cn(
                        "py-3 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400",
                        col.cls
                      )}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="flex flex-col items-center justify-center py-14 text-center">
                        <FileText className="h-8 w-8 text-slate-300" />
                        <p className="mt-3 text-[13.5px] font-medium text-slate-600">
                          {search || filter !== "all" ? "No resumes match this filter" : "Your library is empty"}
                        </p>
                        {!search && filter === "all" && (
                          <button
                            type="button"
                            onClick={() => onTabChange("generate")}
                            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#4F46E5] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#4338CA]"
                          >
                            <Plus className="h-3.5 w-3.5" /> Add resume
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((resume) => {
                    const status = deriveStatus(resume)
                    const st = STATUS_META[status]
                    const ats = resume.resume_score
                    const match = ats != null ? Math.max(0, ats - 7) : null

                    return (
                      <tr
                        key={resume.id}
                        className="group border-b border-slate-100 transition hover:bg-slate-50/60 last:border-0"
                      >
                        {/* Resume name */}
                        <td className="py-3.5 pl-5 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-slate-100 bg-slate-50 p-1.5">
                              {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="h-0.5 w-5 rounded-full bg-slate-300" />
                              ))}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold text-slate-900">
                                {resume.name ?? resume.file_name}
                              </p>
                              <p className="mt-0.5 truncate text-[11.5px] text-slate-400">
                                {resume.primary_role ?? "Role not detected"}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Target role */}
                        <td className="px-4 py-3.5">
                          <span className="text-[12.5px] text-slate-600">
                            {resume.primary_role ?? <span className="italic text-slate-300">—</span>}
                          </span>
                        </td>

                        {/* ATS score */}
                        <td className="px-4 py-3.5">
                          <MiniDonut score={ats} />
                        </td>

                        {/* Match score */}
                        <td className="px-4 py-3.5">
                          <MiniDonut score={match} />
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3.5">
                          <span className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                            st.bg, st.border, st.text
                          )}>
                            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", st.dot)} />
                            {st.label}
                          </span>
                        </td>

                        {/* Updated */}
                        <td className="px-4 py-3.5">
                          <p className="text-[12px] text-slate-500">
                            {new Date(resume.updated_at).toLocaleDateString("en-US", {
                              month: "short", day: "numeric", year: "numeric",
                            })}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            {new Date(resume.updated_at).toLocaleTimeString("en-US", {
                              hour: "numeric", minute: "2-digit",
                            })}
                          </p>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 pr-5">
                          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => onTabChange("edit")}
                              title="View"
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onTabChange("edit")}
                              title="Edit"
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <LibraryRowMenu
                              resume={resume}
                              onSetPrimary={handleSetPrimary}
                              onDelete={handleDelete}
                              onDownload={handleDownload}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      {!isLoading && resumes.length > 0 && (
        <div className="flex items-center justify-between text-[12px] text-slate-400">
          <span>
            Showing 1 to {filtered.length} of {resumes.length} resume{resumes.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-1">
            <button className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50">1</button>
            {resumes.length > 6 && (
              <button className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-500 hover:bg-slate-50">2</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STUB PANELS — link to the already-built sub-route pages
// ─────────────────────────────────────────────────────────────────────────────

function TabRedirectPanel({
  href,
  icon: Icon,
  color,
  title,
  description,
}: {
  href: string
  icon: React.ElementType
  color: string
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className={cn("flex h-16 w-16 items-center justify-center rounded-2xl", color)}>
        <Icon className="h-8 w-8 text-white" />
      </div>
      <h2 className="mt-5 text-xl font-bold text-slate-900">{title}</h2>
      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-slate-500">{description}</p>
      <Link
        href={href}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#4F46E5] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#4338CA]"
      >
        Open {title} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HUB
// ─────────────────────────────────────────────────────────────────────────────

function ResumeHubContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const VALID: TabId[] = ["overview", "library", "generate", "edit", "tailor"]
  const raw = searchParams.get("tab") as TabId | null
  const activeTab: TabId = raw && VALID.includes(raw) ? raw : "overview"

  function setTab(tab: TabId) {
    const routeByTab: Record<TabId, string> = {
      overview: "/dashboard/resume",
      library: "/dashboard/resume/library",
      generate: "/dashboard/resume/studio?mode=preview",
      edit: "/dashboard/resume/studio?mode=preview",
      tailor: "/dashboard/resume/studio?mode=tailor",
    }
    router.push(routeByTab[tab], { scroll: false })
  }

  return (
    <main className="min-h-[calc(100vh-8.5rem)] bg-[#FAFBFF]">
      <div className="w-full max-w-none space-y-3 px-4 py-3 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-slate-950">Resume Overview</h1>
            <p className="mt-1 text-sm text-slate-500">Manage your resumes and track performance</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/resume/studio?mode=preview"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <BarChart3 className="h-4 w-4 text-[#5B4DFF]" />
              Open studio
            </Link>
            <ResumeUploadAction
              onUploaded={() => setTab("library")}
              className="inline-flex items-center gap-2 rounded-xl bg-[#5B4DFF] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#493EE6] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              Upload Resume
            </ResumeUploadAction>
          </div>
        </div>
        <div>
          {activeTab === "overview" && <CleanOverviewPanel onTabChange={setTab} />}
          {activeTab === "library"  && <LibraryPanel  onTabChange={setTab} />}
          {activeTab === "generate" && (
            <TabRedirectPanel
              href="/dashboard/resume/studio?mode=preview"
              icon={Sparkles}
              color="bg-violet-500"
              title="Preview"
              description="Open the studio in preview mode to see your resume, edit sections, and export."
            />
          )}
          {activeTab === "edit" && (
            <TabRedirectPanel
              href="/dashboard/resume/studio?mode=preview"
              icon={Wand2}
              color="bg-orange-500"
              title="Refine"
              description="Polish content, structure, and keywords in the same preview workspace."
            />
          )}
          {activeTab === "tailor" && (
            <TabRedirectPanel
              href="/dashboard/resume/studio?mode=tailor"
              icon={Target}
              color="bg-emerald-500"
              title="Tailor resume"
              description="Match your resume to a job: paste a description, review fixes, and save a tailored version."
            />
          )}
        </div>
      </div>
    </main>
  )
}

export default function ResumePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[calc(100vh-8.5rem)] bg-[#FAFBFF]">
          <div className="w-full max-w-none space-y-3 px-4 py-3 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
            <div className="h-12 w-64 animate-pulse rounded-xl bg-slate-100" />
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div className="space-y-5">
                <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />
                <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
              </div>
              <div className="h-80 animate-pulse rounded-2xl bg-slate-100" />
            </div>
          </div>
        </main>
      }
    >
      <ResumeHubContent />
    </Suspense>
  )
}

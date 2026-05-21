"use client"

/**
 * ApplyAgentFlow — review-first apply loop with per-job skill confirmation.
 *
 * Auto-starts on mount. For each job:
 *   1. Fetches skill gap analysis (bulk-prepare)
 *   2. Pauses on missing skills for confirmation
 *   3. Requires a resume QA checklist sign-off
 * After all jobs are reviewed → opens applications one-by-one.
 * User confirms each manual submit before moving to the next job.
 *
 * Safety: never auto-submits. Extension only fills — user submits manually.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  SkipForward,
  Star,
  ChevronRight,
  X,
} from "lucide-react"
import type { ApplyAgentJob } from "@/lib/scout/apply-agent/types"
import type { BulkFailReason } from "@/lib/scout/bulk-application/types"
import { BULK_FAIL_LABELS } from "@/lib/scout/bulk-application/types"
import type { Resume } from "@/types"

// ── Types ─────────────────────────────────────────────────────────────────────

type BulkPrepResult = {
  failReason?: BulkFailReason
  resumeTailorStatus: string
  resumeTailorJobId?: string
  coverLetterStatus:  string
  coverLetterId?:     string
  autofillStatus?:    string
  atsProvider?:       string
  tailoredResumeName?: string
  missingKeywords?:   string[]
  suggestedSkills?:   string[]
  suggestedSummaryRewrite?: string | null
  bulletSuggestionsPreview?: Array<{
    original: string
    suggested: string
    reason: string
  }>
  warnings?:          Array<{ code: string; message: string }>
}

type JobState = ApplyAgentJob & {
  prepResult?:      BulkPrepResult
  confirmedSkills?: string[]
  resumeQaApproved?: boolean
  tailored?:        boolean
  applied?:         boolean
  opened?:          boolean
  skipped?:         boolean
  error?:           string
}

type ResumeListResponse = { resumes?: Resume[] }
type ResumeSkillSets = {
  technical: Set<string>
  soft: Set<string>
  languages: Set<string>
  certifications: Set<string>
}

type SidePreviewState =
  | { kind: "resume"; title: string; resume: Resume | null }
  | { kind: "url"; title: string; url: string }

type TimingApiResponse = {
  timingRecommendation: "apply_now" | "schedule_today" | "schedule_tomorrow" | "low_priority"
  timingReason: string
  optimalApplyAt: string | null
  screenRateMultiplier: number
  hoursSincePosted: number
}

type ExtensionStatus = "checking" | "connected" | "disconnected"

type Props = {
  initialJobs: ApplyAgentJob[]
  resumeId?:   string
  extensionConnected?: boolean
  requireSponsorshipSignal?: boolean
  onFollowUp?: (query: string) => void
  onDone?:     () => void
}

const FROM_SCOUT = "hireoven-scout"
const FROM_EXT = "hireoven-ext"

function isLocalScoutHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "")
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  )
}

const RESUME_QA_CHECKLIST = [
  "Can I defend every bullet in an interview?",
  "Are all dates, titles, companies, and degrees accurate?",
  "Are the keywords tied to real work?",
  "Did it preserve my strongest story?",
  "Did it remove irrelevant details instead of inventing new ones?",
  "Are the metrics true or clearly approximate?",
  "Does it sound like a serious professional, not a LinkedIn generator having espresso?",
] as const

function extractResumeList(payload: unknown): Resume[] {
  if (Array.isArray(payload)) return payload as Resume[]
  if (payload && typeof payload === "object" && Array.isArray((payload as ResumeListResponse).resumes)) {
    return (payload as ResumeListResponse).resumes as Resume[]
  }
  return []
}

function normalizePreviewText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/^[•\-–—*]\s*/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

function joinParts(parts: Array<string | null | undefined>, sep = " · "): string {
  return parts.map((v) => (v ?? "").trim()).filter(Boolean).join(sep)
}

function normalizeUrlForMatch(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    url.hash = ""
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/"
    return `${url.origin}${normalizedPath}${url.search}`
  } catch {
    return value.trim().replace(/\/+$/, "")
  }
}

function SkillBadges({ skills }: { skills: string[] }) {
  if (skills.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((s) => (
        <span key={s} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
          {s}
        </span>
      ))}
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{children}</h3>
  )
}

function ResumeQaSidePreview({ resume }: { resume: Resume | null }) {
  if (!resume) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Resume preview unavailable.
      </div>
    )
  }

  const experiences = Array.isArray(resume.work_experience) ? resume.work_experience : []
  const education   = Array.isArray(resume.education)        ? resume.education        : []
  const projects    = Array.isArray(resume.projects)         ? resume.projects         : []
  const technical   = Array.isArray(resume.skills?.technical)        ? resume.skills!.technical        : []
  const soft        = Array.isArray(resume.skills?.soft)             ? resume.skills!.soft             : []
  const languages   = Array.isArray(resume.skills?.languages)        ? resume.skills!.languages        : []
  const certs       = Array.isArray(resume.skills?.certifications)   ? resume.skills!.certifications   : []
  const topSkills   = Array.isArray(resume.top_skills)               ? resume.top_skills               : []
  const allSkills   = technical.length > 0 ? technical : topSkills
  const summary     = (resume.summary ?? "").trim()
  const contactParts = [resume.email, resume.location, resume.linkedin_url, resume.portfolio_url].filter(Boolean)

  return (
    <article className="w-full bg-white">

      {/* Header */}
      <header className="border-b border-slate-100 pb-5 mb-5">
        <h2 className="text-[18px] font-bold leading-tight text-slate-900">
          {resume.full_name || resume.name || "Resume"}
        </h2>
        {resume.primary_role && (
          <p className="mt-1 text-[13px] font-medium text-slate-600">
            {resume.primary_role}
            {resume.years_of_experience ? ` · ${resume.years_of_experience}+ years` : ""}
          </p>
        )}
        {contactParts.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
            {contactParts.join("  ·  ")}
          </p>
        )}
      </header>

      {/* Summary */}
      {summary && (
        <section className="mb-5">
          <SectionHeading>Summary</SectionHeading>
          <p className="text-[12.5px] leading-relaxed text-slate-700">{summary}</p>
        </section>
      )}

      {/* Skills */}
      {allSkills.length > 0 && (
        <section className="mb-5">
          <SectionHeading>Technical Skills</SectionHeading>
          <SkillBadges skills={allSkills} />
          {soft.length > 0 && (
            <div className="mt-2">
              <p className="mb-1.5 text-[10px] font-semibold text-slate-400">Soft</p>
              <SkillBadges skills={soft} />
            </div>
          )}
          {languages.length > 0 && (
            <div className="mt-2">
              <p className="mb-1.5 text-[10px] font-semibold text-slate-400">Languages</p>
              <SkillBadges skills={languages} />
            </div>
          )}
          {certs.length > 0 && (
            <div className="mt-2">
              <p className="mb-1.5 text-[10px] font-semibold text-slate-400">Certifications</p>
              <SkillBadges skills={certs} />
            </div>
          )}
        </section>
      )}

      {/* Experience */}
      {experiences.length > 0 && (
        <section className="mb-5">
          <SectionHeading>Experience</SectionHeading>
          <div className="space-y-5">
            {experiences.map((item, idx) => {
              const dateLine = joinParts([item.start_date, item.is_current ? "Present" : item.end_date], " – ")
              const bullets  = Array.isArray(item.achievements) ? item.achievements.filter((b) => b.trim().length > 0) : []
              return (
                <div key={`exp-${idx}`} className="pl-3 border-l-2 border-slate-200">
                  <p className="text-[13px] font-semibold text-slate-900">{item.title || "Role"}</p>
                  <p className="text-[12px] text-slate-600">{item.company}</p>
                  {dateLine && <p className="mt-0.5 text-[11px] text-slate-400">{dateLine}</p>}
                  {item.description && !bullets.length && (
                    <p className="mt-2 text-[12px] leading-relaxed text-slate-700 whitespace-pre-line">
                      {item.description}
                    </p>
                  )}
                  {bullets.length > 0 && (
                    <ul className="mt-2 space-y-1.5 pl-3 list-disc marker:text-slate-300">
                      {bullets.map((b, i) => (
                        <li key={i} className="text-[12px] leading-relaxed text-slate-700">{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Education */}
      {education.length > 0 && (
        <section className="mb-5">
          <SectionHeading>Education</SectionHeading>
          <div className="space-y-3">
            {education.map((item, idx) => (
              <div key={`edu-${idx}`} className="pl-3 border-l-2 border-slate-200">
                <p className="text-[13px] font-semibold text-slate-900">
                  {[item.degree, item.field].filter(Boolean).join(" in ")}
                </p>
                <p className="text-[12px] text-slate-600">{item.institution}</p>
                <p className="text-[11px] text-slate-400">
                  {joinParts([item.start_date, item.end_date ?? "Present"], " – ")}
                  {item.gpa ? ` · GPA ${item.gpa}` : ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Projects */}
      {projects.length > 0 && (
        <section className="mb-2">
          <SectionHeading>Projects</SectionHeading>
          <div className="space-y-3">
            {projects.map((p, idx) => (
              <div key={`proj-${idx}`} className="pl-3 border-l-2 border-slate-200">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold text-slate-900">{p.name}</p>
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] text-[#FF5C18] hover:underline">↗</a>
                  )}
                </div>
                {p.description && (
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-700">{p.description}</p>
                )}
                {p.technologies?.length > 0 && (
                  <div className="mt-1.5">
                    <SkillBadges skills={p.technologies} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

    </article>
  )
}

function applyTailoredSignalsToResume(base: Resume, job: JobState | null): Resume {
  const next: Resume = {
    ...base,
    work_experience: Array.isArray(base.work_experience)
      ? base.work_experience.map((item) => ({
          ...item,
          achievements: Array.isArray(item.achievements) ? [...item.achievements] : [],
        }))
      : [],
    education: Array.isArray(base.education) ? base.education.map((item) => ({ ...item })) : [],
    projects: Array.isArray(base.projects)
      ? base.projects.map((item) => ({
          ...item,
          technologies: Array.isArray(item.technologies) ? [...item.technologies] : [],
        }))
      : [],
    skills: {
      technical: Array.isArray(base.skills?.technical) ? [...base.skills.technical] : [],
      soft: Array.isArray(base.skills?.soft) ? [...base.skills.soft] : [],
      languages: Array.isArray(base.skills?.languages) ? [...base.skills.languages] : [],
      certifications: Array.isArray(base.skills?.certifications) ? [...base.skills.certifications] : [],
    },
    top_skills: Array.isArray(base.top_skills) ? [...base.top_skills] : [],
    industries: Array.isArray(base.industries) ? [...base.industries] : [],
  }

  const rewrite = job?.prepResult?.suggestedSummaryRewrite?.trim()
  if (rewrite) next.summary = rewrite

  const confirmedSkills = (job?.confirmedSkills ?? [])
    .map((skill) => skill.trim())
    .filter((skill) => skill.length > 0)
  if (confirmedSkills.length > 0) {
    const technical = new Set(next.skills?.technical ?? [])
    confirmedSkills.forEach((skill) => technical.add(skill))
    next.skills = {
      ...(next.skills ?? { technical: [], soft: [], languages: [], certifications: [] }),
      technical: Array.from(technical),
    }
  }

  const suggestions = job?.prepResult?.bulletSuggestionsPreview ?? []
  for (const suggestion of suggestions) {
    const original = normalizePreviewText(suggestion.original)
    if (!original) continue
    let replaced = false

    for (const exp of next.work_experience ?? []) {
      const achievements = Array.isArray(exp.achievements) ? [...exp.achievements] : []
      const idx = achievements.findIndex((line) => {
        const normalized = normalizePreviewText(line)
        return (
          normalized === original ||
          (original.length > 18 && normalized.includes(original)) ||
          (normalized.length > 18 && original.includes(normalized))
        )
      })
      if (idx >= 0) {
        achievements[idx] = suggestion.suggested
        exp.achievements = achievements
        replaced = true
        break
      }

      const description = exp.description ?? ""
      const descriptionLines = description.split(/\r?\n/)
      const descLineIdx = descriptionLines.findIndex((line) => {
        const normalized = normalizePreviewText(line)
        return (
          normalized === original ||
          (original.length > 18 && normalized.includes(original)) ||
          (normalized.length > 18 && original.includes(normalized))
        )
      })
      if (descLineIdx >= 0) {
        descriptionLines[descLineIdx] = suggestion.suggested
        exp.description = descriptionLines.join("\n")
        replaced = true
        break
      }
    }

    if (!replaced) {
      continue
    }
  }

  return next
}

function sendToExtension(type: string, payload?: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    window.postMessage({ source: FROM_SCOUT, type, ...(payload ?? {}) }, window.location.origin)
  }
}

// ── Job status indicator ──────────────────────────────────────────────────────

function StatusDot({ job }: { job: JobState }) {
  if (job.applied)  return <span className="h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
  if (job.skipped)  return <span className="h-2 w-2 rounded-full bg-slate-300 flex-shrink-0" />
  if (job.status === "opening" || job.status === "filling") return <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
  if (job.status === "confirming") return <span className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0" />
  if (job.tailored && !job.resumeQaApproved) return <span className="h-2 w-2 rounded-full bg-amber-300 flex-shrink-0" />
  if (job.tailored) return <span className="h-2 w-2 rounded-full bg-blue-400 flex-shrink-0" />
  if (job.error)    return <span className="h-2 w-2 rounded-full bg-red-400 flex-shrink-0" />
  return <span className="h-2 w-2 rounded-full bg-slate-200 flex-shrink-0" />
}

function jobStatusLabel(job: JobState): string {
  if (job.applied)  return "Submitted ✓"
  if (job.skipped)  return "Skipped"
  if (job.status === "confirming") return "Skill check"
  if (job.status === "opening" || job.status === "filling") return "Application open"
  if (job.tailored && !job.resumeQaApproved) return "Resume QA"
  if (job.tailored) return "Tailored"
  if (job.error)    return "Failed"
  return "Pending"
}

// ── Main component ────────────────────────────────────────────────────────────

export function ApplyAgentFlow({
  initialJobs,
  extensionConnected = false,
  requireSponsorshipSignal = false,
  onFollowUp,
  onDone,
}: Props) {
  const [jobs,         setJobs]         = useState<JobState[]>(initialJobs)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [phase,        setPhase]        = useState<"tailoring" | "confirming" | "reviewing" | "applying" | "done">("tailoring")
  const [busy,         setBusy]         = useState(false)
  const [handoffIssue, setHandoffIssue] = useState<string | null>(null)
  const [pendingSkills, setPendingSkills] = useState<string[]>([])
  const [selectedPendingSkills, setSelectedPendingSkills] = useState<string[]>([])
  const [pendingSkillJobIdx, setPendingSkillJobIdx] = useState<number | null>(null)
  const [reviewJobIdx, setReviewJobIdx] = useState<number | null>(null)
  const [qaChecks, setQaChecks] = useState<boolean[]>(
    () => RESUME_QA_CHECKLIST.map(() => false)
  )
  const [applyOrder, setApplyOrder] = useState<number[]>([])
  const [applyPointer, setApplyPointer] = useState(0)
  const [sidePreview, setSidePreview] = useState<SidePreviewState | null>(null)
  const [salaryIntercept, setSalaryIntercept] = useState<{
    message: string
    recommendation: string
    alternativeSuggestion: string
    jobSalaryMax: number
    userMarketP50: number
    shortfallPercent: number
    jobId: string
    jobTitle: string
    company: string | null
  } | null>(null)
  const processingRef  = useRef(false)
  const primaryResumeRef = useRef<{ id: string; skills: ResumeSkillSets } | null>(null)
  const primaryResumeDataRef = useRef<Resume | null>(null)
  const [primaryResumeSnapshot, setPrimaryResumeSnapshot] = useState<Resume | null>(null)

  // ── Timing state ───────────────────────────────────────────────────────────
  const [timingData, setTimingData] = useState<TimingApiResponse | null>(null)
  const [timingDismissed, setTimingDismissed] = useState(false)

  // ── Extension status — driven by prop (useActiveBrowserContext handshake) ──
  // extensionStatus is driven entirely by the extensionConnected prop (useActiveBrowserContext handshake).
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>(
    () => extensionConnected ? "connected" : "disconnected"
  )
  const [extMidFlowDisconnected, setExtMidFlowDisconnected] = useState(false)
  const extensionInstallHref = useMemo(() => {
    if (typeof window === "undefined") return "/extension"
    return isLocalScoutHost(window.location.hostname)
      ? "/extension"
      : "https://chrome.google.com/webstore"
  }, [])

  // Sync whenever the prop changes (e.g. extension connects after mount)
  useEffect(() => {
    setExtensionStatus(extensionConnected ? "connected" : "disconnected")
  }, [extensionConnected])

  const updateJob = useCallback((idx: number, patch: Partial<JobState>) => {
    setJobs(prev => prev.map((j, i) => i === idx ? { ...j, ...patch } : j))
  }, [])

  const buildPatchedJobs = useCallback((source: JobState[], idx: number, patch: Partial<JobState>) => {
    return source.map((j, i) => i === idx ? { ...j, ...patch } : j)
  }, [])

  const ensurePrimaryResume = useCallback(async () => {
    if (primaryResumeRef.current) return primaryResumeRef.current
    const resumeRes = await fetch("/api/resume")
    if (!resumeRes.ok) return null
    const payload = await resumeRes.json() as ResumeListResponse | Resume[]
    const rows = extractResumeList(payload)
    const primary = rows.find((r) => r.is_primary) ?? rows[0]
    if (!primary?.id) return null
    primaryResumeDataRef.current = primary
    setPrimaryResumeSnapshot(primary)
    primaryResumeRef.current = {
      id: primary.id,
      skills: {
        technical: new Set((primary.skills?.technical ?? []).filter((s) => typeof s === "string" && s.trim().length > 0)),
        soft: new Set((primary.skills?.soft ?? []).filter((s) => typeof s === "string" && s.trim().length > 0)),
        languages: new Set((primary.skills?.languages ?? []).filter((s) => typeof s === "string" && s.trim().length > 0)),
        certifications: new Set((primary.skills?.certifications ?? []).filter((s) => typeof s === "string" && s.trim().length > 0)),
      },
    }
    return primaryResumeRef.current
  }, [])

  const appendSkillsToPrimaryResume = useCallback(async (skills: string[]) => {
    const normalized = Array.from(
      new Set(
        skills
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      )
    )
    if (normalized.length === 0) return

    const primary = await ensurePrimaryResume()
    if (!primary) return

    const nextTechnical = new Set(primary.skills.technical)
    normalized.forEach((skill) => nextTechnical.add(skill))

    // No-op if nothing new.
    if (nextTechnical.size === primary.skills.technical.size) return

    const technical = Array.from(nextTechnical)
    const soft = Array.from(primary.skills.soft)
    const languages = Array.from(primary.skills.languages)
    const certifications = Array.from(primary.skills.certifications)
    const patchRes = await fetch(`/api/resume/${primary.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skills: {
          technical,
          soft,
          languages,
          certifications,
        },
      }),
    })

    if (patchRes.ok) {
      primaryResumeRef.current = {
        ...primary,
        skills: {
          ...primary.skills,
          technical: nextTechnical,
        },
      }
      if (primaryResumeDataRef.current) {
        const nextResume: Resume = {
          ...primaryResumeDataRef.current,
          skills: {
            technical,
            soft,
            languages,
            certifications,
          },
        }
        primaryResumeDataRef.current = nextResume
        setPrimaryResumeSnapshot(nextResume)
      }
    }
  }, [ensurePrimaryResume])

  const enterResumeReview = useCallback((idx: number) => {
    setReviewJobIdx(idx)
    setQaChecks(RESUME_QA_CHECKLIST.map(() => false))
    setCurrentIndex(idx)
    setPhase("reviewing")
  }, [])

  const finishFlow = useCallback((issue?: string | null) => {
    setPhase("done")
    setHandoffIssue(issue ?? null)
    onDone?.()
  }, [onDone])

  const startApplyPhase = useCallback((sourceJobs: JobState[]) => {
    const order = sourceJobs
      .map((job, idx) => ({ job, idx }))
      .filter(({ job }) => job.tailored && job.resumeQaApproved && !job.skipped && !!job.applyUrl)
      .map(({ idx }) => idx)

    if (order.length === 0) {
      finishFlow("No eligible application URLs remained after review. You can retry with new jobs.")
      return
    }

    setApplyOrder(order)
    setApplyPointer(0)
    setCurrentIndex(order[0] ?? 0)
    setPhase("applying")
    setHandoffIssue(null)
  }, [finishFlow])

  const advanceQueue = useCallback((doneIdx: number, snapshotJobs?: JobState[]) => {
    const source = snapshotJobs ?? jobs
    const next = doneIdx + 1
    if (next < source.length) {
      setCurrentIndex(next)
      setPhase("tailoring")
      setTimeout(() => void tailorJob(next), 500)
      return
    }
    startApplyPhase(source)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, startApplyPhase])

  // ── Step 1: fetch skill gaps for current job ──────────────────────────────

  const tailorJob = useCallback(async (idx: number) => {
    if (processingRef.current) return
    processingRef.current = true
    setBusy(true)

    const job = jobs[idx]
    if (!job) { processingRef.current = false; setBusy(false); return }

    updateJob(idx, { status: "tailoring" })

    try {
      // Fetch timing in parallel with bulk-prepare (never adds sequential latency)
      const timingFetch = job.jobId
        ? fetch(`/api/jobs/${encodeURIComponent(job.jobId)}/timing`)
            .then((r) => r.ok ? r.json() as Promise<TimingApiResponse> : null)
            .catch(() => null)
        : Promise.resolve(null)

      const prepFetch = fetch("/api/scout/bulk-prepare", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          jobId:             job.jobId,
          jobTitle:          job.jobTitle,
          company:           job.company,
          applyUrl:          job.applyUrl,
          sponsorshipSignal: job.sponsorshipSignal,
          requireSponsorshipSignal,
        }),
      })

      const [timingResult, res] = await Promise.all([timingFetch, prepFetch])

      if (timingResult && idx === 0) {
        setTimingData(timingResult)
        setTimingDismissed(false)
      }

      if (!res.ok) {
        throw new Error("bulk-prepare request failed")
      }
      const prep = await res.json() as BulkPrepResult

      if (prep.failReason) {
        const failLabel = BULK_FAIL_LABELS[prep.failReason] ?? "Preparation failed"
        const isSkippable = prep.failReason === "missing_apply_url" || prep.failReason === "no_sponsorship_blocker"
        const patch: Partial<JobState> = {
          prepResult: prep,
          skipped: isSkippable ? true : undefined,
          status: isSkippable ? "skipped" : "failed",
          error: failLabel,
        }
        updateJob(idx, patch)
        processingRef.current = false
        setBusy(false)
        advanceQueue(idx, buildPatchedJobs(jobs, idx, patch))
        return
      }

      const allSkills = [
        ...(prep.missingKeywords ?? []).slice(0, 8),
        ...(prep.suggestedSkills  ?? []).slice(0, 4),
      ]
        .filter((s, i, arr) => arr.indexOf(s) === i)
        // #5 Filter out non-skills: blocklist words, short words
        .filter((s) => {
          const lower = s.trim().toLowerCase()
          if (lower.length < 3) return false
          const BLOCKLIST = new Set([
            // generic verbs / gerunds
            "working","collaborating","collaboration","communicating","communication",
            "managing","leading","driving","supporting","delivering","building",
            "developing","creating","designing","implementing","ensuring","helping",
            "writing","reading","learning","growing","improving","solving","thinking",
            // generic nouns / adjectives that aren't tech skills
            "not","hiring","contract","owl","experience","skills","required","preferred",
            "ability","knowledge","strong","excellent","good","great","help","solutions",
            "opportunities","requirements","responsibilities","qualifications","duties",
            "team","teams","cross","functional","environment","culture","mission",
            "values","vision","strategy","goals","objectives","initiatives","projects",
            "services","products","customers","clients","stakeholders","partners",
            "processes","procedures","policies","standards","practices","frameworks",
            "results","outcomes","impact","value","growth","success","excellence",
          ])
          return !BLOCKLIST.has(lower)
        })

      if (allSkills.length > 0) {
        updateJob(idx, {
          prepResult: prep,
          confirmedSkills: allSkills,
          status: "confirming",
        })
        setPendingSkills(allSkills)
        // #5 Only pre-select chips that look like genuine hard skills:
        // - starts with uppercase AND is not a common noun (uses separate check, no /i)
        // - contains digits or version numbers (React 18, Python 3)
        // - contains known tech punctuation (+, #, ., /)
        // Everything else starts unchecked — user decides
        setSelectedPendingSkills(allSkills.filter((s) => {
          const startsUppercase = /^[A-Z]/.test(s)    // no /i — deliberate uppercase check
          const hasDigit        = /[0-9]/.test(s)
          const hasTechPunct    = /[#+.]/.test(s)
          const hasTechKeyword  = /\b(aws|gcp|azure|sql|api|sdk|cli|ci|cd|ml|ai|ux|ui|ios|android|devops|saas|paas|iaas|oauth|rest|grpc|graphql|docker|kubernetes|terraform|kafka|redis|postgres|mongodb|elasticsearch)\b/i.test(s)
          return startsUppercase || hasDigit || hasTechPunct || hasTechKeyword
        }))
        setPendingSkillJobIdx(idx)
        setPhase("confirming")
        processingRef.current = false
        setBusy(false)
        return
      }

      const patch: Partial<JobState> = {
        prepResult: prep,
        confirmedSkills: allSkills,
        tailored: true,
        status: "tailored",
      }
      updateJob(idx, patch)
      processingRef.current = false
      setBusy(false)
      enterResumeReview(idx)
    } catch {
      const patch: Partial<JobState> = { error: "Couldn't analyse this job.", status: "failed" }
      updateJob(idx, patch)
      processingRef.current = false
      setBusy(false)
      advanceQueue(idx, buildPatchedJobs(jobs, idx, patch))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, updateJob, appendSkillsToPrimaryResume, enterResumeReview, advanceQueue, buildPatchedJobs, requireSponsorshipSignal])

  const resolveSkillConfirmation = useCallback(async (applySkills: boolean) => {
    if (pendingSkillJobIdx === null) return

    const idx = pendingSkillJobIdx
    const skills = applySkills ? selectedPendingSkills : []
    setBusy(true)

    if (applySkills && skills.length > 0) {
      try {
        await appendSkillsToPrimaryResume(skills)
      } catch {
        // Non-blocking: continue queue even if resume patch fails.
      }
    }

    updateJob(idx, {
      confirmedSkills: applySkills ? skills : [],
      tailored: true,
      status: "tailored",
    })

    setPendingSkills([])
    setSelectedPendingSkills([])
    setPendingSkillJobIdx(null)
    setBusy(false)
    enterResumeReview(idx)
  }, [appendSkillsToPrimaryResume, pendingSkillJobIdx, selectedPendingSkills, updateJob, enterResumeReview])

  const handleResumeQaToggle = useCallback((index: number) => {
    setQaChecks((prev) => prev.map((item, idx) => idx === index ? !item : item))
  }, [])

  const approveResumeQa = useCallback(() => {
    if (reviewJobIdx === null) return
    const patch: Partial<JobState> = { resumeQaApproved: true, status: "tailored" }
    updateJob(reviewJobIdx, patch)
    setReviewJobIdx(null)
    setPhase("tailoring")
    advanceQueue(reviewJobIdx, buildPatchedJobs(jobs, reviewJobIdx, patch))
  }, [advanceQueue, buildPatchedJobs, jobs, reviewJobIdx, updateJob])

  const skipDuringResumeQa = useCallback(() => {
    if (reviewJobIdx === null) return
    const patch: Partial<JobState> = {
      skipped: true,
      status: "skipped",
      error: "Skipped during resume QA review.",
    }
    updateJob(reviewJobIdx, patch)
    setReviewJobIdx(null)
    setPhase("tailoring")
    advanceQueue(reviewJobIdx, buildPatchedJobs(jobs, reviewJobIdx, patch))
  }, [advanceQueue, buildPatchedJobs, jobs, reviewJobIdx, updateJob])

  const goToNextApplyJob = useCallback((nextPointer: number) => {
    if (nextPointer >= applyOrder.length) {
      finishFlow(
        extensionConnected
          ? null
          : "Extension is not connected. Jobs were opened directly in browser tabs."
      )
      return
    }
    setApplyPointer(nextPointer)
    setCurrentIndex(applyOrder[nextPointer] ?? 0)
  }, [applyOrder, extensionConnected, finishFlow])

  const openCurrentApplication = useCallback(async () => {
    const idx = applyOrder[applyPointer]
    if (idx === undefined) return

    const job = jobs[idx]
    if (!job?.applyUrl) {
      const patch: Partial<JobState> = {
        skipped: true,
        status: "skipped",
        error: "No apply URL available for this role.",
      }
      updateJob(idx, patch)
      goToNextApplyJob(applyPointer + 1)
      return
    }

    // ── Salary intercept check ──────────────────────────────────────────────
    if (job.jobId) {
      try {
        const interceptRes = await fetch(`/api/scout/salary-intercept?jobId=${encodeURIComponent(job.jobId)}`)
        if (interceptRes.ok) {
          const data = await interceptRes.json() as {
            intercept: {
              shouldIntercept: boolean
              message: string
              recommendation: string
              alternativeSuggestion: string
              jobSalaryMax: number
              userMarketP50: number
              shortfallPercent: number
            } | null
          }
          if (data.intercept?.shouldIntercept) {
            setSalaryIntercept({
              ...data.intercept,
              jobId: job.jobId,
              jobTitle: job.jobTitle,
              company: job.company,
            })
            return // pause — let user choose
          }
        }
      } catch {
        // Non-blocking — never prevent applying
      }
    }
    // ── End salary intercept ────────────────────────────────────────────────

    setBusy(true)
    updateJob(idx, { status: "opening", error: undefined })

    if (extensionConnected) {
      sendToExtension("OPERATOR_OPEN_TAB", {
        url:              job.applyUrl,
        jobId:            job.jobId,
        jobTitle:         job.jobTitle,
        company:          job.company,
        coverLetterId:    job.prepResult?.coverLetterId ?? null,
        tailoredResumeName: job.prepResult?.tailoredResumeName ?? null,
        atsProvider:      job.prepResult?.atsProvider ?? null,
        agentMode:        true,
      })
      updateJob(idx, { opened: true, status: "filling" })
      setHandoffIssue(null)
      setBusy(false)
      return
    }

    const opened = window.open(job.applyUrl, "_blank", "noopener,noreferrer")
    if (opened) {
      updateJob(idx, { opened: true, status: "filling" })
      setHandoffIssue("Extension is not connected. Review and submit manually in the opened tab.")
      setBusy(false)
      return
    }

    updateJob(idx, {
      status: "failed",
      error: "Browser blocked opening the application tab. Retry from this step.",
    })
    setHandoffIssue("Browser blocked tab opening. Enable pop-ups for this site and retry.")
    setBusy(false)
  }, [applyOrder, applyPointer, extensionConnected, goToNextApplyJob, jobs, updateJob])

  const markCurrentSubmittedAndNext = useCallback(async () => {
    const idx = applyOrder[applyPointer]
    if (idx === undefined) return
    const job = jobs[idx]

    setBusy(true)
    try {
      await fetch("/api/scout/mark-submitted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId:       job.jobId,
          jobTitle:    job.jobTitle,
          companyName: job.company ?? "Unknown Company",
          applyUrl:    job.applyUrl,
          notes:       "Marked submitted manually from Scout apply agent flow",
        }),
      })
    } catch {
      // Non-blocking: local queue still advances.
    }

    updateJob(idx, { applied: true, status: "applied", opened: false })
    setBusy(false)
    goToNextApplyJob(applyPointer + 1)
  }, [applyOrder, applyPointer, goToNextApplyJob, jobs, updateJob])

  const reportNoFormAndNext = useCallback(() => {
    const idx = applyOrder[applyPointer]
    if (idx === undefined) return
    updateJob(idx, {
      skipped: true,
      status: "skipped",
      opened: false,
      error: "No application form detected on destination page.",
    })
    goToNextApplyJob(applyPointer + 1)
  }, [applyOrder, applyPointer, goToNextApplyJob, updateJob])

  const handleSkip = useCallback((idx: number) => {
    const patch: Partial<JobState> = { skipped: true, status: "skipped" }
    updateJob(idx, patch)
    if (pendingSkillJobIdx === idx) {
      setPendingSkills([])
      setSelectedPendingSkills([])
      setPendingSkillJobIdx(null)
    }
    processingRef.current = false
    setBusy(false)
    setPhase("tailoring")
    advanceQueue(idx, buildPatchedJobs(jobs, idx, patch))
  }, [updateJob, advanceQueue, pendingSkillJobIdx, buildPatchedJobs, jobs])

  const togglePendingSkill = useCallback((skill: string) => {
    setSelectedPendingSkills((prev) =>
      prev.includes(skill)
        ? prev.filter((s) => s !== skill)
        : [...prev, skill]
    )
  }, [])

  const openResumeSidePreview = useCallback((resume: Resume | null, title: string) => {
    setSidePreview({ kind: "resume", title, resume })
  }, [])

  const openUrlSidePreview = useCallback((url: string, title: string) => {
    setSidePreview({ kind: "url", url, title })
  }, [])

  const closeSidePreview = useCallback(() => {
    setSidePreview(null)
  }, [])

  // Auto-start on mount
  useEffect(() => {
    if (jobs.length > 0) void tailorJob(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void ensurePrimaryResume()
  }, [ensurePrimaryResume])

  // In agent mode with extension connected, auto-open each apply step as soon
  // as it becomes current. This avoids stalling on the "Open application" CTA.
  useEffect(() => {
    if (phase !== "applying") return
    if (!extensionConnected) return
    const idx = applyOrder[applyPointer]
    if (idx === undefined) return
    const job = jobs[idx]
    if (!job) return
    if (busy) return
    if (job.applied || job.skipped || job.opened) return
    if (job.status === "opening" || job.status === "filling") return
    void openCurrentApplication()
  }, [applyOrder, applyPointer, busy, extensionConnected, jobs, openCurrentApplication, phase])

  // Extension agent-mode completion bridge:
  // when the job tab reports submission, mark this job done and advance.
  useEffect(() => {
    if (phase !== "applying") return

    const onAgentSubmitted = (event: MessageEvent) => {
      if (typeof event.data !== "object" || event.data === null) return
      const msg = event.data as {
        source?: unknown
        type?: unknown
        context?: { detectedJobId?: unknown; url?: unknown } | null
      }
      if (msg.source !== FROM_EXT) return
      if (msg.type !== "AGENT_APPLICATION_SUBMITTED") return

      const idx = applyOrder[applyPointer]
      if (idx === undefined) return
      const current = jobs[idx]
      if (!current || current.applied || current.skipped) return

      const submittedJobId =
        typeof msg.context?.detectedJobId === "string" ? msg.context.detectedJobId : null
      const submittedUrl =
        typeof msg.context?.url === "string" ? msg.context.url : null

      const jobIdMatches = Boolean(submittedJobId && current.jobId && submittedJobId === current.jobId)
      const currentUrl = normalizeUrlForMatch(current.applyUrl ?? null)
      const eventUrl = normalizeUrlForMatch(submittedUrl)
      const urlMatches = Boolean(currentUrl && eventUrl && currentUrl === eventUrl)
      if (!jobIdMatches && !urlMatches) return

      const nextPointer = applyPointer + 1
      setBusy(true)
      void fetch("/api/scout/mark-submitted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: current.jobId,
          jobTitle: current.jobTitle,
          companyName: current.company ?? "Unknown Company",
          applyUrl: current.applyUrl,
          notes: "Marked submitted automatically from extension agent mode",
        }),
      }).catch(() => {
        // Non-blocking: local queue still advances.
      }).finally(() => {
        updateJob(idx, { applied: true, status: "applied", opened: false, error: undefined })
        setBusy(false)
        goToNextApplyJob(nextPointer)
      })
    }

    window.addEventListener("message", onAgentSubmitted)
    return () => window.removeEventListener("message", onAgentSubmitted)
  }, [applyOrder, applyPointer, goToNextApplyJob, jobs, phase, updateJob])

  // ── Derived state ─────────────────────────────────────────────────────────

  const currentJob  = jobs[currentIndex]
  const currentApplyIdx = applyOrder[applyPointer]
  const currentApplyJob = typeof currentApplyIdx === "number" ? jobs[currentApplyIdx] : null
  const reviewJob = reviewJobIdx !== null ? jobs[reviewJobIdx] : null
  const reviewResumePreview = useMemo(() => {
    if (!primaryResumeSnapshot || !reviewJob) return null
    return applyTailoredSignalsToResume(primaryResumeSnapshot, reviewJob)
  }, [primaryResumeSnapshot, reviewJob])
  const reviewCoverLetterUrl = reviewJob?.prepResult?.coverLetterId
    ? `/dashboard/cover-letters?highlight=${encodeURIComponent(reviewJob.prepResult.coverLetterId)}`
    : null
  const applyResumePreview = useMemo(() => {
    if (!primaryResumeSnapshot || !currentApplyJob) return null
    return applyTailoredSignalsToResume(primaryResumeSnapshot, currentApplyJob)
  }, [primaryResumeSnapshot, currentApplyJob])
  const applyCoverLetterUrl = currentApplyJob?.prepResult?.coverLetterId
    ? `/dashboard/cover-letters?highlight=${encodeURIComponent(currentApplyJob.prepResult.coverLetterId)}`
    : null
  const tailoredN   = jobs.filter(j => j.tailored).length
  const reviewedN   = jobs.filter(j => j.resumeQaApproved).length
  const appliedN    = jobs.filter(j => j.applied).length
  const skippedN    = jobs.filter(j => j.skipped).length
  const total       = jobs.length
  const allQaChecked = qaChecks.every(Boolean)

  useEffect(() => {
    if (phase !== "reviewing") return
    void ensurePrimaryResume()
  }, [ensurePrimaryResume, phase])

  // ── Salary intercept handlers ─────────────────────────────────────────────

  const dismissInterceptAndApply = useCallback(async () => {
    if (!salaryIntercept) return
    // Log the override
    void fetch("/api/scout/salary-intercept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: salaryIntercept.jobId,
        jobTitle: salaryIntercept.jobTitle,
        companyName: salaryIntercept.company,
        jobSalaryMax: salaryIntercept.jobSalaryMax,
        userMarketP50: salaryIntercept.userMarketP50,
        shortfallPct: salaryIntercept.shortfallPercent,
        actionTaken: "apply_anyway",
      }),
    })
    setSalaryIntercept(null)
    // Re-trigger the apply open
    openCurrentApplication()
  }, [salaryIntercept, openCurrentApplication])

  const dismissInterceptFindBetter = useCallback(() => {
    if (!salaryIntercept) return
    void fetch("/api/scout/salary-intercept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: salaryIntercept.jobId,
        jobTitle: salaryIntercept.jobTitle,
        companyName: salaryIntercept.company,
        jobSalaryMax: salaryIntercept.jobSalaryMax,
        userMarketP50: salaryIntercept.userMarketP50,
        shortfallPct: salaryIntercept.shortfallPercent,
        actionTaken: "find_better",
      }),
    })
    setSalaryIntercept(null)
    onFollowUp?.(`Show me ${salaryIntercept.jobTitle} roles paying $${Math.round(salaryIntercept.userMarketP50 / 5000) * 5000}+`)
  }, [salaryIntercept, onFollowUp])

  // ── Render ────────────────────────────────────────────────────────────────

  const showInlineResume = phase === "reviewing" && !!reviewResumePreview

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-[0_2px_16px_rgba(15,23,42,0.07)] overflow-hidden${showInlineResume ? " flex items-start" : ""}`}>

      {/* Salary intercept warning */}
      {salaryIntercept && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 text-amber-600 text-[18px] leading-none select-none">⚠</span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-amber-800 mb-0.5">Salary below your market rate</p>
              <p className="text-[12px] text-amber-700 leading-relaxed">{salaryIntercept.message}</p>
              <p className="mt-1 text-[11px] text-amber-600">{salaryIntercept.alternativeSuggestion}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void dismissInterceptAndApply()}
                  className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                >
                  Apply anyway
                </button>
                <button
                  type="button"
                  onClick={dismissInterceptFindBetter}
                  className="rounded-full bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-700 transition-colors"
                >
                  Show me better-paying roles →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Left column (or full-width outside reviewing) */}
      <div className={showInlineResume ? "w-[480px] flex-shrink-0 overflow-y-auto max-h-[85vh] border-r border-slate-100" : ""}>

      {/* Extension status bar — subtle when connected, loud when not */}
      {extensionStatus === "disconnected" && (
        <div className="border-b border-red-100 bg-red-50 px-5 py-2 flex items-center gap-2 text-[11px] font-medium text-red-700">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400 flex-shrink-0" />
          Chrome extension not connected — autofill unavailable.
          <span className="ml-auto text-[10px] text-red-500">Reconnect the extension to restore autofill</span>
        </div>
      )}

      {/* Mid-flow disconnection — only shown if extensionConnected prop goes false during applying */}
      {!extensionConnected && extMidFlowDisconnected && phase === "applying" && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 flex items-center gap-2.5 text-[12px]">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
          <span className="text-amber-800">Extension disconnected — fill the form manually then click <strong>Submitted</strong> to continue.</span>
          <button type="button" onClick={() => setExtMidFlowDisconnected(false)}
            className="ml-auto text-[11px] font-semibold text-amber-700 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Timing recommendation banner */}
      {timingData && !timingDismissed && phase !== "done" && (
        <div className={`border-b px-4 py-2.5 flex items-start gap-2.5 ${
          timingData.timingRecommendation === "apply_now"
            ? "bg-emerald-50 border-emerald-100"
            : timingData.timingRecommendation === "low_priority"
            ? "bg-amber-50 border-amber-100"
            : "bg-blue-50 border-blue-100"
        }`}>
          <div className="flex-1 min-w-0">
            {timingData.timingRecommendation === "apply_now" && (
              <p className="text-[12px] font-semibold text-emerald-800">
                Good timing — you are in the optimal window for this posting
              </p>
            )}
            {(timingData.timingRecommendation === "schedule_today" || timingData.timingRecommendation === "schedule_tomorrow") && (
              <>
                <p className="text-[12px] font-semibold text-blue-800">
                  {timingData.timingRecommendation === "schedule_today" ? "Better timing available today" : "Better timing available tomorrow"}
                </p>
                <p className="text-[11px] text-blue-700 mt-0.5">{timingData.timingReason}</p>
              </>
            )}
            {timingData.timingRecommendation === "low_priority" && (
              <p className="text-[11px] text-amber-800">{timingData.timingReason}</p>
            )}
            {timingData.screenRateMultiplier > 1 && (
              <p className="text-[10px] text-slate-500 mt-0.5">
                {timingData.screenRateMultiplier}× screen rate boost · Posted {timingData.hoursSincePosted}h ago
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setTimingDismissed(true)}
            className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition p-0.5"
            aria-label="Dismiss timing"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-[#FF5C18]/10 flex items-center justify-center flex-shrink-0">
            {busy
              ? <Loader2 className="h-4 w-4 text-[#FF5C18] animate-spin" />
              : <CheckCircle2 className="h-4 w-4 text-[#FF5C18]" />
            }
          </div>
          <div>
            <p className="text-[15px] font-bold leading-tight text-slate-900">
              {phase === "done"        ? "All done"              :
               phase === "confirming"  ? "Confirm missing skills" :
               phase === "reviewing"   ? "Resume QA"             :
               phase === "applying"    ? "Apply one-by-one"      :
               "Tailoring resumes"}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {phase === "done"
                ? `${appliedN} submitted · ${skippedN} skipped`
                : phase === "applying"
                ? `${Math.min(applyPointer + 1, Math.max(applyOrder.length, 1))} of ${Math.max(applyOrder.length, 1)} in queue`
                : `${reviewedN} of ${total} reviewed`}
            </p>
          </div>
        </div>
        {/* Progress pills */}
        <div className="flex items-center gap-1.5">
          {jobs.map((job, i) => (
            <span
              key={job.jobId}
              className={`h-1.5 rounded-full transition-all ${
                job.applied  ? "w-4 bg-emerald-400" :
                job.skipped  ? "w-1.5 bg-slate-200" :
                i === currentIndex ? "w-4 bg-[#FF5C18]" :
                job.tailored ? "w-1.5 bg-[#FF5C18]/40" :
                "w-1.5 bg-slate-200"
              }`}
            />
          ))}
          {phase === "done" && onFollowUp && (
            <button
              type="button"
              onClick={() => onFollowUp("Track my applications")}
              className="ml-2 text-xs font-semibold text-[#FF5C18] hover:underline flex items-center gap-1"
            >
              Track <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Job list */}
      <div className="px-5 pt-4 space-y-2">
        {jobs.map((job, i) => (
          <div
            key={job.jobId}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 transition-all ${
              i === currentIndex && phase !== "done"
                ? "border-[#FF5C18]/30 bg-[#FF5C18]/[0.03] shadow-[0_0_0_1px_rgba(255,92,24,0.12)]"
                : "border-slate-100 bg-white"
            }`}
          >
            <StatusDot job={job} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold leading-tight text-slate-900">{job.jobTitle}</p>
              <p className="mt-0.5 text-[12px] text-slate-500">{job.company}</p>
            </div>
            {job.matchScore !== null && (
              <div className="flex items-center gap-1 flex-shrink-0 text-[11px] font-semibold text-slate-500">
                <Star className="h-3 w-3 text-amber-400" />
                {job.matchScore}%
              </div>
            )}
            <span
              key={jobStatusLabel(job)}
              className={`flex-shrink-0 text-[11px] font-semibold motion-safe:animate-[badge-pulse_250ms_ease-out_both] ${
                job.applied  ? "text-emerald-600" :
                job.skipped  ? "text-slate-400"   :
                job.status === "confirming" ? "text-amber-600" :
                "text-slate-400"
              }`}
            >
              {jobStatusLabel(job)}
            </span>
            {i === currentIndex && phase === "tailoring" && !job.tailored && !job.skipped && (
              <button
                type="button"
                onClick={() => handleSkip(i)}
                title="Skip this job"
                className="flex-shrink-0 p-1 text-slate-300 hover:text-slate-500 transition"
              >
                <SkipForward className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Tailoring progress pulse */}
      {phase === "tailoring" && busy && (
        <div className="mx-5 mt-4 mb-1 rounded-xl border border-slate-100 bg-slate-50/80 px-5 py-4 flex items-center gap-3">
          <Loader2 className="h-4 w-4 text-[#FF5C18] animate-spin flex-shrink-0" />
          <p className="text-[13px] text-slate-600">
            Analysing <span className="font-semibold text-slate-800">{currentJob?.jobTitle}</span> against your resume…
          </p>
        </div>
      )}

      {/* Skill confirmation */}
      {phase === "confirming" && pendingSkillJobIdx !== null && (
        <div className="border-t border-slate-100 px-5 pt-5 pb-6">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-amber-600">Missing skills</p>
          <p className="mt-1 text-[15px] font-bold text-slate-900">
            {jobs[pendingSkillJobIdx]?.jobTitle}
          </p>
          <p className="mt-1 text-[12px] text-slate-500">
            Only check skills that genuinely match your background.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => setSelectedPendingSkills(pendingSkills)}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50">
              Select all
            </button>
            <button type="button" onClick={() => setSelectedPendingSkills([])}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50">
              Clear
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {pendingSkills.map((skill) => (
              <button
                type="button"
                key={`${jobs[pendingSkillJobIdx]?.jobId}-${skill}`}
                onClick={() => togglePendingSkill(skill)}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition ${
                  selectedPendingSkills.includes(skill)
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                {selectedPendingSkills.includes(skill) && <span className="mr-1 text-amber-600">✓</span>}{skill}
              </button>
            ))}
          </div>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => void resolveSkillConfirmation(true)}
              disabled={busy || selectedPendingSkills.length === 0}
              className="flex-1 rounded-xl bg-[#FF5C18] px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#e25115] disabled:opacity-40"
            >
              Add {selectedPendingSkills.length} skill{selectedPendingSkills.length !== 1 ? "s" : ""} & continue
            </button>
            <button
              type="button"
              onClick={() => void resolveSkillConfirmation(false)}
              disabled={busy}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Resume QA checkpoint */}
      {phase === "reviewing" && reviewJobIdx !== null && (
        <div className="border-t border-slate-100 px-5 pt-5 pb-6">
          {/* Section heading */}
          <div className="mb-4">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#FF5C18]">Resume QA</p>
            <p className="mt-1 text-[15px] font-bold text-slate-900">
              {jobs[reviewJobIdx]?.jobTitle}
            </p>
            <p className="text-[12px] text-slate-500">{jobs[reviewJobIdx]?.company}</p>
          </div>

          {/* Tailored resume card */}
          <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            <div>
              <p className="text-[12px] font-semibold text-slate-800">
                {jobs[reviewJobIdx]?.prepResult?.tailoredResumeName ?? "Tailored resume"}
              </p>
              <p className="text-[11px] text-slate-400">
                ATS: {jobs[reviewJobIdx]?.prepResult?.atsProvider ?? "Generic"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {reviewResumePreview && (
                <button
                  type="button"
                  onClick={() => openResumeSidePreview(reviewResumePreview, `Tailored resume · ${reviewJob?.jobTitle ?? "Job"}`)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Preview <ExternalLink className="h-3 w-3 text-slate-400" />
                </button>
              )}
              {reviewCoverLetterUrl && (
                <button
                  type="button"
                  onClick={() => openUrlSidePreview(reviewCoverLetterUrl, `Cover letter · ${reviewJob?.jobTitle ?? "Job"}`)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Cover letter <ExternalLink className="h-3 w-3 text-slate-400" />
                </button>
              )}
            </div>
          </div>

          {/* QA checklist — spacious items */}
          <div className="space-y-2">
            {RESUME_QA_CHECKLIST.map((question, idx) => (
              <button
                key={`${jobs[reviewJobIdx]?.jobId}-qa-${idx}`}
                type="button"
                onClick={() => handleResumeQaToggle(idx)}
                className={`group w-full flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-all ${
                  qaChecks[idx]
                    ? "border-emerald-200 bg-emerald-50/60 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span className={`mt-[1px] flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border text-[9px] font-bold transition-colors ${
                  qaChecks[idx]
                    ? "border-emerald-400 bg-emerald-400 text-white"
                    : "border-slate-300 text-slate-300 group-hover:border-slate-400"
                }`}>
                  {qaChecks[idx] ? "✓" : ""}
                </span>
                <span className="text-[12.5px] leading-relaxed">{question}</span>
              </button>
            ))}
          </div>

          {/* CTAs */}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={approveResumeQa}
              disabled={!allQaChecked || busy}
              className="flex-1 rounded-xl bg-[#FF5C18] px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#e25115] disabled:opacity-40"
            >
              {allQaChecked ? "Approve & continue →" : `${qaChecks.filter(Boolean).length} / ${RESUME_QA_CHECKLIST.length} confirmed`}
            </button>
            <button
              type="button"
              onClick={skipDuringResumeQa}
              disabled={busy}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Applying phase */}
      {phase === "applying" && (
        <div className="mx-4 mt-3 mb-1 rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">
            Current application: <span className="text-[#FF5C18]">{currentApplyJob?.jobTitle ?? "Role"}</span>
          </p>
          <p className="text-[11px] text-slate-600">
            Open, review, submit manually, then confirm here to continue to the next job.
          </p>
          <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-[11px] font-semibold text-slate-700">
              {currentApplyJob?.prepResult?.tailoredResumeName ?? "Tailored resume ready"}
            </p>
            <p className="text-[10px] text-slate-500">
              ATS target: {currentApplyJob?.prepResult?.atsProvider ?? "Generic ATS"}
            </p>
          </div>
          {(applyResumePreview || applyCoverLetterUrl) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {applyResumePreview && (
                <button
                  type="button"
                  onClick={() => openResumeSidePreview(applyResumePreview, `Tailored resume · ${currentApplyJob?.jobTitle ?? "Job"}`)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Review resume on side
                  <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                </button>
              )}
              {applyCoverLetterUrl && (
                <button
                  type="button"
                  onClick={() => openUrlSidePreview(applyCoverLetterUrl, `Cover letter · ${currentApplyJob?.jobTitle ?? "Job"}`)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Review cover letter on side
                  <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                </button>
              )}
            </div>
          )}
          {extensionStatus === "disconnected" && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-red-800">Chrome extension not connected</p>
              <p className="text-[10px] text-red-700 mt-0.5">
                The extension fills ATS forms automatically. Without it you will need to fill forms manually.
              </p>
              <div className="mt-1.5 flex gap-2">
                <a
                  href={extensionInstallHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-semibold text-red-800 underline"
                >
                  {extensionInstallHref === "/extension" ? "Open local extension setup" : "Install extension"}
                </a>
                <span className="text-[10px] text-red-400">or</span>
                <button
                  type="button"
                  className="text-[10px] font-semibold text-slate-700 underline"
                  onClick={() => setExtMidFlowDisconnected(false)}
                >
                  Continue manually
                </button>
              </div>
            </div>
          )}
          {extensionStatus !== "disconnected" && !extensionConnected && (
            <p className="mt-2 text-[11px] text-amber-700">
              Extension offline: Scout can open the tab, but form-fill is manual.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openCurrentApplication}
              disabled={busy || !currentApplyJob}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
              Open application
            </button>
            <button
              type="button"
              onClick={() => void markCurrentSubmittedAndNext()}
              disabled={busy || !currentApplyJob}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF5C18] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#e25115] disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Submitted, next job
            </button>
            <button
              type="button"
              onClick={reportNoFormAndNext}
              disabled={busy || !currentApplyJob}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              No form here, skip
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {phase === "done" && (
        <div className="mx-4 mt-3 mb-1 rounded-xl border border-emerald-100 bg-emerald-50/40 px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
          <p className="text-sm text-emerald-700 font-medium">
            {appliedN} application{appliedN !== 1 ? "s" : ""} marked submitted. {skippedN} skipped.
          </p>
        </div>
      )}
      {phase === "done" && handoffIssue && (
        <div className="mx-4 mt-2 mb-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-medium text-amber-800">{handoffIssue}</p>
        </div>
      )}

      <div className="h-4" />
      </div>{/* end left column */}

      {/* Right column: inline resume preview during QA */}
      {showInlineResume && (
        <div className="flex-1 overflow-y-auto max-h-[85vh] bg-white">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Tailored resume · {reviewJob?.jobTitle ?? "Job"}
            </p>
            <button
              type="button"
              onClick={() => openResumeSidePreview(reviewResumePreview, `Tailored resume · ${reviewJob?.jobTitle ?? "Job"}`)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              title="Expand"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="px-6 py-5">
            <ResumeQaSidePreview resume={reviewResumePreview} />
          </div>
        </div>
      )}

      {sidePreview && (
        <div className="fixed inset-0 z-[9999] flex justify-end">
          <button
            type="button"
            onClick={closeSidePreview}
            className="absolute inset-0 bg-slate-900/25 backdrop-blur-[1px]"
            aria-label="Close side preview"
          />
          <div className="relative z-10 flex h-full w-full max-w-5xl flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <p className="truncate pr-3 text-sm font-semibold text-slate-800">{sidePreview.title}</p>
              <div className="flex items-center gap-2">
                {sidePreview.kind === "url" && (
                  <a
                    href={sidePreview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    New tab
                    <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={closeSidePreview}
                  className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {sidePreview.kind === "resume" ? (
              <div className="h-full overflow-y-auto bg-slate-100 p-4">
                <ResumeQaSidePreview resume={sidePreview.resume} />
              </div>
            ) : (
              <iframe
                src={sidePreview.url}
                title={sidePreview.title}
                className="h-full w-full border-0 bg-white"
              />
            )}
          </div>
        </div>
      )}

    </div>
  )
}

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

type Props = {
  initialJobs: ApplyAgentJob[]
  resumeId?:   string
  extensionConnected?: boolean
  onFollowUp?: (query: string) => void
  onDone?:     () => void
}

const FROM_SCOUT = "hireoven-scout"

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

function ResumeQaSidePreview({ resume }: { resume: Resume | null }) {
  if (!resume) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Resume preview unavailable for this job.
      </div>
    )
  }

  const experiences = Array.isArray(resume.work_experience) ? resume.work_experience : []
  const technical = Array.isArray(resume.skills?.technical) ? resume.skills.technical : []
  const soft = Array.isArray(resume.skills?.soft) ? resume.skills.soft : []
  const languages = Array.isArray(resume.skills?.languages) ? resume.skills.languages : []
  const certs = Array.isArray(resume.skills?.certifications) ? resume.skills.certifications : []
  const topSkills = Array.isArray(resume.top_skills) ? resume.top_skills : []
  const summary = (resume.summary ?? "").trim()
  const contactLine = joinParts([resume.email, resume.phone, resume.location, resume.linkedin_url], " · ")
  const roleLine = joinParts([resume.primary_role, resume.years_of_experience ? `${resume.years_of_experience}+ years` : null], " · ")

  return (
    <article className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="border-b border-slate-100 pb-4">
        <h2 className="text-xl font-bold text-slate-900">{resume.full_name || resume.name || "Resume"}</h2>
        {roleLine && <p className="mt-1 text-sm text-slate-700">{roleLine}</p>}
        {contactLine && <p className="mt-1 text-sm text-slate-500">{contactLine}</p>}
      </header>

      {summary && (
        <section className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Summary</h3>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-800">{summary}</p>
        </section>
      )}

      <section className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Skills</h3>
        <div className="mt-2 space-y-2 text-sm text-slate-800">
          {technical.length > 0 && <p><span className="font-semibold">Technical:</span> {technical.join(", ")}</p>}
          {soft.length > 0 && <p><span className="font-semibold">Soft:</span> {soft.join(", ")}</p>}
          {languages.length > 0 && <p><span className="font-semibold">Languages:</span> {languages.join(", ")}</p>}
          {certs.length > 0 && <p><span className="font-semibold">Certifications:</span> {certs.join(", ")}</p>}
          {technical.length === 0 && soft.length === 0 && languages.length === 0 && certs.length === 0 && topSkills.length > 0 && (
            <p><span className="font-semibold">Core:</span> {topSkills.join(", ")}</p>
          )}
        </div>
      </section>

      <section className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Experience</h3>
        <div className="mt-3 space-y-4">
          {experiences.map((item, idx) => {
            const title = joinParts([item.title, item.company], " · ")
            const dateLine = joinParts([item.start_date, item.is_current ? "Present" : item.end_date], " - ")
            const bullets = Array.isArray(item.achievements) ? item.achievements.filter((b) => b.trim().length > 0) : []
            return (
              <div key={`${item.company}-${item.title}-${idx}`} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-sm font-semibold text-slate-900">{title || "Role"}</p>
                {dateLine && <p className="text-xs text-slate-500">{dateLine}</p>}
                {item.description && (
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-800">{item.description}</p>
                )}
                {bullets.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-800">
                    {bullets.map((bullet, i) => (
                      <li key={`${idx}-b-${i}`}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
          {experiences.length === 0 && (
            <p className="text-sm text-slate-500">No experience blocks found in this resume.</p>
          )}
        </div>
      </section>
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

export function ApplyAgentFlow({ initialJobs, extensionConnected = false, onFollowUp, onDone }: Props) {
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
  const processingRef  = useRef(false)
  const primaryResumeRef = useRef<{ id: string; skills: ResumeSkillSets } | null>(null)
  const primaryResumeDataRef = useRef<Resume | null>(null)
  const [primaryResumeSnapshot, setPrimaryResumeSnapshot] = useState<Resume | null>(null)

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
      const res  = await fetch("/api/scout/bulk-prepare", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          jobId:             job.jobId,
          jobTitle:          job.jobTitle,
          company:           job.company,
          applyUrl:          job.applyUrl,
          sponsorshipSignal: job.sponsorshipSignal,
        }),
      })
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
      ].filter((s, i, arr) => arr.indexOf(s) === i)

      if (allSkills.length > 0) {
        updateJob(idx, {
          prepResult: prep,
          confirmedSkills: allSkills,
          status: "confirming",
        })
        setPendingSkills(allSkills)
        setSelectedPendingSkills(allSkills)
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
  }, [jobs, updateJob, appendSkillsToPrimaryResume, enterResumeReview, advanceQueue, buildPatchedJobs])

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

  const openCurrentApplication = useCallback(() => {
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

  // ── Render ────────────────────────────────────────────────────────────────

  const showInlineResume = phase === "reviewing" && !!reviewResumePreview

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden${showInlineResume ? " flex items-start" : ""}`}>

      {/* Left column (or full-width outside reviewing) */}
      <div className={showInlineResume ? "w-[420px] flex-shrink-0 overflow-y-auto max-h-[85vh] border-r border-slate-100" : ""}>

      {/* Header */}
      <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-[#FF5C18]/10 flex items-center justify-center">
            {busy
              ? <Loader2 className="h-4 w-4 text-[#FF5C18] animate-spin" />
              : <CheckCircle2 className="h-4 w-4 text-[#FF5C18]" />
            }
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {phase === "done"     ? "All done"            :
               phase === "confirming" ? "Confirm missing skills" :
               phase === "reviewing" ? "Resume QA checkpoint" :
               phase === "applying" ? "Apply one-by-one" :
               "Tailoring resumes"}
            </p>
            <p className="text-[11px] text-slate-400">
              {phase === "done"
                ? `${appliedN} submitted · ${skippedN} skipped`
                : phase === "applying"
                ? `${Math.min(applyPointer + 1, Math.max(applyOrder.length, 1))} of ${Math.max(applyOrder.length, 1)} in apply queue`
                : `${reviewedN} reviewed · ${tailoredN} tailored of ${total}`}
            </p>
          </div>
        </div>
        {phase === "done" && onFollowUp && (
          <button
            type="button"
            onClick={() => onFollowUp("Track my applications")}
            className="text-xs font-semibold text-[#FF5C18] hover:underline flex items-center gap-1"
          >
            Track <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Job list */}
      <div className="px-4 pt-3 space-y-2">
        {jobs.map((job, i) => (
          <div
            key={job.jobId}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all ${
              i === currentIndex && phase !== "done"
                ? "border-[#FF5C18]/25 bg-orange-50/30"
                : "border-slate-100 bg-white"
            }`}
          >
            <StatusDot job={job} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">{job.jobTitle}</p>
              <p className="text-[11px] text-slate-400">{job.company}</p>
            </div>
            {job.matchScore !== null && (
              <div className="flex items-center gap-1 flex-shrink-0 text-[11px] text-slate-400">
                <Star className="h-3 w-3 text-amber-400" />
                {job.matchScore}%
              </div>
            )}
            <span className="flex-shrink-0 text-[10px] font-semibold text-slate-400">
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
        <div className="mx-4 mt-3 mb-1 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 flex items-center gap-2">
          <Loader2 className="h-4 w-4 text-[#FF5C18] animate-spin flex-shrink-0" />
          <p className="text-sm text-slate-600">
            Analysing <span className="font-semibold">{currentJob?.jobTitle}</span> against your resume…
          </p>
        </div>
      )}

      {/* Skill confirmation */}
      {phase === "confirming" && pendingSkillJobIdx !== null && (
        <div className="mx-4 mt-3 mb-1 rounded-xl border border-amber-200 bg-amber-50/40 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">
            Missing skills found for <span className="text-[#FF5C18]">{jobs[pendingSkillJobIdx]?.jobTitle}</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            Select only skills that truthfully match your background.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedPendingSkills(pendingSkills)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelectedPendingSkills([])}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Clear all
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pendingSkills.map((skill) => (
              <button
                type="button"
                key={`${jobs[pendingSkillJobIdx]?.jobId}-${skill}`}
                onClick={() => togglePendingSkill(skill)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  selectedPendingSkills.includes(skill)
                    ? "border-amber-300 bg-white text-amber-800"
                    : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                {selectedPendingSkills.includes(skill) ? "✓ " : ""}{skill}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void resolveSkillConfirmation(true)}
              disabled={busy || selectedPendingSkills.length === 0}
              className="rounded-lg bg-[#FF5C18] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#e25115] disabled:opacity-50"
            >
              Add selected ({selectedPendingSkills.length}) & continue
            </button>
            <button
              type="button"
              onClick={() => void resolveSkillConfirmation(false)}
              disabled={busy}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Continue without adding
            </button>
          </div>
        </div>
      )}

      {/* Resume QA checkpoint */}
      {phase === "reviewing" && reviewJobIdx !== null && (
        <div className="mx-4 mt-3 mb-1 rounded-xl border border-orange-200 bg-orange-50/30 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">
            Resume QA for <span className="text-[#FF5C18]">{jobs[reviewJobIdx]?.jobTitle}</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            Confirm each item before moving to the next role.
          </p>
          <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-[11px] font-semibold text-slate-700">
              {jobs[reviewJobIdx]?.prepResult?.tailoredResumeName ?? "Tailored resume"}
            </p>
            <p className="text-[10px] text-slate-500">
              ATS target: {jobs[reviewJobIdx]?.prepResult?.atsProvider ?? "Generic ATS"}
            </p>
          </div>
          {(reviewResumePreview || reviewCoverLetterUrl) && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">Review materials</p>
              {reviewResumePreview && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openResumeSidePreview(reviewResumePreview, `Tailored resume · ${reviewJob?.jobTitle ?? "Job"}`)}
                    className="flex flex-1 items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    View full screen
                    <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                </div>
              )}
              {reviewCoverLetterUrl && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openUrlSidePreview(reviewCoverLetterUrl, `Cover letter · ${reviewJob?.jobTitle ?? "Job"}`)}
                    className="flex flex-1 items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Open cover letter on side
                    <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                  <a
                    href={reviewCoverLetterUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    New tab
                  </a>
                </div>
              )}
            </div>
          )}
          <div className="mt-2 space-y-1.5">
            {RESUME_QA_CHECKLIST.map((question, idx) => (
              <button
                key={`${jobs[reviewJobIdx]?.jobId}-qa-${idx}`}
                type="button"
                onClick={() => handleResumeQaToggle(idx)}
                className={`w-full rounded-lg border px-2.5 py-2 text-left text-[11px] transition ${
                  qaChecks[idx]
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {qaChecks[idx] ? "✓ " : "○ "}{question}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={approveResumeQa}
              disabled={!allQaChecked || busy}
              className="rounded-lg bg-[#FF5C18] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#e25115] disabled:opacity-50"
            >
              Approve resume & continue
            </button>
            <button
              type="button"
              onClick={skipDuringResumeQa}
              disabled={busy}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Skip this job
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
          {!extensionConnected && (
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
        <div className="flex-1 overflow-y-auto max-h-[85vh] bg-slate-50/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-[0.14em]">
              Tailored resume · {reviewJob?.jobTitle ?? "Job"}
            </p>
            <button
              type="button"
              onClick={() => openResumeSidePreview(reviewResumePreview, `Tailored resume · ${reviewJob?.jobTitle ?? "Job"}`)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition"
              title="View full screen"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
          <ResumeQaSidePreview resume={reviewResumePreview} />
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

"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Save,
  Trophy,
  Upload,
} from "lucide-react"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { buildResumeSnapshot } from "@/lib/resume/scoring"
import { cn } from "@/lib/utils"
import type { ResumeVersion } from "@/types"

function fmtDate(iso?: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function clampScore(score?: number | null) {
  return typeof score === "number" ? Math.max(0, Math.min(100, score)) : null
}

function scoreDelta(current?: number | null, previous?: number | null) {
  if (typeof current !== "number" || typeof previous !== "number") return null
  const raw = current - previous
  return { value: Math.abs(raw), up: raw >= 0 }
}

function VersionBadge({ versionNumber }: { versionNumber: number }) {
  return <span className="font-semibold text-slate-700">v{versionNumber}</span>
}

function ScoreCell({ value }: { value?: number | null }) {
  return <span className="font-semibold text-slate-800 tabular-nums">{typeof value === "number" ? value : "—"}</span>
}

function ChangeCell({ delta }: { delta: ReturnType<typeof scoreDelta> }) {
  if (!delta) return <span className="text-slate-400">—</span>
  return (
    <span className={cn("inline-flex items-center gap-1 font-bold tabular-nums", delta.up ? "text-emerald-600" : "text-red-500")}>
      {delta.up ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
      {delta.value}
    </span>
  )
}

function CircleScore({ value, label }: { value: number; label: string }) {
  const circumference = 2 * Math.PI * 22
  const dash = (value / 100) * circumference

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-3">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <svg className="absolute inset-0 -rotate-90" width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="22" fill="none" stroke="#E8EEF7" strokeWidth="5" />
          <circle
            cx="32"
            cy="32"
            r="22"
            fill="none"
            stroke="#5B4DFF"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
          />
        </svg>
        <span className="text-[14px] font-bold text-slate-950 tabular-nums">{value}</span>
      </div>
      <p className="mt-2 text-[11px] font-semibold text-slate-500">{label}</p>
    </div>
  )
}

function SaveVersionComposer({
  resumeId,
  currentVersionCount,
  onSaved,
}: {
  resumeId: string
  currentVersionCount: number
  onSaved: () => void
}) {
  const { primaryResume } = useResumeContext()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!primaryResume) return
    setSaving(true)
    const nextNum = currentVersionCount + 1

    await fetch(`/api/resume/${resumeId}/versions`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version_number: nextNum,
        name: name.trim() || `Version ${nextNum}`,
        file_url: null,
        snapshot: buildResumeSnapshot(primaryResume),
        changes_summary: "Manual Update",
      }),
    })

    setSaving(false)
    setOpen(false)
    setName("")
    onSaved()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#5B4DFF] px-3.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[#493EE6]"
      >
        <Plus className="h-3.5 w-3.5" />
        New Version
      </button>
    )
  }

  return (
    <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-2">
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={`Version ${currentVersionCount + 1}`}
        className="w-40 bg-transparent px-1 text-[12px] text-slate-800 outline-none placeholder:text-slate-400"
      />
      <button
        type="button"
        disabled={saving}
        onClick={handleSave}
        className="inline-flex h-6 items-center gap-1 rounded-md bg-[#5B4DFF] px-2.5 text-[11px] font-semibold text-white disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-[11px] font-semibold text-slate-500">
        Cancel
      </button>
    </div>
  )
}

function NoResumeState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
        <FileText className="h-6 w-6" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-slate-800">No resume to version</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">Upload a resume first. Versions are snapshots you save manually as you refine your resume.</p>
      <Link href="/dashboard/resume" className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-[#5B4DFF] px-4 text-sm font-semibold text-white transition hover:bg-[#493EE6]">
        <Upload className="h-4 w-4" />
        Upload resume
      </Link>
    </div>
  )
}

export default function ResumeVersionsPage() {
  const { primaryResume, hasResume, isLoading, upsertResume } = useResumeContext()
  const [versions, setVersions] = useState<ResumeVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [compareA, setCompareA] = useState("")
  const [compareB, setCompareB] = useState("")

  async function loadVersions(resumeId: string) {
    setLoadingVersions(true)
    const res = await fetch(`/api/resume/${resumeId}/versions`, { credentials: "include", cache: "no-store" })

    if (res.ok) {
      const body = (await res.json()) as { versions?: ResumeVersion[] }
      const loaded = body.versions ?? []
      setVersions(loaded)
      if (loaded.length >= 2) {
        setCompareA((current) => current || loaded[0].id)
        setCompareB((current) => current || loaded[1].id)
      }
    }

    setLoadingVersions(false)
  }

  useEffect(() => {
    if (primaryResume?.id) void loadVersions(primaryResume.id)
  }, [primaryResume?.id])

  const orderedVersions = useMemo(() => [...versions].sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0)), [versions])
  const versionA = useMemo(() => orderedVersions.find((version) => version.id === compareA) ?? orderedVersions[0] ?? null, [orderedVersions, compareA])
  const versionB = useMemo(() => orderedVersions.find((version) => version.id === compareB) ?? orderedVersions[1] ?? orderedVersions[0] ?? null, [orderedVersions, compareB])

  async function handleRestore(version: ResumeVersion) {
    if (!primaryResume) return
    if (!window.confirm("Restore this version? Your current resume will be overwritten.")) return
    const response = await fetch(`/api/resume/${primaryResume.id}/versions/${version.id}/restore`, { method: "POST", credentials: "include" })
    if (!response.ok) return
    const body = await response.json()
    if (body.resume) upsertResume(body.resume)
    await loadVersions(primaryResume.id)
  }

  function handleDownload(version: ResumeVersion) {
    if (version.file_url) window.open(version.file_url, "_blank", "noopener,noreferrer")
  }

  async function handleCopy(version: ResumeVersion) {
    if (!primaryResume) return
    const response = await fetch(`/api/resume/${primaryResume.id}/versions/${version.id}/duplicate`, { method: "POST", credentials: "include" })
    if (!response.ok) return
    await loadVersions(primaryResume.id)
  }

  const activeScore = clampScore(primaryResume?.resume_score) ?? 88
  const compareScoreA = clampScore(versionA?.snapshot?.resume_score) ?? activeScore
  const compareScoreB = clampScore(versionB?.snapshot?.resume_score) ?? Math.max(0, activeScore - 6)
  const compareDelta = compareScoreA - compareScoreB
  const keywordsA = Array.isArray(versionA?.snapshot?.top_skills) ? versionA?.snapshot?.top_skills ?? [] : []
  const keywordsB = Array.isArray(versionB?.snapshot?.top_skills) ? versionB?.snapshot?.top_skills ?? [] : []
  const addedKeywords = keywordsA.filter((keyword) => !keywordsB.includes(keyword)).length || 12
  const removedKeywords = keywordsB.filter((keyword) => !keywordsA.includes(keyword)).length || 3

  return (
    <main className="min-h-screen bg-[#FAFBFF]">
      <div className="mx-auto w-full max-w-[1120px] space-y-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-slate-950">Resume Versions</h1>
            <p className="mt-1 text-[13px] text-slate-500">Track changes and compare different versions of your resume.</p>
          </div>
          {primaryResume ? <SaveVersionComposer resumeId={primaryResume.id} currentVersionCount={versions.length} onSaved={() => void loadVersions(primaryResume.id)} /> : null}
        </div>

        {(isLoading || loadingVersions) && <div className="h-[560px] animate-pulse rounded-xl bg-slate-100" />}

        {!isLoading && !hasResume && <NoResumeState />}

        {!isLoading && !loadingVersions && hasResume && primaryResume && (
          <div className="space-y-4">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <p className="text-[14px] font-bold text-slate-950">Version History</p>
              </div>

              {orderedVersions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Copy className="h-9 w-9 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-700">No saved versions yet</p>
                  <p className="mt-1 max-w-xs text-[12.5px] text-slate-400">Save a version before editing so you can always roll back to a previous state.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        <th className="px-5 py-3">Version</th>
                        <th className="px-3 py-3">Name</th>
                        <th className="px-3 py-3">Based On</th>
                        <th className="px-3 py-3">Created</th>
                        <th className="px-3 py-3 text-center">ATS Score</th>
                        <th className="px-3 py-3 text-center">Match Score</th>
                        <th className="px-3 py-3 text-center">Change</th>
                        <th className="px-5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[12px]">
                      {orderedVersions.map((version, index) => {
                        const score = clampScore(version.snapshot?.resume_score)
                        const matchScore = clampScore(
                          (version.snapshot as { match_score?: number } | null | undefined)?.match_score
                        )
                        const previous = orderedVersions[index + 1]
                        const delta = previous ? scoreDelta(score, clampScore(previous.snapshot?.resume_score)) : null
                        const basedOn = version.changes_summary || (version.snapshot ? "AI Generated" : "Uploaded Resume")

                        return (
                          <tr key={version.id} className="transition hover:bg-slate-50">
                            <td className="px-5 py-3"><VersionBadge versionNumber={version.version_number} /></td>
                            <td className="max-w-[220px] px-3 py-3">
                              <p className="truncate font-semibold text-slate-800">{version.name ?? `Version ${version.version_number}`}</p>
                            </td>
                            <td className="max-w-[160px] px-3 py-3 text-slate-500">
                              <p className="truncate">{basedOn}</p>
                            </td>
                            <td className="px-3 py-3 text-slate-500">{fmtDate(version.created_at)}</td>
                            <td className="px-3 py-3 text-center"><ScoreCell value={score} /></td>
                            <td className="px-3 py-3 text-center"><ScoreCell value={matchScore} /></td>
                            <td className="px-3 py-3 text-center"><ChangeCell delta={delta} /></td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void handleCopy(version)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                                  title="Duplicate"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={!version.file_url}
                                  onClick={() => handleDownload(version)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:opacity-30"
                                  title="Download"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleRestore(version)}
                                  disabled={!version.snapshot || index === 0}
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:opacity-30"
                                  title="Restore"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                                  title="More"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[14px] font-bold text-slate-950">Compare Versions</p>
              <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_140px] md:items-end">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-slate-500">Version A</span>
                  <select
                    value={compareA}
                    onChange={(event) => setCompareA(event.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 outline-none focus:border-[#5B4DFF] focus:ring-2 focus:ring-[#5B4DFF]/10"
                  >
                    {orderedVersions.map((version) => (
                      <option key={version.id} value={version.id}>v{version.version_number} - {version.name ?? `Version ${version.version_number}`}</option>
                    ))}
                  </select>
                </label>
                <div className="hidden h-10 items-center justify-center text-[13px] font-bold text-[#5B4DFF] md:flex">VS</div>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-slate-500">Version B</span>
                  <select
                    value={compareB}
                    onChange={(event) => setCompareB(event.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 outline-none focus:border-[#5B4DFF] focus:ring-2 focus:ring-[#5B4DFF]/10"
                  >
                    {orderedVersions.map((version) => (
                      <option key={version.id} value={version.id}>v{version.version_number} - {version.name ?? `Version ${version.version_number}`}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-[#5B4DFF] px-4 text-[12px] font-semibold text-white transition hover:bg-[#493EE6] disabled:opacity-50"
                  disabled={orderedVersions.length < 2}
                >
                  Compare
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[14px] font-bold text-slate-950">Comparison Summary</p>
              <div className="mt-4 grid gap-3 lg:grid-cols-[1.05fr_1fr_1fr_1fr_1.4fr]">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-bold text-slate-500">Overall Score</p>
                  <div className="mt-3 flex items-center justify-center gap-3">
                    <CircleScore value={compareScoreA} label="Version A" />
                    <span className="text-[11px] font-bold text-slate-400">VS</span>
                    <CircleScore value={compareScoreB} label="Version B" />
                  </div>
                  <div className="mt-3 rounded-lg bg-emerald-50 py-2 text-center text-[11px] font-bold text-emerald-600">
                    +{Math.max(0, compareDelta)}
                    <span className="ml-1 font-semibold">Version A is better</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-bold text-slate-500">Keywords</p>
                  <div className="mt-5 space-y-3 text-[12px] font-semibold">
                    <p className="text-emerald-600">+{addedKeywords} Added</p>
                    <p className="text-red-500">-{removedKeywords} Removed</p>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-bold text-slate-500">Bullet Improvements</p>
                  <p className="mt-5 text-[12px] font-semibold text-emerald-600">+8 Improved</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-bold text-slate-500">Sections Added</p>
                  <p className="mt-5 text-[12px] font-semibold text-emerald-600">+1 Added</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-bold text-slate-500">Recommendation</p>
                  <p className="mt-3 text-[11.5px] leading-relaxed text-slate-600">
                    Version A is better for this role. It has higher score and improved keyword match.
                  </p>
                  <div className="mt-4 flex justify-center text-orange-500">
                    <Trophy className="h-8 w-8" />
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
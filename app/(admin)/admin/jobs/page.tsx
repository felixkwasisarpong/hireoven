"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { ExternalLink, Eye, Loader2, Pencil, RefreshCw, Search } from "lucide-react"
import {
  AdminBadge,
  AdminButton,
  AdminInput,
  AdminPageHeader,
  AdminPanel,
  AdminSelect,
  AdminStatCard,
} from "@/components/admin/AdminPrimitives"
import { useToast } from "@/components/ui/ToastProvider"
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/admin/format"
import type { Company, EmploymentType, Job, SeniorityLevel } from "@/types"

type JobRow = Job & {
  company: Pick<Company, "id" | "name" | "logo_url" | "ats_type"> | null
}

type JobDraft = Pick<
  Job,
  | "title"
  | "location"
  | "seniority_level"
  | "employment_type"
  | "sponsorship_score"
  | "is_remote"
  | "is_active"
  | "requires_authorization"
  | "description"
>

const EMPLOYMENT_OPTIONS: EmploymentType[] = ["fulltime", "parttime", "contract", "internship"]
const SENIORITY_OPTIONS: SeniorityLevel[] = [
  "intern",
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
  "director",
  "vp",
  "exec",
]

function isNormalizationFailed(job: JobRow) {
  return !job.normalized_title || !job.skills?.length
}

function sponsorTone(score: number) {
  if (score >= 80) return "success" as const
  if (score >= 60) return "info" as const
  if (score >= 30) return "warning" as const
  return "danger" as const
}

function makeDraft(job: JobRow): JobDraft {
  return {
    title: job.title,
    location: job.location,
    seniority_level: job.seniority_level,
    employment_type: job.employment_type,
    sponsorship_score: job.sponsorship_score,
    is_remote: job.is_remote,
    is_active: job.is_active,
    requires_authorization: job.requires_authorization,
    description: job.description,
  }
}

export default function AdminJobsPage() {
  const { pushToast } = useToast()
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [atsFilter, setAtsFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [remoteFilter, setRemoteFilter] = useState("all")
  const [failedOnly, setFailedOnly] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<JobDraft | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  async function loadJobs() {
    setLoading(true)
    const res = await fetch("/api/jobs?limit=500&sort=fresh")
    if (!res.ok) {
      pushToast({ tone: "error", title: "Unable to load jobs" })
      setLoading(false)
      return
    }
    const { jobs: data } = (await res.json()) as { jobs: JobRow[] }
    setJobs(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void loadJobs()
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const visibleJobs = useMemo(() => {
    const query = search.trim().toLowerCase()

    return jobs.filter((job) => {
      const matchesSearch =
        !query ||
        job.title.toLowerCase().includes(query) ||
        job.company?.name?.toLowerCase().includes(query) ||
        job.location?.toLowerCase().includes(query) ||
        job.skills?.some((skill) => skill.toLowerCase().includes(query))
      const matchesAts = !atsFilter || job.company?.ats_type === atsFilter
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && job.is_active) ||
        (statusFilter === "inactive" && !job.is_active)
      const matchesRemote =
        remoteFilter === "all" ||
        (remoteFilter === "remote" && job.is_remote) ||
        (remoteFilter === "onsite" && !job.is_remote)
      const matchesNormalization = !failedOnly || isNormalizationFailed(job)

      return (
        matchesSearch &&
        matchesAts &&
        matchesStatus &&
        matchesRemote &&
        matchesNormalization
      )
    })
  }, [atsFilter, failedOnly, jobs, remoteFilter, search, statusFilter])

  async function renormalize(ids: string[]) {
    if (!ids.length) return

    setBusyId(ids.length === 1 ? ids[0] : "__renormalize__")
    const response = await fetch("/api/admin/jobs/renormalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    })
    const body = (await response.json()) as { error?: string; updated?: string[] }
    setBusyId(null)

    if (!response.ok) {
      pushToast({
        tone: "error",
        title: "Re-normalization failed",
        description: body.error ?? "Unknown error",
      })
      return
    }

    pushToast({
      tone: "success",
      title: "Jobs re-normalized",
      description: `${body.updated?.length ?? ids.length} jobs updated.`,
    })
    await loadJobs()
  }

  async function toggleActive(job: JobRow) {
    setBusyId(job.id)
    const res = await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !job.is_active }),
    })
    setBusyId(null)

    if (!res.ok) {
      pushToast({ tone: "error", title: "Unable to update job" })
      return
    }

    setJobs((current) =>
      current.map((entry) =>
        entry.id === job.id ? { ...entry, is_active: !entry.is_active } : entry
      )
    )
  }

  async function saveDraft(jobId: string) {
    if (!draft) return

    setBusyId(jobId)
    const res = await fetch(`/api/admin/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })
    setBusyId(null)

    if (!res.ok) {
      pushToast({ tone: "error", title: "Unable to save job" })
      return
    }

    setJobs((current) =>
      current.map((entry) => (entry.id === jobId ? { ...entry, ...draft } : entry))
    )
    setEditingId(null)
    setDraft(null)
    pushToast({
      tone: "success",
      title: "Job updated",
      description: "The inline edits were saved.",
    })
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Jobs"
        title="Jobs operations"
        description="Inspect every normalized job, quickly correct fields that look wrong, and remove bad records from the public feed before they spread."
        actions={
          <>
            <AdminButton
              tone="secondary"
              onClick={() => void renormalize(selected)}
              disabled={!selected.length || busyId === "__renormalize__"}
            >
              {busyId === "__renormalize__" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Re-normalize selected
            </AdminButton>
            <AdminButton tone="secondary" onClick={() => void loadJobs()}>
              Refresh
            </AdminButton>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="Visible jobs" value={formatNumber(visibleJobs.length)} />
        <AdminStatCard
          label="Active jobs"
          value={formatNumber(visibleJobs.filter((job) => job.is_active).length)}
          tone="success"
        />
        <AdminStatCard
          label="Remote jobs"
          value={formatNumber(visibleJobs.filter((job) => job.is_remote).length)}
          tone="info"
        />
        <AdminStatCard
          label="Failed normalization"
          value={formatNumber(visibleJobs.filter((job) => isNormalizationFailed(job)).length)}
          tone="danger"
        />
      </div>

      <AdminPanel
        title="Jobs table"
        description="Search, filter, edit, and inspect the raw normalized data for every job in the system."
      >
        <div className="grid gap-3 lg:grid-cols-[1.6fr_repeat(4,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
            <AdminInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, company, skills, location"
              className="pl-9"
            />
          </div>
          <AdminSelect value={atsFilter} onChange={(event) => setAtsFilter(event.target.value)}>
            <option value="">All ATS types</option>
            {["greenhouse", "lever", "ashby", "workday", "bamboohr", "icims", "jobvite", "custom"].map(
              (ats) => (
                <option key={ats} value={ats}>
                  {ats}
                </option>
              )
            )}
          </AdminSelect>
          <AdminSelect
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </AdminSelect>
          <AdminSelect
            value={remoteFilter}
            onChange={(event) => setRemoteFilter(event.target.value)}
          >
            <option value="all">Remote + onsite</option>
            <option value="remote">Remote only</option>
            <option value="onsite">Onsite / hybrid</option>
          </AdminSelect>
          <button
            type="button"
            onClick={() => setFailedOnly((current) => !current)}
            className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
              failedOnly
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            Failed normalization only
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={
                      visibleJobs.length > 0 &&
                      selected.length > 0 &&
                      visibleJobs.every((job) => selected.includes(job.id))
                    }
                    onChange={(event) =>
                      setSelected(
                        event.target.checked ? visibleJobs.map((job) => job.id) : []
                      )
                    }
                  />
                </th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3">Company</th>
                <th className="px-3 py-3">ATS</th>
                <th className="px-3 py-3">Seniority</th>
                <th className="px-3 py-3">Location</th>
                <th className="px-3 py-3">Sponsorship</th>
                <th className="px-3 py-3">First detected</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-gray-500">
                    <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
                    Loading jobs
                  </td>
                </tr>
              ) : visibleJobs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-gray-500">
                    No jobs match the current admin filters.
                  </td>
                </tr>
              ) : (
                visibleJobs.map((job) => {
                  const expanded = expandedId === job.id
                  const editing = editingId === job.id && draft

                  return (
                    <Fragment key={job.id}>
                      <tr className="align-top">
                        <td className="px-3 py-4">
                          <input
                            type="checkbox"
                            checked={selected.includes(job.id)}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? [...current, job.id]
                                  : current.filter((item) => item !== job.id)
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-4">
                          <div>
                            <p className="font-semibold text-gray-900">{job.title}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              {job.normalized_title ?? "Missing normalized title"}
                            </p>
                          </div>
                        </td>
                        <td className="px-3 py-4">
                          <p className="font-medium text-gray-900">
                            {job.company?.name ?? "Unknown company"}
                          </p>
                        </td>
                        <td className="px-3 py-4">
                          {job.company?.ats_type ? (
                            <AdminBadge tone="dark">{job.company.ats_type}</AdminBadge>
                          ) : (
                            <AdminBadge>Unknown</AdminBadge>
                          )}
                        </td>
                        <td className="px-3 py-4 text-gray-600">
                          {job.seniority_level ?? "Unspecified"}
                        </td>
                        <td className="px-3 py-4 text-gray-600">
                          {job.location ?? "Unknown"}
                          {job.is_remote ? (
                            <span className="ml-2 rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
                              Remote
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-4">
                          <AdminBadge tone={sponsorTone(job.sponsorship_score)}>
                            {job.sponsorship_score}
                          </AdminBadge>
                        </td>
                        <td className="px-3 py-4">
                          <p className="text-gray-900">{formatDateTime(job.first_detected_at)}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {formatRelativeTime(job.first_detected_at, now)}
                          </p>
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex flex-col gap-2">
                            <AdminBadge tone={job.is_active ? "success" : "neutral"}>
                              {job.is_active ? "Active" : "Inactive"}
                            </AdminBadge>
                            {isNormalizationFailed(job) ? (
                              <AdminBadge tone="danger">Needs review</AdminBadge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex flex-wrap gap-2">
                            <AdminButton
                              tone="ghost"
                              className="px-3 py-2 text-xs"
                              onClick={() =>
                                setExpandedId((current) => (current === job.id ? null : job.id))
                              }
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Details
                            </AdminButton>
                            <AdminButton
                              tone="secondary"
                              className="px-3 py-2 text-xs"
                              onClick={() => {
                                setExpandedId(job.id)
                                setEditingId(job.id)
                                setDraft(makeDraft(job))
                              }}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </AdminButton>
                            <AdminButton
                              tone="secondary"
                              className="px-3 py-2 text-xs"
                              onClick={() => window.open(job.apply_url, "_blank", "noopener,noreferrer")}
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              View
                            </AdminButton>
                            <AdminButton
                              tone={job.is_active ? "danger" : "primary"}
                              className="px-3 py-2 text-xs"
                              disabled={busyId === job.id}
                              onClick={() => void toggleActive(job)}
                            >
                              {busyId === job.id ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : null}
                              {job.is_active ? "Deactivate" : "Activate"}
                            </AdminButton>
                            <AdminButton
                              tone="secondary"
                              className="px-3 py-2 text-xs"
                              disabled={busyId === job.id}
                              onClick={() => void renormalize([job.id])}
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Re-normalize
                            </AdminButton>
                          </div>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr>
                          <td colSpan={10} className="bg-gray-50 px-3 py-4">
                            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                              <div className="space-y-4">
                                {editing ? (
                                  <div className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 md:grid-cols-2">
                                    <AdminInput
                                      value={draft.title}
                                      onChange={(event) =>
                                        setDraft((current) =>
                                          current ? { ...current, title: event.target.value } : current
                                        )
                                      }
                                      placeholder="Job title"
                                    />
                                    <AdminInput
                                      value={draft.location ?? ""}
                                      onChange={(event) =>
                                        setDraft((current) =>
                                          current
                                            ? { ...current, location: event.target.value || null }
                                            : current
                                        )
                                      }
                                      placeholder="Location"
                                    />
                                    <AdminSelect
                                      value={draft.seniority_level ?? ""}
                                      onChange={(event) =>
                                        setDraft((current) =>
                                          current
                                            ? {
                                                ...current,
                                                seniority_level:
                                                  (event.target.value as SeniorityLevel) || null,
                                              }
                                            : current
                                        )
                                      }
                                    >
                                      <option value="">No seniority</option>
                                      {SENIORITY_OPTIONS.map((option) => (
                                        <option key={option} value={option}>
                                          {option}
                                        </option>
                                      ))}
                                    </AdminSelect>
                                    <AdminSelect
                                      value={draft.employment_type ?? ""}
                                      onChange={(event) =>
                                        setDraft((current) =>
                                          current
                                            ? {
                                                ...current,
                                                employment_type:
                                                  (event.target.value as EmploymentType) || null,
                                              }
                                            : current
                                        )
                                      }
                                    >
                                      <option value="">No employment type</option>
                                      {EMPLOYMENT_OPTIONS.map((option) => (
                                        <option key={option} value={option}>
                                          {option}
                                        </option>
                                      ))}
                                    </AdminSelect>
                                    <AdminInput
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={String(draft.sponsorship_score)}
                                      onChange={(event) =>
                                        setDraft((current) =>
                                          current
                                            ? {
                                                ...current,
                                                sponsorship_score: Number(event.target.value),
                                              }
                                            : current
                                        )
                                      }
                                    />
                                    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm text-gray-700">
                                      <label className="inline-flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={draft.is_remote}
                                          onChange={(event) =>
                                            setDraft((current) =>
                                              current
                                                ? { ...current, is_remote: event.target.checked }
                                                : current
                                            )
                                          }
                                        />
                                        Remote
                                      </label>
                                      <label className="inline-flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={draft.is_active}
                                          onChange={(event) =>
                                            setDraft((current) =>
                                              current
                                                ? { ...current, is_active: event.target.checked }
                                                : current
                                            )
                                          }
                                        />
                                        Active
                                      </label>
                                      <label className="inline-flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={draft.requires_authorization}
                                          onChange={(event) =>
                                            setDraft((current) =>
                                              current
                                                ? {
                                                    ...current,
                                                    requires_authorization: event.target.checked,
                                                  }
                                                : current
                                            )
                                          }
                                        />
                                        Requires authorization
                                      </label>
                                    </div>
                                    <textarea
                                      value={draft.description ?? ""}
                                      onChange={(event) =>
                                        setDraft((current) =>
                                          current
                                            ? {
                                                ...current,
                                                description: event.target.value || null,
                                              }
                                            : current
                                        )
                                      }
                                      className="md:col-span-2 min-h-[140px] rounded-2xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                                      placeholder="Description"
                                    />
                                    <div className="md:col-span-2 flex gap-3">
                                      <AdminButton
                                        onClick={() => void saveDraft(job.id)}
                                        disabled={busyId === job.id}
                                      >
                                        {busyId === job.id ? (
                                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : null}
                                        Save job
                                      </AdminButton>
                                      <AdminButton
                                        tone="secondary"
                                        onClick={() => {
                                          setEditingId(null)
                                          setDraft(null)
                                        }}
                                      >
                                        Cancel
                                      </AdminButton>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                                      Description
                                    </p>
                                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-600">
                                      {job.description ?? "No description stored for this job."}
                                    </p>
                                  </div>
                                )}
                              </div>

                              <div className="rounded-2xl border border-gray-200 bg-[#0f172a] p-4">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                    raw_data JSON
                                  </p>
                                  <AdminBadge tone="dark">
                                    {job.skills?.length ?? 0} skills
                                  </AdminBadge>
                                </div>
                                <pre className="mt-3 max-h-[360px] overflow-auto text-xs leading-6 text-slate-100">
                                  {JSON.stringify(job.raw_data ?? {}, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </AdminPanel>
    </div>
  )
}

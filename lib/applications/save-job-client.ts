/** Shared client helpers for saving a job to the pipeline (job_applications). */

import { publishLocalNotification } from "@/lib/hooks/useNotifications"

export const JOB_APPLICATION_SAVED_EVENT = "hireoven:application-saved"

export type SaveJobToPipelineInput = {
  jobId: string
  jobTitle: string
  companyName: string
  applyUrl: string
  companyLogoUrl?: string | null
  matchScore?: number | null
  source?: string
}

export async function fetchJobSavedState(jobId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/applications?jobId=${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
    if (!res.ok) return false
    const data = (await res.json()) as { hasApplied?: boolean; application?: { id: string } | null }
    return Boolean(data?.hasApplied && data?.application)
  } catch {
    return false
  }
}

async function fetchExistingApplication(jobId: string): Promise<{ id: string; status: string } | null> {
  try {
    const res = await fetch(`/api/applications?jobId=${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
    if (!res.ok) return null
    const data = (await res.json()) as { application?: { id: string; status: string } | null }
    return data?.application ?? null
  } catch {
    return null
  }
}

export type ApplyJobResult =
  | { ok: true; alreadyApplied?: boolean }
  | { ok: false; status: number; message: string }

export async function markJobApplied(input: SaveJobToPipelineInput): Promise<ApplyJobResult> {
  const existing = await fetchExistingApplication(input.jobId)

  if (existing) {
    if (existing.status === "applied") return { ok: true, alreadyApplied: true }
    // Already in pipeline with a different status — promote to applied
    const res = await fetch(`/api/applications/${existing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ status: "applied" }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, status: res.status, message: body.error ?? "Could not update application." }
    }
  } else {
    // Not in pipeline yet — create with status applied
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        jobId: input.jobId,
        jobTitle: input.jobTitle,
        companyName: input.companyName,
        applyUrl: input.applyUrl,
        companyLogoUrl: input.companyLogoUrl ?? undefined,
        status: "applied",
        source: input.source ?? "hireoven",
        matchScore: input.matchScore ?? undefined,
      }),
    })
    if (res.status === 401) return { ok: false, status: 401, message: "Sign in to track applications." }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, status: res.status, message: body.error ?? "Could not track application." }
    }
  }

  publishLocalNotification({
    type: "application",
    tone: "success",
    title: "Application tracked",
    message: `${input.jobTitle} at ${input.companyName} moved to Applied.`,
    href: "/dashboard/applications",
    tags: [
      ...(typeof input.matchScore === "number" && Number.isFinite(input.matchScore)
        ? [{ label: `${Math.round(input.matchScore)}% match`, tone: "success" as const }]
        : []),
      { label: "Applied", tone: "success" },
    ],
    context: { source: "hireoven", jobId: input.jobId, company: input.companyName, matchScore: input.matchScore ?? null },
  })

  return { ok: true }
}

export type SaveJobResult =
  | { ok: true; alreadySaved?: boolean }
  | { ok: false; status: number; message: string }

export async function saveJobToPipeline(input: SaveJobToPipelineInput): Promise<SaveJobResult> {
  const already = await fetchJobSavedState(input.jobId)
  if (already) return { ok: true, alreadySaved: true }

  const res = await fetch("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      jobId: input.jobId,
      jobTitle: input.jobTitle,
      companyName: input.companyName,
      applyUrl: input.applyUrl,
      companyLogoUrl: input.companyLogoUrl ?? undefined,
      status: "saved",
      source: input.source ?? "hireoven",
      matchScore: input.matchScore ?? undefined,
    }),
  })

  if (res.status === 401) {
    return { ok: false, status: 401, message: "Sign in to save jobs to your pipeline." }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return {
      ok: false,
      status: res.status,
      message: body.error ?? "Could not save this job.",
    }
  }

  publishLocalNotification({
    type: "application",
    tone: "success",
    title: "Saved to pipeline",
    message: `${input.jobTitle} at ${input.companyName} is now in Applications.`,
    href: "/dashboard/applications",
    tags: [
      ...(typeof input.matchScore === "number" && Number.isFinite(input.matchScore)
        ? [{ label: `${Math.round(input.matchScore)}% match`, tone: "success" as const }]
        : []),
      { label: "Pipeline", tone: "info" },
    ],
    context: {
      source: "hireoven",
      jobId: input.jobId,
      company: input.companyName,
      matchScore: input.matchScore ?? null,
    },
  })

  return { ok: true }
}

/** Shared client helpers for saving a job to the pipeline (job_applications). */

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
  const res = await fetch(`/api/applications?jobId=${encodeURIComponent(jobId)}`, {
    cache: "no-store",
    credentials: "same-origin",
  })
  if (!res.ok) return false
  const data = (await res.json()) as { hasApplied?: boolean; application?: { id: string } | null }
  return Boolean(data?.hasApplied && data?.application)
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

  return { ok: true }
}

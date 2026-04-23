import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { fetchJobDescription } from "@/lib/jobs/description"
import {
  normalizePersistedJobRecord,
  type PersistedJobForNormalization,
} from "@/lib/jobs/normalization"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Job } from "@/types"

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const body = (await request.json()) as { ids: string[] }
  const ids = body.ids ?? []

  if (!ids.length) {
    return NextResponse.json({ error: "Missing job ids" }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.from("jobs").select("*").in("id", ids)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const jobs = (data ?? []) as Job[]
  const updated: string[] = []
  const refreshedDescriptions: string[] = []

  for (const job of jobs) {
    let jobForNormalization = job

    if (!job.description?.trim() && job.apply_url) {
      const fetchedDescription = await fetchJobDescription(job.apply_url)
      if (fetchedDescription) {
        jobForNormalization = {
          ...job,
          description: fetchedDescription,
        }
        refreshedDescriptions.push(job.id)
      }
    }

    const normalization = normalizePersistedJobRecord(
      jobForNormalization as PersistedJobForNormalization
    )

    const existingRawData =
      jobForNormalization.raw_data && typeof jobForNormalization.raw_data === "object"
        ? (jobForNormalization.raw_data as Record<string, unknown>)
        : {}

    const nextPayload: Record<string, unknown> = {
      ...normalization.nextColumns,
      raw_data: {
        ...existingRawData,
        normalization: {
          version: normalization.canonical.schema_version,
          normalized_at: normalization.canonical.normalized_at,
          confidence_score: normalization.canonical.validation.confidence_score,
          completeness_score: normalization.canonical.validation.completeness_score,
          requires_review: normalization.canonical.validation.requires_review,
          issues: normalization.canonical.validation.issues,
        },
        normalized: normalization.canonical,
        view: {
          page: normalization.pageView,
          card: normalization.cardView,
        },
      },
      updated_at: new Date().toISOString(),
    }

    const { error: updateError } = await ((supabase.from("jobs") as any)
      .update(nextPayload as any)
      .eq("id", job.id))

    if (!updateError) {
      updated.push(job.id)
    }
  }

  return NextResponse.json({
    success: true,
    updated,
    refreshedDescriptions,
  })
}

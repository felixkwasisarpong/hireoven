import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { detectVisaLanguage, extractSkillsFromText, normalizeJobTitle } from "@/lib/crawler/normalizer"
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

  for (const job of jobs) {
    const nextPayload: Record<string, unknown> = {
      normalized_title: normalizeJobTitle(job.title),
      skills: extractSkillsFromText(job.title, job.description),
    }

    if (job.description) {
      const normalized = await detectVisaLanguage(job.description)
      nextPayload.sponsors_h1b = normalized.sponsors_h1b
      nextPayload.sponsorship_score = normalized.sponsorship_score
      nextPayload.visa_language_detected = normalized.visa_language_detected
      nextPayload.requires_authorization = normalized.requires_authorization
    }

    const { error: updateError } = await ((supabase.from("jobs") as any)
      .update(nextPayload as any)
      .eq("id", job.id))

    if (!updateError) {
      updated.push(job.id)
    }
  }

  return NextResponse.json({ success: true, updated })
}

import { createClient } from "@/lib/supabase/server"
import type { AutoApplyPreferences, AutoApplyRecord, AutoApplyCriteria } from "./types"
import { AUTO_APPLY_DEFAULTS } from "./types"

const PREFS_KEY = "auto_apply_preferences"

export async function getAutoApplyPrefs(userId: string): Promise<AutoApplyPreferences> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("profiles")
    .select("auto_apply_prefs")
    .eq("id", userId)
    .single()

  const raw = (data as any)?.auto_apply_prefs
  if (!raw) {
    return { enabled: false, criteria: AUTO_APPLY_DEFAULTS, enabledAt: null }
  }
  return raw as AutoApplyPreferences
}

export async function saveAutoApplyPrefs(
  userId: string,
  prefs: AutoApplyPreferences,
): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from("profiles")
    .update({ auto_apply_prefs: prefs })
    .eq("id", userId)
}

export async function getAutoApplyLog(
  userId: string,
  limit = 20,
): Promise<AutoApplyRecord[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("apex_auto_apply_log")
    .select("*")
    .eq("user_id", userId)
    .order("applied_at", { ascending: false })
    .limit(limit)
  return (data ?? []) as AutoApplyRecord[]
}

export async function logAutoApply(
  userId: string,
  record: Omit<AutoApplyRecord, "id">,
): Promise<void> {
  const supabase = await createClient()
  await supabase.from("apex_auto_apply_log").insert({
    user_id: userId,
    job_id: record.jobId,
    job_title: record.jobTitle,
    company: record.company,
    match_score: record.matchScore,
    applied_at: record.appliedAt,
    qualified_by: record.qualifiedBy,
    cover_letter_id: record.coverLetterId,
    tailored_resume_id: record.tailoredResumeId,
    status: record.status,
    error: record.error,
  })
}

/** How many auto-applies have fired today for this user */
export async function getTodayAutoApplyCount(userId: string): Promise<number> {
  const supabase = await createClient()
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const { count } = await supabase
    .from("apex_auto_apply_log")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "applied")
    .gte("applied_at", startOfDay.toISOString())
  return count ?? 0
}

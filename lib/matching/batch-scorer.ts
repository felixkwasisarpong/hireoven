import pLimit from "p-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { computeFastScore } from "@/lib/matching/fast-scorer"
import type {
  Job,
  JobMatchScore,
  JobMatchScoreInsert,
  Profile,
  Resume,
} from "@/types"

const BACKGROUND_USER_LIMIT = 10_000
const UPSERT_CHUNK_SIZE = 250
const BACKGROUND_CONCURRENCY = 50

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export async function getScoringContextForUser(userId: string) {
  const supabase = createAdminClient()

  const [profileResult, primaryResumeResult, fallbackResumeResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single(),
    supabase
      .from("resumes")
      .select("*")
      .eq("user_id", userId)
      .eq("is_primary", true)
      .eq("parse_status", "complete")
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase
      .from("resumes")
      .select("*")
      .eq("user_id", userId)
      .eq("parse_status", "complete")
      .order("updated_at", { ascending: false })
      .limit(1),
  ])

  const profile = (profileResult.data ?? null) as Profile | null
  const resume =
    ((primaryResumeResult.data?.[0] ?? fallbackResumeResult.data?.[0] ?? null) as Resume | null)

  if (!profile || !resume) return null

  return { profile, resume }
}

async function getJobsByIds(jobIds: string[]) {
  if (jobIds.length === 0) return []

  const supabase = createAdminClient()
  const { data } = await supabase.from("jobs").select("*").in("id", jobIds)

  return (data ?? []) as Job[]
}

export async function upsertMatchScores(scores: JobMatchScoreInsert[]) {
  if (scores.length === 0) return []

  const supabase = createAdminClient()
  const upserted: JobMatchScore[] = []

  for (const chunk of chunkArray(scores, UPSERT_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("job_match_scores")
      .upsert(chunk, {
        onConflict: "user_id,resume_id,job_id",
      })
      .select("*")

    if (error) {
      throw error
    }

    upserted.push(...((data ?? []) as JobMatchScore[]))
  }

  return upserted
}

export async function scoreJobsForUser(userId: string, jobIds: string[]) {
  const uniqueJobIds = Array.from(new Set(jobIds.filter(Boolean)))
  if (uniqueJobIds.length === 0) return new Map<string, JobMatchScore>()

  const context = await getScoringContextForUser(userId)
  if (!context) return new Map<string, JobMatchScore>()

  const supabase = createAdminClient()
  const existingScoresResult = await supabase
    .from("job_match_scores")
    .select("*")
    .eq("user_id", userId)
    .eq("resume_id", context.resume.id)
    .in("job_id", uniqueJobIds)

  if (existingScoresResult.error) {
    throw existingScoresResult.error
  }

  const resumeUpdatedAtMs = new Date(context.resume.updated_at).getTime()
  const existingFreshScores = (existingScoresResult.data ?? []).filter((row) => {
    const computedAtMs = new Date(row.computed_at).getTime()
    return Number.isFinite(computedAtMs) && computedAtMs >= resumeUpdatedAtMs
  }) as JobMatchScore[]

  const existingMap = new Map(existingFreshScores.map((row) => [row.job_id, row]))
  const missingJobIds = uniqueJobIds.filter((jobId) => !existingMap.has(jobId))
  if (missingJobIds.length === 0) return existingMap

  const jobs = await getJobsByIds(missingJobIds)
  if (jobs.length === 0) return existingMap

  const scores = jobs.map((job) =>
    computeFastScore({
      resume: context.resume,
      job,
      profile: context.profile,
    })
  )

  const rows = await upsertMatchScores(scores)
  for (const row of rows) {
    existingMap.set(row.job_id, row)
  }

  return existingMap
}

export async function scoreNewJobForAllUsers(job: Job) {
  const supabase = createAdminClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString()

  const [alertsResult, watchlistResult] = await Promise.all([
    supabase.from("job_alerts").select("user_id").eq("is_active", true),
    supabase.from("watchlist").select("user_id"),
  ])

  const candidateUserIds = Array.from(
    new Set(
      [...(alertsResult.data ?? []), ...(watchlistResult.data ?? [])]
        .map((row) => row.user_id)
        .filter(Boolean)
    )
  ).slice(0, BACKGROUND_USER_LIMIT)

  if (candidateUserIds.length === 0) return

  const [profilesResult, resumesResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .in("id", candidateUserIds)
      .gte("updated_at", thirtyDaysAgo),
    supabase
      .from("resumes")
      .select("*")
      .in("user_id", candidateUserIds)
      .eq("is_primary", true)
      .eq("parse_status", "complete"),
  ])

  const profiles = (profilesResult.data ?? []) as Profile[]
  const resumes = (resumesResult.data ?? []) as Resume[]

  if (profiles.length === 0 || resumes.length === 0) return

  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]))
  const limit = pLimit(BACKGROUND_CONCURRENCY)

  const scoreCandidates = await Promise.all(
    resumes.map((resume) =>
      limit(async () => {
        const profile = profileMap.get(resume.user_id)
        if (!profile) return null

        return computeFastScore({
          resume,
          job,
          profile,
        })
      })
    )
  )

  await upsertMatchScores(
    scoreCandidates.filter((score): score is JobMatchScoreInsert => Boolean(score))
  )
}

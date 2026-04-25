import pLimit from "p-limit"
import { computeFastScore } from "@/lib/matching/fast-scorer"
import { getPostgresPool } from "@/lib/postgres/server"
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
const FAST_SCORE_ALGORITHM_UPDATED_AT = new Date("2026-04-24T23:45:00.000Z").getTime()

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export async function getScoringContextForUser(userId: string) {
  const pool = getPostgresPool()

  const [profileResult, primaryResumeResult, fallbackResumeResult] = await Promise.all([
    pool.query<Profile>("SELECT * FROM profiles WHERE id = $1 LIMIT 1", [userId]),
    pool.query<Resume>(
      `SELECT *
       FROM resumes
       WHERE user_id = $1
         AND is_primary = true
         AND parse_status = 'complete'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query<Resume>(
      `SELECT *
       FROM resumes
       WHERE user_id = $1
         AND parse_status = 'complete'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId]
    ),
  ])

  const profile = profileResult.rows[0] ?? null
  const resume =
    ((primaryResumeResult.rows[0] ?? fallbackResumeResult.rows[0] ?? null) as Resume | null)

  if (!profile || !resume) return null

  return { profile, resume }
}

async function getJobsByIds(jobIds: string[]) {
  if (jobIds.length === 0) return []

  const pool = getPostgresPool()
  const result = await pool.query<Job>("SELECT * FROM jobs WHERE id = ANY($1::uuid[])", [jobIds])

  return result.rows
}

export async function upsertMatchScores(scores: JobMatchScoreInsert[]) {
  if (scores.length === 0) return []

  const pool = getPostgresPool()
  const upserted: JobMatchScore[] = []

  for (const chunk of chunkArray(scores, UPSERT_CHUNK_SIZE)) {
    const params: Array<string | number | boolean | null> = []
    const valuesSql = chunk
      .map((score) => {
        const rowValues = [
          score.user_id,
          score.resume_id,
          score.job_id,
          score.overall_score,
          score.skills_score,
          score.seniority_score,
          score.location_score,
          score.employment_type_score,
          score.sponsorship_score,
          score.is_seniority_match,
          score.is_location_match,
          score.is_employment_type_match,
          score.is_sponsorship_compatible,
          score.matching_skills_count,
          score.total_required_skills,
          score.skills_match_rate,
          score.score_method,
          score.computed_at,
          score.resume_version,
        ]
        const placeholders = rowValues.map((value) => {
          params.push(value)
          return `$${params.length}`
        })
        return `(${placeholders.join(", ")})`
      })
      .join(", ")

    const query = `
      INSERT INTO job_match_scores (
        user_id,
        resume_id,
        job_id,
        overall_score,
        skills_score,
        seniority_score,
        location_score,
        employment_type_score,
        sponsorship_score,
        is_seniority_match,
        is_location_match,
        is_employment_type_match,
        is_sponsorship_compatible,
        matching_skills_count,
        total_required_skills,
        skills_match_rate,
        score_method,
        computed_at,
        resume_version
      ) VALUES ${valuesSql}
      ON CONFLICT (user_id, resume_id, job_id)
      DO UPDATE SET
        overall_score = EXCLUDED.overall_score,
        skills_score = EXCLUDED.skills_score,
        seniority_score = EXCLUDED.seniority_score,
        location_score = EXCLUDED.location_score,
        employment_type_score = EXCLUDED.employment_type_score,
        sponsorship_score = EXCLUDED.sponsorship_score,
        is_seniority_match = EXCLUDED.is_seniority_match,
        is_location_match = EXCLUDED.is_location_match,
        is_employment_type_match = EXCLUDED.is_employment_type_match,
        is_sponsorship_compatible = EXCLUDED.is_sponsorship_compatible,
        matching_skills_count = EXCLUDED.matching_skills_count,
        total_required_skills = EXCLUDED.total_required_skills,
        skills_match_rate = EXCLUDED.skills_match_rate,
        score_method = EXCLUDED.score_method,
        computed_at = EXCLUDED.computed_at,
        resume_version = EXCLUDED.resume_version
      RETURNING *`

    const result = await pool.query<JobMatchScore>(query, params)
    upserted.push(...result.rows)
  }

  return upserted
}

export async function scoreJobsForUser(userId: string, jobIds: string[]) {
  const uniqueJobIds = Array.from(new Set(jobIds.filter(Boolean)))
  if (uniqueJobIds.length === 0) return new Map<string, JobMatchScore>()

  const context = await getScoringContextForUser(userId)
  if (!context) return new Map<string, JobMatchScore>()

  const pool = getPostgresPool()
  const existingScoresResult = await pool.query<JobMatchScore>(
    `SELECT *
     FROM job_match_scores
     WHERE user_id = $1
       AND resume_id = $2
       AND job_id = ANY($3::uuid[])`,
    [userId, context.resume.id, uniqueJobIds]
  )

  const resumeUpdatedAtMs = new Date(context.resume.updated_at).getTime()
  const existingFreshScores = existingScoresResult.rows.filter((row) => {
    const computedAtMs = new Date(row.computed_at).getTime()
    return (
      Number.isFinite(computedAtMs) &&
      computedAtMs >= resumeUpdatedAtMs &&
      computedAtMs >= FAST_SCORE_ALGORITHM_UPDATED_AT
    )
  })

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
  const pool = getPostgresPool()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString()

  const [alertsResult, watchlistResult] = await Promise.all([
    pool.query<{ user_id: string | null }>(
      "SELECT user_id FROM job_alerts WHERE is_active = true AND user_id IS NOT NULL"
    ),
    pool.query<{ user_id: string | null }>("SELECT user_id FROM watchlist WHERE user_id IS NOT NULL"),
  ])

  const candidateUserIds = Array.from(
    new Set(
      [...alertsResult.rows, ...watchlistResult.rows]
        .map((row) => row.user_id)
        .filter(Boolean)
    )
  ).slice(0, BACKGROUND_USER_LIMIT)

  if (candidateUserIds.length === 0) return

  const [profilesResult, resumesResult] = await Promise.all([
    pool.query<Profile>(
      `SELECT *
       FROM profiles
       WHERE id = ANY($1::uuid[])
         AND updated_at >= $2`,
      [candidateUserIds, thirtyDaysAgo]
    ),
    pool.query<Resume>(
      `SELECT *
       FROM resumes
       WHERE user_id = ANY($1::uuid[])
         AND is_primary = true
         AND parse_status = 'complete'`,
      [candidateUserIds]
    ),
  ])

  const profiles = profilesResult.rows
  const resumes = resumesResult.rows

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

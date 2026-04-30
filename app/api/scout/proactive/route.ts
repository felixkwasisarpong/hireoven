import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { ScoutProactiveSnapshot } from "@/lib/scout/proactive/types"

export const runtime = "nodejs"
export const maxDuration = 20

type ProfileRow = {
  desired_roles: string[] | null
}

type ResumeRow = {
  top_skills: string[] | null
}

type HighMatchRow = {
  job_id: string
  job_title: string
  company_id: string | null
  company_name: string | null
  overall_score: number
  sponsors_h1b: boolean
}

type StaleSavedRow = {
  application_id: string
  job_id: string | null
  job_title: string
  company_name: string
  created_at: string
}

type FollowUpRow = {
  application_id: string
  job_id: string | null
  job_title: string
  company_name: string
  status: string
  applied_at: string | null
  timeline: unknown
}

type InterviewRow = {
  application_id: string
  job_id: string | null
  company_id: string | null
  job_title: string
  company_name: string
  interviews: unknown
}

type CompanySpikeRow = {
  company_id: string
  company_name: string
  fresh_role_count: number
}

type SkillDemandRow = {
  skill: string
  demand_count: number
}

type TimelineEntryLike = { date?: string }
type InterviewLike = { date?: string; round_name?: string }

const FOLLOW_UP_THRESHOLD: Record<string, number> = {
  applied: 7,
  phone_screen: 5,
  interview: 3,
  final_round: 3,
}

const FOLLOW_UP_MEDIUM: Record<string, number> = {
  applied: 14,
  phone_screen: 7,
  interview: 5,
  final_round: 4,
}

const FOLLOW_UP_HIGH: Record<string, number> = {
  applied: 21,
  phone_screen: 10,
  interview: 7,
  final_round: 5,
}

function emptySnapshot(): ScoutProactiveSnapshot {
  return {
    computedAt: new Date().toISOString(),
    highMatches: [],
    sponsorshipFriendlyMatchCount: 0,
    staleSavedJobs: [],
    followUpCandidates: [],
    interviewsSoon: [],
    companySpikes: [],
    skillGaps: [],
  }
}

function toArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }
  return []
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000))
}

function latestActivityMs(appliedAt: string | null, timelineRaw: unknown): number | null {
  const points: number[] = []
  if (appliedAt) {
    const appliedMs = new Date(appliedAt).getTime()
    if (Number.isFinite(appliedMs)) points.push(appliedMs)
  }
  const timeline = toArray<TimelineEntryLike>(timelineRaw)
  for (const entry of timeline) {
    const ms = entry?.date ? new Date(entry.date).getTime() : NaN
    if (Number.isFinite(ms)) points.push(ms)
  }
  if (points.length === 0) return null
  return Math.max(...points)
}

function followUpUrgency(status: string, days: number): "low" | "medium" | "high" {
  const high = FOLLOW_UP_HIGH[status] ?? 21
  const medium = FOLLOW_UP_MEDIUM[status] ?? 14
  if (days >= high) return "high"
  if (days >= medium) return "medium"
  return "low"
}

function pickSkillGaps(rows: SkillDemandRow[], resumeSkills: string[]): ScoutProactiveSnapshot["skillGaps"] {
  const have = new Set(resumeSkills.map((s) => s.trim().toLowerCase()).filter(Boolean))
  const STOP = new Set(["and", "the", "for", "with", "manager", "engineer", "senior", "junior"])

  const gaps: ScoutProactiveSnapshot["skillGaps"] = []
  for (const row of rows) {
    const skill = row.skill.trim().toLowerCase()
    if (!skill || STOP.has(skill) || have.has(skill)) continue
    gaps.push({ skill: row.skill, demandCount: row.demand_count })
    if (gaps.length >= 3) break
  }
  return gaps
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pool = getPostgresPool()
  const snapshotBase = emptySnapshot()

  try {
    const [profileRes, resumeRes] = await Promise.all([
      pool.query<ProfileRow>(
        `SELECT desired_roles
         FROM profiles
         WHERE id = $1
         LIMIT 1`,
        [user.id]
      ),
      pool.query<ResumeRow>(
        `SELECT top_skills
         FROM resumes
         WHERE user_id = $1
           AND parse_status = 'complete'
         ORDER BY is_primary DESC, updated_at DESC
         LIMIT 1`,
        [user.id]
      ),
    ])

    const desiredRoles = profileRes.rows[0]?.desired_roles ?? []
    const rolePatterns = desiredRoles.slice(0, 3).map((r) => `%${r}%`)
    const resumeSkills = resumeRes.rows[0]?.top_skills ?? []

    const [
      highMatchRes,
      staleSavedRes,
      followUpRes,
      interviewsRes,
      companySpikesRes,
      skillDemandRes,
    ] = await Promise.all([
      pool.query<HighMatchRow>(
        `SELECT *
         FROM (
           SELECT DISTINCT ON (score.job_id)
             score.job_id,
             j.title AS job_title,
             c.id AS company_id,
             c.name AS company_name,
             score.overall_score,
             COALESCE(j.sponsors_h1b, false) AS sponsors_h1b
           FROM job_match_scores score
           JOIN jobs j ON j.id = score.job_id
           LEFT JOIN companies c ON c.id = j.company_id
           WHERE score.user_id = $1
             AND score.computed_at >= NOW() - INTERVAL '72 hours'
             AND score.overall_score >= 78
             AND j.is_active = true
           ORDER BY score.job_id, score.computed_at DESC
         ) ranked
         ORDER BY ranked.overall_score DESC
         LIMIT 12`,
        [user.id]
      ),
      pool.query<StaleSavedRow>(
        `SELECT
           ja.id AS application_id,
           ja.job_id,
           ja.job_title,
           ja.company_name,
           ja.created_at
         FROM job_applications ja
         WHERE ja.user_id = $1
           AND ja.is_archived = false
           AND ja.status = 'saved'
           AND ja.created_at <= NOW() - INTERVAL '10 days'
         ORDER BY ja.created_at ASC
         LIMIT 10`,
        [user.id]
      ),
      pool.query<FollowUpRow>(
        `SELECT
           ja.id AS application_id,
           ja.job_id,
           ja.job_title,
           ja.company_name,
           ja.status,
           ja.applied_at,
           ja.timeline
         FROM job_applications ja
         WHERE ja.user_id = $1
           AND ja.is_archived = false
           AND ja.status IN ('applied', 'phone_screen', 'interview', 'final_round')
         ORDER BY ja.updated_at DESC
         LIMIT 120`,
        [user.id]
      ),
      pool.query<InterviewRow>(
        `SELECT
           ja.id AS application_id,
           ja.job_id,
           j.company_id,
           ja.job_title,
           ja.company_name,
           ja.interviews
         FROM job_applications ja
         LEFT JOIN jobs j ON j.id = ja.job_id
         WHERE ja.user_id = $1
           AND ja.is_archived = false
           AND ja.status IN ('phone_screen', 'interview', 'final_round')
           AND ja.interviews IS NOT NULL
           AND jsonb_array_length(ja.interviews) > 0
         ORDER BY ja.updated_at DESC
         LIMIT 120`,
        [user.id]
      ),
      pool.query<CompanySpikeRow>(
        `SELECT
           c.id AS company_id,
           c.name AS company_name,
           COUNT(j.id)::int AS fresh_role_count
         FROM watchlist w
         JOIN companies c ON c.id = w.company_id
         JOIN jobs j ON j.company_id = c.id
         WHERE w.user_id = $1
           AND j.is_active = true
           AND j.first_detected_at >= NOW() - INTERVAL '7 days'
         GROUP BY c.id, c.name
         HAVING COUNT(j.id) >= 2
         ORDER BY fresh_role_count DESC
         LIMIT 4`,
        [user.id]
      ),
      pool.query<SkillDemandRow>(
        `SELECT LOWER(skill) AS skill, COUNT(*)::int AS demand_count
         FROM (
           SELECT UNNEST(j.skills) AS skill
           FROM jobs j
           WHERE j.is_active = true
             AND j.skills IS NOT NULL
             AND j.first_detected_at >= NOW() - INTERVAL '30 days'
             AND (
               COALESCE(array_length($1::text[], 1), 0) = 0
               OR j.title ILIKE ANY($1::text[])
               OR COALESCE(j.normalized_title, '') ILIKE ANY($1::text[])
             )
         ) demand
         GROUP BY LOWER(skill)
         HAVING COUNT(*) >= 3
         ORDER BY demand_count DESC
         LIMIT 60`,
        [rolePatterns]
      ),
    ])

    const sponsorshipFriendlyMatchCount = highMatchRes.rows.filter((r) => r.sponsors_h1b).length

    const staleSavedJobs = staleSavedRes.rows.map((r) => ({
      applicationId: r.application_id,
      jobId: r.job_id ?? undefined,
      jobTitle: r.job_title,
      companyName: r.company_name,
      daysOld: daysSince(r.created_at),
    }))

    const followUpCandidates: ScoutProactiveSnapshot["followUpCandidates"] = []
    for (const row of followUpRes.rows) {
      const threshold = FOLLOW_UP_THRESHOLD[row.status]
      if (!threshold) continue
      const lastMs = latestActivityMs(row.applied_at, row.timeline)
      if (lastMs == null) continue
      const days = Math.max(0, Math.floor((Date.now() - lastMs) / 86_400_000))
      if (days < threshold) continue
      followUpCandidates.push({
        applicationId: row.application_id,
        jobId: row.job_id ?? undefined,
        jobTitle: row.job_title,
        companyName: row.company_name,
        daysStale: days,
        urgency: followUpUrgency(row.status, days),
      })
    }
    followUpCandidates.sort((a, b) => b.daysStale - a.daysStale)

    const interviewsSoon: ScoutProactiveSnapshot["interviewsSoon"] = []
    for (const app of interviewsRes.rows) {
      const rounds = toArray<InterviewLike>(app.interviews)
      for (const round of rounds) {
        const iso = round?.date
        if (!iso) continue
        const ms = new Date(iso).getTime()
        if (!Number.isFinite(ms)) continue
        const diffHours = (ms - Date.now()) / 3_600_000
        if (diffHours < 0 || diffHours > 72) continue
        interviewsSoon.push({
          applicationId: app.application_id,
          jobId: app.job_id ?? undefined,
          companyId: app.company_id ?? undefined,
          jobTitle: app.job_title,
          companyName: app.company_name,
          roundName: round.round_name?.trim() || "Interview round",
          interviewDate: new Date(ms).toISOString(),
          hoursUntil: Math.max(1, Math.round(diffHours)),
        })
      }
    }
    interviewsSoon.sort((a, b) => a.hoursUntil - b.hoursUntil)

    const snapshot: ScoutProactiveSnapshot = {
      computedAt: snapshotBase.computedAt,
      highMatches: highMatchRes.rows.map((r) => ({
        jobId: r.job_id,
        jobTitle: r.job_title,
        companyId: r.company_id ?? undefined,
        companyName: r.company_name ?? undefined,
        matchScore: r.overall_score,
        sponsorsH1b: r.sponsors_h1b,
      })),
      sponsorshipFriendlyMatchCount,
      staleSavedJobs,
      followUpCandidates: followUpCandidates.slice(0, 8),
      interviewsSoon: interviewsSoon.slice(0, 8),
      companySpikes: companySpikesRes.rows.map((r) => ({
        companyId: r.company_id,
        companyName: r.company_name,
        freshRoleCount: r.fresh_role_count,
      })),
      skillGaps: pickSkillGaps(skillDemandRes.rows, resumeSkills),
    }

    return NextResponse.json({ snapshot }, {
      headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=900" },
    })
  } catch (error) {
    console.error("[scout/proactive] snapshot error:", error)
    return NextResponse.json({ snapshot: snapshotBase })
  }
}

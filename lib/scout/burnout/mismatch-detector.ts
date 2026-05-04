import { getPostgresPool } from "@/lib/postgres/server"

type AppRow = {
  job_title: string
  job_skills: string[] | null
  job_seniority: string | null
  job_salary_min: number | null
  job_salary_max: number | null
  match_score: number | null
}

type ProfileRow = {
  top_skills: string[] | null
  seniority_level: string | null
  desired_roles: string[] | null
  desired_seniority: string[] | null
}

function skillOverlapScore(jobSkills: string[], profileSkills: string[]): number {
  if (jobSkills.length === 0 || profileSkills.length === 0) return 50
  const profileSet = new Set(profileSkills.map((s) => s.toLowerCase()))
  const matched = jobSkills.filter((s) => profileSet.has(s.toLowerCase())).length
  return Math.min(100, Math.round((matched / jobSkills.length) * 100))
}

function seniorityMatchScore(jobSeniority: string | null, profileSeniority: string[] | null): number {
  if (!jobSeniority || !profileSeniority?.length) return 70
  const jl = jobSeniority.toLowerCase()
  const matched = profileSeniority.some((s) => jl.includes(s.toLowerCase()) || s.toLowerCase().includes(jl))
  return matched ? 85 : 40
}

export async function computeMismatchScore(userId: string): Promise<number> {
  const pool = getPostgresPool()

  const [appsResult, profileResult] = await Promise.all([
    pool.query<AppRow>(
      `SELECT
         ja.job_title,
         j.skills AS job_skills,
         j.seniority_level AS job_seniority,
         j.salary_min AS job_salary_min,
         j.salary_max AS job_salary_max,
         jms.overall_score AS match_score
       FROM job_applications ja
       LEFT JOIN jobs j ON j.id = ja.job_id
       LEFT JOIN job_match_scores jms ON jms.job_id = ja.job_id AND jms.user_id = ja.user_id
       WHERE ja.user_id = $1
         AND ja.status NOT IN ('saved', 'withdrawn')
         AND ja.created_at >= NOW() - INTERVAL '30 days'
       ORDER BY ja.created_at DESC
       LIMIT 20`,
      [userId]
    ),
    pool.query<ProfileRow>(
      `SELECT top_skills, seniority_level, desired_roles, desired_seniority
       FROM profiles WHERE id = $1`,
      [userId]
    ),
  ])

  const apps = appsResult.rows
  const profile = profileResult.rows[0]

  if (apps.length === 0) return 0

  // If we already have match scores from the platform, use them directly
  const withMatchScores = apps.filter((a) => a.match_score !== null)
  if (withMatchScores.length >= 3) {
    const avgMatch = withMatchScores.reduce((s, a) => s + (a.match_score ?? 0), 0) / withMatchScores.length
    return Math.max(0, Math.round(100 - avgMatch))
  }

  // Fallback: compute match quality from skills + seniority overlap
  const profileSkills = profile?.top_skills ?? []
  const profileSeniority = profile?.desired_seniority ?? (profile?.seniority_level ? [profile.seniority_level] : [])

  const scores = apps.map((app) => {
    const skillScore = skillOverlapScore(app.job_skills ?? [], profileSkills)
    const seniorityScore = seniorityMatchScore(app.job_seniority, profileSeniority)
    return Math.round((skillScore * 0.7 + seniorityScore * 0.3))
  })

  const avgMatch = scores.reduce((s, v) => s + v, 0) / scores.length
  return Math.max(0, Math.round(100 - avgMatch))
}

import { getPostgresPool } from "@/lib/postgres/server"

export type VisibilityBreakdown = {
  activity: { score: number; max: number; note: string }
  profileCompleteness: { score: number; max: number; note: string }
  socialProof: { score: number; max: number; note: string }
  communityPresence: { score: number; max: number; note: string }
}

export type VisibilityScore = {
  score: number
  verdict: "strong" | "building" | "low" | "invisible"
  breakdown: VisibilityBreakdown
  isEstimated: boolean
}

type BrandProfileRow = {
  last_post_detected_at: string | null
  days_since_last_activity: number | null
  linkedin_url: string | null
  has_about_section: boolean | null
  headline: string | null
  skills_count: number | null
  recommendations_count: number | null
  estimated_connections: number | null
  communities_active: number
  linkedin_connected: boolean
}

function daysSince(iso: string | null): number {
  if (!iso) return 9999
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export async function computeVisibilityScore(userId: string): Promise<VisibilityScore> {
  const pool = getPostgresPool()

  // Ensure brand profile row exists
  await pool.query(
    `INSERT INTO public.user_brand_profiles (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  )

  // Pull brand profile + LinkedIn URL from resume as fallback
  const [brandResult, resumeResult] = await Promise.all([
    pool.query<BrandProfileRow>(
      `SELECT last_post_detected_at, days_since_last_activity, linkedin_url, has_about_section,
              headline, skills_count, recommendations_count, estimated_connections,
              communities_active, linkedin_connected
       FROM public.user_brand_profiles WHERE user_id = $1`,
      [userId]
    ),
    pool.query<{ linkedin_url: string | null; skills: unknown; years_of_experience: number | null }>(
      `SELECT linkedin_url, skills, years_of_experience
       FROM resumes WHERE user_id = $1 AND parse_status = 'complete'
       ORDER BY is_primary DESC, updated_at DESC LIMIT 1`,
      [userId]
    ),
  ])

  const brand = brandResult.rows[0] ?? {
    last_post_detected_at: null, days_since_last_activity: null,
    linkedin_url: null, has_about_section: null, headline: null,
    skills_count: null, recommendations_count: null, estimated_connections: null,
    communities_active: 0, linkedin_connected: false,
  }

  const hasLinkedIn = Boolean(brand.linkedin_url ?? resumeResult.rows[0]?.linkedin_url)
  const isEstimated = !brand.linkedin_connected

  // ── ACTIVITY (0–30) ───────────────────────────────────────────────────────
  let activityScore = 0
  let activityNote = "No activity data available — connect LinkedIn or manually update"

  const lastPostDays = brand.last_post_detected_at
    ? daysSince(brand.last_post_detected_at)
    : brand.days_since_last_activity ?? 9999

  if (lastPostDays <= 30) { activityScore = 30; activityNote = "Posted within the last 30 days" }
  else if (lastPostDays <= 90) { activityScore = 20; activityNote = "Posted within the last 90 days" }
  else if (lastPostDays <= 180) { activityScore = 10; activityNote = "Posted within the last 6 months" }
  else if (isEstimated) { activityScore = 0; activityNote = "Estimated: no activity data — assume inactive" }

  // ── PROFILE COMPLETENESS (0–25) ───────────────────────────────────────────
  let profileScore = 0
  if (hasLinkedIn) profileScore += 5
  if (brand.has_about_section === true) profileScore += 8
  if ((brand.headline?.length ?? 0) > 40) profileScore += 7

  const skillsFromResume = (() => {
    const s = resumeResult.rows[0]?.skills
    if (!s || typeof s !== "object") return 0
    const obj = s as { technical?: unknown[]; soft?: unknown[] }
    return (obj.technical?.length ?? 0) + (obj.soft?.length ?? 0)
  })()
  if ((brand.skills_count ?? skillsFromResume) >= 10) profileScore += 5

  const profileNote = hasLinkedIn
    ? `LinkedIn URL found · ${profileScore >= 20 ? "profile looks solid" : "some sections missing"}`
    : "No LinkedIn URL on file — add it in your profile settings"

  // ── SOCIAL PROOF (0–25) ───────────────────────────────────────────────────
  let socialScore = 0
  const recs = brand.recommendations_count ?? 0
  const conns = brand.estimated_connections ?? 0

  if (recs >= 5) socialScore += 15
  else if (recs >= 3) socialScore += 10
  else if (recs >= 1) socialScore += 5

  if (conns >= 500) socialScore += 10
  else if (conns >= 200) socialScore += 7
  else if (conns >= 100) socialScore += 4

  const socialNote = isEstimated
    ? "Estimated: update manually to get accurate score"
    : `${recs} recommendation${recs !== 1 ? "s" : ""} · ${conns >= 500 ? "500+" : conns} connection${conns !== 1 ? "s" : ""}`

  // ── COMMUNITY PRESENCE (0–20) ─────────────────────────────────────────────
  let communityScore = 0
  const communities = brand.communities_active ?? 0
  if (communities >= 3) communityScore = 20
  else if (communities === 2) communityScore = 14
  else if (communities === 1) communityScore = 8

  const communityNote = communities > 0
    ? `Active in ${communities} communit${communities !== 1 ? "ies" : "y"}`
    : "Not active in any communities — LinkedIn groups and newsletters count"

  const total = activityScore + profileScore + socialScore + communityScore
  const verdict: VisibilityScore["verdict"] =
    total >= 75 ? "strong" : total >= 50 ? "building" : total >= 25 ? "low" : "invisible"

  // Persist
  await pool.query(
    `UPDATE public.user_brand_profiles
     SET visibility_score = $1, updated_at = now()
     WHERE user_id = $2`,
    [total, userId]
  )

  return {
    score: total,
    verdict,
    isEstimated,
    breakdown: {
      activity:           { score: activityScore,  max: 30, note: activityNote },
      profileCompleteness:{ score: profileScore,   max: 25, note: profileNote },
      socialProof:        { score: socialScore,    max: 25, note: socialNote },
      communityPresence:  { score: communityScore, max: 20, note: communityNote },
    },
  }
}

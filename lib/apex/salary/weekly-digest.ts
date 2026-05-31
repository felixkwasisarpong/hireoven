import { getPostgresPool } from "@/lib/postgres/server"
import { detectSalaryFloor } from "./floor-detector"

export type SalaryDigest = {
  userId: string
  weekOf: string
  applicationsCount: number
  aboveMarketCount: number
  belowMarketCount: number
  aboveMarketPct: number
  belowMarketPct: number
  detectedFloor: number | null
  marketFloor: number | null
  gapPercent: number | null
  trend: "improving" | "stable" | "worsening"
  recommendation: string
}

function startOfWeekMonday(date: Date): string {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split("T")[0]
}

export async function generateSalaryDigest(userId: string): Promise<SalaryDigest | null> {
  const pool = getPostgresPool()

  // Only run for users active in the last 14 days
  const activityResult = await pool.query<{ last_active: string | null }>(
    `SELECT MAX(updated_at)::text AS last_active
     FROM job_applications
     WHERE user_id = $1`,
    [userId]
  )
  const lastActive = activityResult.rows[0]?.last_active
  if (!lastActive) return null

  const daysSinceActive = Math.floor(
    (Date.now() - new Date(lastActive).getTime()) / 86_400_000
  )
  if (daysSinceActive > 14) return null

  const weekOf = startOfWeekMonday(new Date())

  // Get applications from the past week
  const appsResult = await pool.query<{
    salary_max: number | null
    salary_min: number | null
  }>(
    `SELECT j.salary_max, j.salary_min
     FROM job_applications ja
     LEFT JOIN jobs j ON j.id = ja.job_id
     WHERE ja.user_id = $1
       AND ja.created_at >= NOW() - INTERVAL '7 days'
       AND ja.status NOT IN ('saved')`,
    [userId]
  )

  const applicationsCount = appsResult.rows.length

  // Get floor profile
  let detectedFloor: number | null = null
  let marketFloor: number | null = null
  let gapPercent: number | null = null

  let aboveMarketCount = 0
  let belowMarketCount = 0

  try {
    const floorProfile = await detectSalaryFloor(userId)
    detectedFloor = floorProfile.detectedFloor || null
    marketFloor = floorProfile.marketFloor || null
    gapPercent = floorProfile.gapPercent || null

    for (const row of appsResult.rows) {
      const mid = row.salary_max ?? row.salary_min ?? null
      if (!mid || !marketFloor) continue
      if (mid >= marketFloor * 0.9) aboveMarketCount++
      else belowMarketCount++
    }
  } catch {
    // Non-blocking
  }

  const total = aboveMarketCount + belowMarketCount
  const aboveMarketPct = total > 0 ? Math.round((aboveMarketCount / total) * 100) : 0
  const belowMarketPct = total > 0 ? Math.round((belowMarketCount / total) * 100) : 0

  // Trend: compare this week's above-market% to last week's digest
  const prevResult = await pool.query<{ above_market_pct: number }>(
    `SELECT above_market_pct FROM public.user_salary_digests
     WHERE user_id = $1 AND week_of < $2
     ORDER BY week_of DESC LIMIT 1`,
    [userId, weekOf]
  )
  const prevPct = prevResult.rows[0]?.above_market_pct ?? null

  let trend: "improving" | "stable" | "worsening" = "stable"
  if (prevPct !== null) {
    if (aboveMarketPct > prevPct + 5) trend = "improving"
    else if (aboveMarketPct < prevPct - 5) trend = "worsening"
  }

  const recommendation =
    belowMarketPct > 60
      ? `More than half your applications this week were below your market rate. Apply a minimum salary filter of $${Math.round((marketFloor ?? 120000) / 5000) * 5000} to your job feed next week.`
      : aboveMarketPct >= 70
        ? "Great targeting this week — most of your applications were at or above market rate. Keep this up."
        : "Mixed week. Try using the salary filter in Scout to surface more roles at your target range."

  // Persist the digest
  try {
    await pool.query(
      `INSERT INTO public.user_salary_digests
         (user_id, week_of, applications_count, above_market_count, below_market_count,
          above_market_pct, below_market_pct, detected_floor, market_floor, gap_percent,
          trend, recommendation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (user_id, week_of) DO UPDATE SET
         applications_count = EXCLUDED.applications_count,
         above_market_count = EXCLUDED.above_market_count,
         below_market_count = EXCLUDED.below_market_count,
         above_market_pct = EXCLUDED.above_market_pct,
         below_market_pct = EXCLUDED.below_market_pct,
         detected_floor = EXCLUDED.detected_floor,
         market_floor = EXCLUDED.market_floor,
         gap_percent = EXCLUDED.gap_percent,
         trend = EXCLUDED.trend,
         recommendation = EXCLUDED.recommendation`,
      [userId, weekOf, applicationsCount, aboveMarketCount, belowMarketCount,
       aboveMarketPct, belowMarketPct, detectedFloor, marketFloor, gapPercent,
       trend, recommendation]
    )
  } catch {
    // Non-blocking — still return the digest
  }

  return {
    userId,
    weekOf,
    applicationsCount,
    aboveMarketCount,
    belowMarketCount,
    aboveMarketPct,
    belowMarketPct,
    detectedFloor,
    marketFloor,
    gapPercent,
    trend,
    recommendation,
  }
}

export async function generateDigestForAllActiveUsers(): Promise<void> {
  const pool = getPostgresPool()

  const usersResult = await pool.query<{ id: string }>(
    `SELECT DISTINCT p.id
     FROM profiles p
     JOIN job_applications ja ON ja.user_id = p.id
     WHERE ja.updated_at >= NOW() - INTERVAL '14 days'
       AND p.suspended_at IS NULL`
  )

  const results = await Promise.allSettled(
    usersResult.rows.map((r) => generateSalaryDigest(r.id))
  )

  const succeeded = results.filter((r) => r.status === "fulfilled").length
  const failed = results.filter((r) => r.status === "rejected").length
  console.log(`[salary-digest] Generated for ${succeeded} users, ${failed} failed`)
}

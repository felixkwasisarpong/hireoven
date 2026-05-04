import { getPostgresPool } from "@/lib/postgres/server"
import { benchmarkSalary } from "@/lib/offers/salary-benchmarker"
import { detectSalaryFloor } from "./floor-detector"

export type SalaryIntercept = {
  shouldIntercept: boolean
  jobSalaryMax: number
  userMarketP50: number
  shortfallAmount: number
  shortfallPercent: number
  message: string
  recommendation: string
  alternativeSuggestion: string
  urgencyLevel: "high" | "medium"
}

type JobSalaryRow = {
  title: string
  location: string | null
  salary_min: number | null
  salary_max: number | null
  company_name: string | null
}

export async function checkSalaryBeforeApply(
  userId: string,
  jobId: string
): Promise<SalaryIntercept | null> {
  const pool = getPostgresPool()

  // Fetch job salary data
  const jobResult = await pool.query<JobSalaryRow>(
    `SELECT j.title, j.location, j.salary_min, j.salary_max, c.name AS company_name
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.id = $1`,
    [jobId]
  )

  const job = jobResult.rows[0]
  if (!job) return null

  const jobSalaryMax = job.salary_max ?? job.salary_min ?? null
  if (!jobSalaryMax || jobSalaryMax < 30000) return null

  // Check user's declared salary floor from memory
  const memoryResult = await pool.query<{ summary: string }>(
    `SELECT summary FROM scout_memories
     WHERE user_id = $1
       AND category IN ('salary_preference', 'salary_floor')
       AND summary ILIKE '%floor%' OR summary ILIKE '%minimum%' OR summary ILIKE '%won%t go below%'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  )

  let declaredFloor: number | null = null
  const memSummary = memoryResult.rows[0]?.summary ?? ""
  const floorMatch = memSummary.match(/\$?([\d,]+)k?/i)
  if (floorMatch) {
    const raw = floorMatch[1].replace(/,/g, "")
    const val = parseInt(raw, 10)
    declaredFloor = val < 1000 ? val * 1000 : val
  }

  // Get user's profile for benchmarking
  const profileResult = await pool.query<{
    desired_locations: string[] | null
    desired_roles: string[] | null
  }>(
    `SELECT desired_locations, desired_roles FROM profiles WHERE id = $1`,
    [userId]
  )
  const profile = profileResult.rows[0]

  const benchmarkLocation = job.location ?? profile?.desired_locations?.[0] ?? "Remote"

  // Get market P50 for this specific job
  const benchmark = await benchmarkSalary(job.title, benchmarkLocation, 5, undefined, jobSalaryMax)
  const userMarketP50 = benchmark.marketP50

  if (userMarketP50 === 0) return null

  // Determine if we should intercept
  const isbelowDeclaredFloor = declaredFloor !== null && jobSalaryMax < declaredFloor
  const isBelowMarketP50 = jobSalaryMax < userMarketP50 * 0.9 // within 10% is ok

  if (!isBelowMarketP50 && !isbelowDeclaredFloor) return null

  // Also check the user's detected floor from application history
  let profileFloor: number | null = null
  try {
    const floorProfile = await detectSalaryFloor(userId)
    if (floorProfile.isUnderselling) profileFloor = floorProfile.marketFloor
  } catch {
    // Non-blocking
  }

  const effectiveFloor = Math.max(
    userMarketP50,
    declaredFloor ?? 0,
    profileFloor ?? 0
  )

  if (jobSalaryMax >= effectiveFloor * 0.9) return null

  const shortfallAmount = Math.round(effectiveFloor - jobSalaryMax)
  const shortfallPercent = Math.round((shortfallAmount / effectiveFloor) * 100)

  const urgencyLevel = isbelowDeclaredFloor ? "high" : "medium"

  const message = isbelowDeclaredFloor
    ? `This role pays up to $${jobSalaryMax.toLocaleString()}, which is below your declared minimum of $${declaredFloor!.toLocaleString()}. Applying here may lock in a lower number than you're targeting.`
    : `This role pays up to $${jobSalaryMax.toLocaleString()}. Based on market data for ${job.title} in ${benchmarkLocation}, your market rate is around $${userMarketP50.toLocaleString()}. Applying here may anchor your expectations $${shortfallAmount.toLocaleString()} (${shortfallPercent}%) below your market value.`

  return {
    shouldIntercept: true,
    jobSalaryMax,
    userMarketP50: effectiveFloor,
    shortfallAmount,
    shortfallPercent,
    message,
    recommendation: `Skip this role and target positions at $${effectiveFloor.toLocaleString()}+ to protect your salary trajectory.`,
    alternativeSuggestion: `Filter your job feed for roles paying $${Math.round(effectiveFloor / 5000) * 5000}+ for ${job.title} — the market has roles at this level.`,
    urgencyLevel,
  }
}

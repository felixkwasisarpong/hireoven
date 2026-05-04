import { getPostgresPool } from "@/lib/postgres/server"
import { benchmarkSalary } from "@/lib/offers/salary-benchmarker"

export type SalaryFloorConfidence = "high" | "medium" | "low"

export type SalaryFloorProfile = {
  detectedFloor: number
  marketFloor: number
  gap: number
  gapPercent: number
  isUnderselling: boolean
  confidence: SalaryFloorConfidence
  evidenceSummary: string
  applicationsBelowFloor: number
  applicationsAboveFloor: number
  avgOfferedSalary: number | null
  roleContext: string
  locationContext: string
}

type AppSalaryRow = {
  job_title: string
  location: string | null
  salary_min: number | null
  salary_max: number | null
  offered_salary: number | null
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

function mode<T>(items: T[]): T | null {
  const counts = new Map<string, { item: T; count: number }>()
  for (const item of items) {
    const k = String(item)
    const existing = counts.get(k)
    counts.set(k, existing ? { item, count: existing.count + 1 } : { item, count: 1 })
  }
  let best: T | null = null
  let bestCount = 0
  for (const { item, count } of counts.values()) {
    if (count > bestCount) { best = item; bestCount = count }
  }
  return best
}

export async function detectSalaryFloor(userId: string): Promise<SalaryFloorProfile> {
  const pool = getPostgresPool()

  // Pull applications with linked salary data from jobs table
  const result = await pool.query<AppSalaryRow>(
    `SELECT
       ja.job_title,
       ja.offer_details->>'location' AS location,
       j.salary_min,
       j.salary_max,
       (ja.offer_details->>'base_salary')::integer AS offered_salary
     FROM job_applications ja
     LEFT JOIN jobs j ON j.id = ja.job_id
     WHERE ja.user_id = $1
       AND ja.status NOT IN ('saved', 'withdrawn')
       AND (j.salary_min IS NOT NULL OR j.salary_max IS NOT NULL OR ja.offer_details->>'base_salary' IS NOT NULL)
     ORDER BY ja.created_at DESC
     LIMIT 100`,
    [userId]
  )

  const rows = result.rows

  // Derive the salary midpoint for each application
  const midpoints: number[] = rows.flatMap((r) => {
    const pts: number[] = []
    if (r.salary_min && r.salary_max) pts.push(Math.round((r.salary_min + r.salary_max) / 2))
    else if (r.salary_max) pts.push(r.salary_max)
    else if (r.salary_min) pts.push(r.salary_min)
    if (r.offered_salary) pts.push(r.offered_salary)
    return pts
  })

  const offeredSalaries = rows
    .map((r) => r.offered_salary)
    .filter((s): s is number => s !== null && s > 20000)

  const detectedFloor = midpoints.length > 0 ? median(midpoints) : 0

  // Most common role + location for benchmarking
  const roleContext = mode(rows.map((r) => r.job_title).filter(Boolean)) ?? "Software Engineer"
  const locationContext =
    mode(rows.map((r) => r.location).filter((l): l is string => Boolean(l))) ?? "Remote"

  // Get market P50 for the most common role/location combo
  const benchmark = await benchmarkSalary(roleContext, locationContext, 5, undefined, detectedFloor)
  const marketFloor = benchmark.marketP50

  const gap = Math.max(0, marketFloor - detectedFloor)
  const gapPercent = marketFloor > 0 ? Math.round((gap / marketFloor) * 100) : 0
  const isUnderselling = gapPercent > 10

  const applicationsBelowFloor = midpoints.filter((s) => s < marketFloor * 0.9).length
  const applicationsAboveFloor = midpoints.filter((s) => s >= marketFloor * 0.9).length

  const confidence: SalaryFloorConfidence =
    rows.length >= 10 ? "high" : rows.length >= 5 ? "medium" : "low"

  const avgOfferedSalary =
    offeredSalaries.length > 0
      ? Math.round(offeredSalaries.reduce((s, v) => s + v, 0) / offeredSalaries.length)
      : null

  const evidenceSummary = isUnderselling
    ? `Based on ${rows.length} application${rows.length !== 1 ? "s" : ""}, you have been targeting roles with a median salary of $${detectedFloor.toLocaleString()}. The market ${confidence === "high" ? "P50" : "estimate"} for ${roleContext} in ${locationContext} is $${marketFloor.toLocaleString()} — a gap of $${gap.toLocaleString()} (${gapPercent}%).`
    : `Based on ${rows.length} application${rows.length !== 1 ? "s" : ""}, your salary targeting appears aligned with market rates for ${roleContext} in ${locationContext}.`

  return {
    detectedFloor,
    marketFloor,
    gap,
    gapPercent,
    isUnderselling,
    confidence,
    evidenceSummary,
    applicationsBelowFloor,
    applicationsAboveFloor,
    avgOfferedSalary,
    roleContext,
    locationContext,
  }
}

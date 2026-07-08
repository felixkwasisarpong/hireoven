import { getPostgresPool } from "@/lib/postgres/server"
import type { SalaryBenchmark } from "./types"

type LocationType = "remote" | "sf_bay" | "nyc" | "seattle" | "austin" | "chicago" | "boston" | "other"

const LOCATION_KEYWORDS: Record<LocationType, string[]> = {
  sf_bay: ["san francisco", "sf", "bay area", "palo alto", "mountain view", "menlo park", "sunnyvale", "san jose", "santa clara", "oakland", "fremont", "south bay", "east bay", "ca", "california"],
  nyc: ["new york", "nyc", "brooklyn", "manhattan", "queens", "bronx", "jersey city", "hoboken", "ny", "nj"],
  seattle: ["seattle", "bellevue", "redmond", "kirkland", "wa", "washington"],
  austin: ["austin", "tx", "texas"],
  boston: ["boston", "cambridge", "somerville", "waltham", "ma", "massachusetts"],
  chicago: ["chicago", "il", "illinois"],
  remote: ["remote", "anywhere", "distributed", "work from home", "wfh"],
  other: [],
}

function detectLocationType(location: string | null | undefined): LocationType {
  if (!location) return "other"
  const lower = location.toLowerCase()
  if (/\bremote\b/i.test(lower)) return "remote"
  for (const [type, keywords] of Object.entries(LOCATION_KEYWORDS) as [LocationType, string[]][]) {
    if (type === "other" || type === "remote") continue
    if (keywords.some((kw) => lower.includes(kw))) return type
  }
  return "other"
}

// Normalize a role title to match salary_benchmarks.role_title_normalized
function normalizeRoleTitle(title: string): string[] {
  const lower = title.toLowerCase().trim()
  const candidates: string[] = []

  // Direct matches first
  if (/staff\s+engineer/i.test(lower)) candidates.push("staff engineer")
  if (/principal\s+engineer/i.test(lower)) candidates.push("principal engineer")
  if (/senior\s+engineering\s+manager/i.test(lower) || /sr\.?\s+engineering\s+manager/i.test(lower)) candidates.push("senior engineering manager")
  if (/engineering\s+manager/i.test(lower)) candidates.push("engineering manager")
  if (/director\s+of\s+engineering/i.test(lower) || /director.*engineer/i.test(lower)) candidates.push("director of engineering")
  if (/director\s+of\s+product/i.test(lower) || /director.*product\s+management/i.test(lower)) candidates.push("director of product")
  if (/senior\s+product\s+manager/i.test(lower) || /senior\s+pm\b/i.test(lower) || /sr\.?\s+pm\b/i.test(lower)) candidates.push("senior product manager")
  if (/product\s+manager/i.test(lower) || /\bpm\b/.test(lower)) candidates.push("product manager")
  if (/senior\s+data\s+scientist/i.test(lower)) candidates.push("senior data scientist")
  if (/data\s+scientist/i.test(lower)) candidates.push("data scientist")
  if (/ml\s+engineer/i.test(lower) || /machine\s+learning\s+engineer/i.test(lower)) candidates.push("ml engineer")
  if (/senior\s+software\s+engineer/i.test(lower) || /senior\s+swe\b/i.test(lower) || /\bsrse\b/i.test(lower)) candidates.push("senior software engineer")
  if (/software\s+engineer/i.test(lower) || /\bswe\b/i.test(lower)) candidates.push("software engineer")
  if (/devops\s+engineer/i.test(lower) || /platform\s+engineer/i.test(lower) || /sre\b/i.test(lower) || /site\s+reliability/i.test(lower)) candidates.push("devops engineer")
  if (/security\s+engineer/i.test(lower)) candidates.push("security engineer")
  if (/frontend\s+engineer/i.test(lower) || /front.?end\s+developer/i.test(lower) || /front.?end\s+engineer/i.test(lower)) candidates.push("frontend engineer")
  if (/backend\s+engineer/i.test(lower) || /back.?end\s+developer/i.test(lower)) candidates.push("backend engineer")
  if (/full\s?stack\s+engineer/i.test(lower) || /fullstack/i.test(lower)) candidates.push("full stack engineer")
  if (/data\s+engineer/i.test(lower)) candidates.push("data engineer")
  if (/analytics\s+engineer/i.test(lower)) candidates.push("analytics engineer")
  if (/solutions\s+engineer/i.test(lower)) candidates.push("solutions engineer")
  if (/qa\s+engineer/i.test(lower) || /quality\s+assurance\s+engineer/i.test(lower)) candidates.push("qa engineer")
  if (/senior\s+designer/i.test(lower)) candidates.push("senior designer")
  if (/product\s+designer/i.test(lower)) candidates.push("product designer")
  if (/ux\s+designer/i.test(lower) || /ui\/ux/i.test(lower)) candidates.push("ux designer")
  if (/customer\s+success\s+manager/i.test(lower) || /\bcsm\b/i.test(lower)) candidates.push("customer success manager")
  if (/sales\s+engineer/i.test(lower) || /solutions\s+consultant/i.test(lower)) candidates.push("sales engineer")
  if (/account\s+executive/i.test(lower) || /\bae\b/.test(lower)) candidates.push("account executive")

  // Fallback to broad "software engineer" for unrecognized tech roles
  if (candidates.length === 0 && /engineer|developer/i.test(lower)) {
    candidates.push("software engineer")
  }

  return candidates
}

function percentileLabel(offered: number, p25: number, p50: number, p75: number, p90: number): string {
  if (offered >= p90) return "Above P90 (top 10%)"
  if (offered >= p75) return "P75–P90 (top quartile)"
  if (offered >= p50) return "P50–P75 (above median)"
  if (offered >= p25) return "P25–P50 (below median)"
  return "Below P25 (bottom quartile)"
}

export async function benchmarkSalary(
  roleTitle: string,
  location: string | null | undefined,
  yearsExperience: number,
  companyId?: string,
  offeredSalary?: number | null
): Promise<SalaryBenchmark> {
  const pool = getPostgresPool()
  const locationType = detectLocationType(location)
  const titleCandidates = normalizeRoleTitle(roleTitle)

  // Priority 1: real LCA records for this company + role
  let lcaPrevailingWage: number | null = null
  if (companyId) {
    const lcaResult = await pool.query<{
      wage_rate_from: number | null
      wage_rate_to: number | null
      wage_unit: string | null
      prevailing_wage: number | null
    }>(
      `SELECT lr.wage_rate_from, lr.wage_rate_to, lr.wage_unit, lr.prevailing_wage
       FROM lca_records lr
       WHERE lr.company_id = $1
         AND lr.job_title ILIKE $2
       ORDER BY lr.decision_date DESC NULLS LAST
       LIMIT 20`,
      [companyId, `%${roleTitle.split(" ").slice(0, 3).join(" ")}%`]
    )

    if (lcaResult.rows.length > 0) {
      const wages = lcaResult.rows.flatMap((r) => {
        const toAnnual = (w: number | null, unit: string | null) => {
          if (!w) return null
          const u = unit?.toLowerCase()
          if (u === "hour") return Math.round(w * 2080)
          if (u === "month") return Math.round(w * 12)
          if (u === "bi-weekly" || u === "bi_weekly") return Math.round(w * 26)
          return w // assume annual
        }
        const base = r.prevailing_wage ? toAnnual(r.prevailing_wage, "year") : null
        const from = toAnnual(r.wage_rate_from, r.wage_unit)
        const to = toAnnual(r.wage_rate_to, r.wage_unit)
        return [base, from, to].filter((w): w is number => w !== null && w > 40000 && w < 2000000)
      })
      if (wages.length > 0) {
        wages.sort((a, b) => a - b)
        const mid = Math.floor(wages.length / 2)
        lcaPrevailingWage = wages[mid]
      }
    }
  }

  // Priority 2: company-wide LCA stats
  let companyP50: number | null = null
  if (companyId) {
    const statsResult = await pool.query<{ median_salary: number | null }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY wage_rate_from) AS median_salary
       FROM lca_records lr
       WHERE lr.company_id = $1
         AND lr.wage_unit ILIKE ANY(ARRAY['%year%', '%annual%'])
         AND lr.wage_rate_from > 40000`,
      [companyId]
    )
    companyP50 = statsResult.rows[0]?.median_salary ?? null
  }

  // Priority 3: platform-wide LCA percentiles for this role title
  let lcaP25 = 0, lcaP50 = 0, lcaP75 = 0, lcaP90 = 0
  let usedLcaData = false

  if (titleCandidates.length > 0) {
    const titleLike = `%${titleCandidates[0].split(" ").slice(0, 3).join(" ")}%`
    const percentilesResult = await pool.query<{
      p25: number | null; p50: number | null; p75: number | null; p90: number | null
    }>(
      `SELECT
         percentile_cont(0.25) WITHIN GROUP (ORDER BY annual_wage) AS p25,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY annual_wage) AS p50,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY annual_wage) AS p75,
         percentile_cont(0.90) WITHIN GROUP (ORDER BY annual_wage) AS p90
       FROM (
         SELECT
           CASE LOWER(wage_unit)
             WHEN 'hour'       THEN wage_rate_from * 2080
             WHEN 'bi-weekly'  THEN wage_rate_from * 26
             WHEN 'month'      THEN wage_rate_from * 12
             ELSE wage_rate_from
           END AS annual_wage
         FROM lca_records
         WHERE job_title ILIKE $1
           AND wage_rate_from IS NOT NULL
           AND wage_rate_from > 40000
         LIMIT 1000
       ) wages
       WHERE annual_wage BETWEEN 50000 AND 1500000`,
      [titleLike]
    )
    const prow = percentilesResult.rows[0]
    if (prow?.p50 && prow.p50 > 60000) {
      lcaP25 = Math.round((prow.p25 ?? 0) / 1000) * 1000
      lcaP50 = Math.round((prow.p50 ?? 0) / 1000) * 1000
      lcaP75 = Math.round((prow.p75 ?? 0) / 1000) * 1000
      lcaP90 = Math.round((prow.p90 ?? 0) / 1000) * 1000
      usedLcaData = true
    }
  }

  // Priority 4: salary_benchmarks table fallback
  let p25 = lcaP25, p50 = lcaP50, p75 = lcaP75, p90 = lcaP90
  let usedBenchmarkTable = false
  let benchmarkSource = "platform_lca_data"

  if (!usedLcaData && titleCandidates.length > 0) {
    const benchResult = await pool.query<{
      p25_salary: number; p50_salary: number; p75_salary: number; p90_salary: number
    }>(
      `SELECT p25_salary, p50_salary, p75_salary, p90_salary
       FROM public.salary_benchmarks
       WHERE role_title_normalized = ANY($1::text[])
         AND location_type = $2
       ORDER BY data_year DESC
       LIMIT 1`,
      [titleCandidates, locationType === "other" ? "remote" : locationType]
    )
    if (benchResult.rows[0]) {
      const b = benchResult.rows[0]
      p25 = b.p25_salary; p50 = b.p50_salary; p75 = b.p75_salary; p90 = b.p90_salary
      usedBenchmarkTable = true
      benchmarkSource = `benchmark_estimate (${locationType})`
    }
  }

  // Experience seniority adjustment: +2% per year over 5yr baseline, -2% under
  const expFactor = yearsExperience > 0 ? 1 + (yearsExperience - 5) * 0.02 : 1
  const clamp = (v: number) => Math.round(Math.max(v, 50000) / 1000) * 1000

  if (usedLcaData || usedBenchmarkTable) {
    p25 = clamp(p25 * expFactor)
    p50 = clamp(p50 * expFactor)
    p75 = clamp(p75 * expFactor)
    p90 = clamp(p90 * expFactor)
  }

  // Fallback absolute minimum if we have nothing
  if (p50 === 0) {
    p25 = 120000; p50 = 150000; p75 = 185000; p90 = 225000
    benchmarkSource = "fallback_estimate"
  }

  const negotiableUpTo = companyP50 ? Math.max(p75, Math.round(companyP50 * 1.1)) : p75

  const effectiveOffered = offeredSalary ?? null

  return {
    offered: effectiveOffered,
    marketP25: p25,
    marketP50: p50,
    marketP75: p75,
    marketP90: p90,
    lcaPrevailingWage,
    percentilePosition: effectiveOffered
      ? percentileLabel(effectiveOffered, p25, p50, p75, p90)
      : "Unknown (no salary provided)",
    isBelowMarket: effectiveOffered !== null ? effectiveOffered < p50 : false,
    negotiableUpTo,
    source: benchmarkSource,
    locationType,
  }
}

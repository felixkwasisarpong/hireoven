import { NextResponse } from "next/server"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { getPostgresPool } from "@/lib/postgres/server"
import { requireSignalApiAuth } from "@/lib/signal-api/auth"
import { signalApiError, signalApiJson } from "@/lib/signal-api/http"
import { logAndReturnSignalApiResponse } from "@/lib/signal-api/request-log"
import { skillOverlap, jaccardSimilarity, generateRecommendations } from "@/lib/apex/opportunity-graph/generator"
import type {
  SimilarJobHit,
  AdjacentCompanyHit,
  SkillUnlockHit,
  CareerProgressionHit,
  OpportunityGraphResponse,
} from "@/lib/apex/opportunity-graph/types"

export const runtime = "nodejs"

const PROGRESSION_MAP: Record<string, { targets: string[]; commonGap: string[] }> = {
  "backend engineer": { targets: ["Staff Engineer", "Platform Engineer", "Systems Engineer"], commonGap: ["Kubernetes", "distributed systems", "system design"] },
  "software engineer": { targets: ["Senior Software Engineer", "Staff Engineer", "Engineering Manager"], commonGap: ["system design", "mentorship", "architecture"] },
  "data engineer": { targets: ["Senior Data Engineer", "Platform Engineer", "Data Architect"], commonGap: ["dbt", "Spark", "data modeling"] },
  "infrastructure engineer": { targets: ["Platform Engineer", "Site Reliability Engineer", "DevOps Lead"], commonGap: ["Kubernetes", "Terraform", "observability"] },
  "devops engineer": { targets: ["Platform Engineer", "Site Reliability Engineer", "Infrastructure Lead"], commonGap: ["SRE practices", "incident management", "Kubernetes"] },
  "machine learning engineer": { targets: ["Senior ML Engineer", "ML Platform Engineer", "Applied Scientist"], commonGap: ["MLflow", "model serving", "distributed training"] },
}

function deriveCareerProgression(
  normalizedTitle: string | null,
  userSkills: string[],
): CareerProgressionHit[] {
  if (!normalizedTitle) return []
  const key = normalizedTitle.toLowerCase()
  const match = Object.entries(PROGRESSION_MAP).find(([k]) => key.includes(k))
  if (!match) return []

  const [, prog] = match
  const skillSet = new Set(userSkills.map((s) => s.toLowerCase()))
  return prog.targets.slice(0, 2).map((target) => {
    const gap = prog.commonGap.filter((s) => !skillSet.has(s.toLowerCase()))
    return {
      targetRole: target,
      seniorityStep: (target.toLowerCase().includes("staff") || target.toLowerCase().includes("lead") || target.toLowerCase().includes("senior") ? "up" : "adjacent") as CareerProgressionHit["seniorityStep"],
      skillGap: gap,
      description: `Your profile is${gap.length === 0 ? " closely aligned to" : " building toward"} ${target} roles.${gap.length > 0 ? ` Key gaps: ${gap.slice(0, 2).join(", ")}.` : ""}`,
      confidence: (gap.length <= 1 ? "high" : gap.length <= 3 ? "medium" : "low") as CareerProgressionHit["confidence"],
    }
  })
}

export async function GET(request: Request) {
  const startedAtMs = Date.now()
  const auth = await requireSignalApiAuth(request, {
    requiredScopes: ["signals.read"],
    requireUser: true,
  })
  if (auth instanceof NextResponse) return auth

  const finish = (response: Response) =>
    logAndReturnSignalApiResponse(request, auth, startedAtMs, response)

  const url = new URL(request.url)
  const jobId = url.searchParams.get("jobId") ?? undefined
  const companyId = url.searchParams.get("companyId") ?? undefined
  const skillsParam = url.searchParams.get("skills") ?? ""
  const rolesParam = url.searchParams.get("roles") ?? ""
  const sponsorshipReq = url.searchParams.get("sponsorship") === "true"

  const userSkills: string[] = skillsParam ? skillsParam.split(",").map((s) => s.trim()).filter(Boolean) : []
  const pool = getPostgresPool()

  try {
    let currentJobTitle = rolesParam.split(",")[0]?.trim() ?? "your target role"
    let currentJobSkills = userSkills
    let currentCompanyId = companyId
    let currentCompanyName = "your target company"
    let currentIndustry: string | null = null
    let normalizedTitle: string | null = null

    if (jobId) {
      const jobRes = await pool.query<{
        id: string
        title: string
        skills: string[] | null
        company_id: string
        normalized_title: string | null
      }>(
        `SELECT j.id, j.title, j.skills, j.company_id, j.normalized_title,
                c.name AS company_name, c.industry
         FROM jobs j
         LEFT JOIN companies c ON c.id = j.company_id
         WHERE j.id = $1
           AND ${sqlPublishedJob("j")}
           AND COALESCE(j.raw_data->>'signalTenantId', '') = $2
         LIMIT 1`,
        [jobId, auth.tenantId]
      ).catch(() => null)

      const job = jobRes?.rows?.[0]
      if (job) {
        currentJobTitle = job.title
        currentJobSkills = [...new Set([...(job.skills ?? []), ...userSkills])]
        currentCompanyId = job.company_id
        normalizedTitle = job.normalized_title
        const row = jobRes?.rows?.[0] as Record<string, string | null> | undefined
        currentCompanyName = (row?.["company_name"] as string | null) ?? currentCompanyName
        currentIndustry = (row?.["industry"] as string | null) ?? null
      }
    }

    if (companyId && !currentIndustry) {
      const coRes = await pool.query<{ name: string; industry: string | null }>(
        `SELECT c.name, c.industry
         FROM companies c
         WHERE c.id = $1
           AND EXISTS (
             SELECT 1
             FROM jobs j
             WHERE j.company_id = c.id
               AND ${sqlPublishedJob("j")}
               AND COALESCE(j.raw_data->>'signalTenantId', '') = $2
           )
         LIMIT 1`,
        [companyId, auth.tenantId]
      ).catch(() => null)
      const co = coRes?.rows?.[0]
      if (co) {
        currentCompanyName = co.name
        currentIndustry = co.industry
      }
    }

    let effectiveUserSkills = currentJobSkills
    if (effectiveUserSkills.length < 3) {
      const resumeRes = await pool.query<{ top_skills: string[] | null }>(
        `SELECT top_skills
         FROM resumes
         WHERE user_id = $1
           AND is_primary = true
           AND parse_status = 'complete'
         LIMIT 1`,
        [auth.subjectUserId]
      ).catch(() => null)

      effectiveUserSkills = [...new Set([...effectiveUserSkills, ...(resumeRes?.rows?.[0]?.top_skills ?? [])])]
    }

    if (effectiveUserSkills.length === 0) {
      return finish(signalApiJson(auth, {
        similarJobs: [],
        adjacentCompanies: [],
        skillUnlocks: [],
        careerProgression: [],
        recommendations: [],
        generatedAt: new Date().toISOString(),
      }))
    }

    const similarJobsRes = await pool.query<{
      id: string
      title: string
      company_name: string
      company_id: string
      skills: string[] | null
      sponsors_h1b: boolean | null
      is_remote: boolean
      overlap_count: number
    }>(
      `SELECT j.id, j.title, c.name AS company_name, j.company_id,
              j.skills, j.sponsors_h1b, j.is_remote,
              (SELECT COUNT(*)
               FROM UNNEST(j.skills) AS s
               WHERE LOWER(s) = ANY(
                 SELECT LOWER(e) FROM UNNEST($2::text[]) AS e
               ))::int AS overlap_count
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.is_active = true
         AND ${sqlPublishedJob("j")}
         AND ($1::uuid IS NULL OR j.id != $1::uuid)
         AND j.skills && $2::text[]
         AND COALESCE(j.raw_data->>'signalTenantId', '') = $3
       ORDER BY overlap_count DESC, j.first_detected_at DESC
       LIMIT 12`,
      [jobId ?? null, effectiveUserSkills, auth.tenantId]
    ).catch(() => ({ rows: [] }))

    const similarJobs: SimilarJobHit[] = similarJobsRes.rows
      .filter((r) => r.overlap_count >= 2)
      .slice(0, 6)
      .map((r) => ({
        jobId: r.id,
        title: r.title,
        companyName: r.company_name,
        companyId: r.company_id,
        overlapCount: r.overlap_count,
        overlapSkills: skillOverlap(effectiveUserSkills, r.skills ?? []),
        sponsorsH1b: r.sponsors_h1b,
        isRemote: r.is_remote,
        strength: jaccardSimilarity(effectiveUserSkills, r.skills ?? []),
      }))

    const adjCompaniesRes = await pool.query<{
      company_id: string
      company_name: string
      industry: string | null
      sponsors_h1b: boolean
      matching_job_count: number
      sample_skills: string[] | null
    }>(
      `SELECT c.id AS company_id, c.name AS company_name, c.industry,
              c.sponsors_h1b, COUNT(DISTINCT j.id)::int AS matching_job_count,
              ARRAY_AGG(DISTINCT s.skill ORDER BY s.skill) FILTER (WHERE s.skill IS NOT NULL) AS sample_skills
       FROM companies c
       JOIN jobs j ON j.company_id = c.id
                  AND j.is_active = true
                  AND ${sqlPublishedJob("j")}
                  AND j.skills && $1::text[]
                  AND COALESCE(j.raw_data->>'signalTenantId', '') = $4
       CROSS JOIN LATERAL (
         SELECT UNNEST(j.skills) AS skill
       ) AS s
       WHERE ($2::uuid IS NULL OR c.id != $2::uuid)
         AND ($3::text IS NULL OR c.industry = $3::text OR c.industry IS NULL)
       GROUP BY c.id, c.name, c.industry, c.sponsors_h1b
       HAVING COUNT(DISTINCT j.id) >= 1
       ORDER BY matching_job_count DESC, c.sponsors_h1b DESC
       LIMIT 8`,
      [effectiveUserSkills, currentCompanyId ?? null, currentIndustry, auth.tenantId]
    ).catch(() => ({ rows: [] }))

    const adjacentCompanies: AdjacentCompanyHit[] = adjCompaniesRes.rows.map((r) => ({
      companyId: r.company_id,
      companyName: r.company_name,
      industry: r.industry,
      sponsorsH1b: r.sponsors_h1b,
      matchingJobCount: r.matching_job_count,
      commonSkills: skillOverlap(effectiveUserSkills, r.sample_skills ?? []).slice(0, 5),
      strength: Math.min(1, r.matching_job_count / 10),
    }))

    const skillUnlockRes = await pool.query<{
      skill: string
      job_count: number
      exclusive_count: number
    }>(
      `SELECT skill, COUNT(DISTINCT job_id) AS job_count,
              COUNT(DISTINCT CASE WHEN NOT (skills && $1::text[]) THEN job_id END) AS exclusive_count
       FROM (
         SELECT j.id AS job_id, j.skills, UNNEST(j.skills) AS skill
         FROM jobs j
         WHERE j.is_active = true
           AND ${sqlPublishedJob("j")}
           AND NOT (j.skills @> $1::text[])
           AND COALESCE(j.raw_data->>'signalTenantId', '') = $2
       ) sub
       WHERE LOWER(skill) != ALL(
         SELECT LOWER(s) FROM UNNEST($1::text[]) AS s
       )
       GROUP BY skill
       HAVING COUNT(DISTINCT job_id) >= 3
       ORDER BY job_count DESC
       LIMIT 10`,
      [effectiveUserSkills, auth.tenantId]
    ).catch(() => ({ rows: [] }))

    const skillUnlocks: SkillUnlockHit[] = skillUnlockRes.rows.slice(0, 5).map((r) => ({
      skill: r.skill,
      jobCount: Number(r.job_count),
      netUnlock: Number(r.exclusive_count),
      categories: [],
    }))

    const careerProgression: CareerProgressionHit[] = deriveCareerProgression(
      normalizedTitle,
      effectiveUserSkills,
    )

    const recommendations = generateRecommendations({
      currentJobTitle,
      currentCompanyName,
      userSkills: effectiveUserSkills,
      similarJobs: similarJobs.slice(0, 6),
      adjacentCompanies: adjacentCompanies.slice(0, 5),
      skillUnlocks: skillUnlocks.slice(0, 4),
      careerProgression,
      sponsorshipRequired: sponsorshipReq,
    })

    const response: OpportunityGraphResponse = {
      similarJobs: similarJobs.slice(0, 5),
      adjacentCompanies: adjacentCompanies.slice(0, 4),
      skillUnlocks: skillUnlocks.slice(0, 4),
      careerProgression,
      recommendations,
      generatedAt: new Date().toISOString(),
    }

    return finish(signalApiJson(auth, response))
  } catch (error) {
    console.error("[signal/v1/signals/opportunities] error", error)
    return finish(signalApiError(500, "Unable to load opportunity signals", "INTERNAL_ERROR", auth.requestId, auth.rateLimit, undefined, auth.quota))
  }
}

import { getPostgresPool } from "@/lib/postgres/server"
import type { ScoutMode } from "@/lib/scout/types"
import {
  getScoutBehaviorSignals,
  formatBehaviorSignalsForClaude,
  type ScoutBehaviorSignals,
} from "@/lib/scout/behavior"
import type {
  Job,
  Company,
  Resume,
  JobApplication,
  Profile,
  JobMatchScore,
  JobIntelligence,
  CompanyImmigrationProfileSummary,
} from "@/types"

export type CompareJobContext = {
  id: string
  title: string
  company_name: string
  company_id: string | null
  location: string | null
  is_remote: boolean
  salary_min: number | null
  salary_max: number | null
  sponsors_h1b: boolean | null
  requires_authorization: boolean
  visa_language_detected: string | null
  match_score: number | null
}

export type ScoutContextInput = {
  userId: string
  pagePath?: string
  mode?: ScoutMode
  jobId?: string
  companyId?: string
  resumeId?: string
  applicationId?: string
  /** Explicit job IDs to compare side-by-side */
  compareJobIds?: string[]
  /** If true, auto-fetch up to N watchlist jobs for comparison (used when no explicit IDs given) */
  autoCompare?: boolean
  /** Max jobs to fetch for auto-compare (default 5, capped to 2 for free users) */
  compareLimit?: number
}

export type ScoutContext = {
  user: {
    id: string
    profile: Profile | null
  }
  job: {
    id: string
    title: string
    company_name: string
    location: string | null
    is_remote: boolean
    is_hybrid: boolean
    employment_type: string | null
    seniority_level: string | null
    salary_min: number | null
    salary_max: number | null
    description: string | null
    sponsors_h1b: boolean | null
    requires_authorization: boolean
    visa_language_detected: string | null
    intelligence: JobIntelligence | null
  } | null
  company: {
    id: string
    name: string
    domain: string
    industry: string | null
    size: string | null
    sponsors_h1b: boolean
    sponsorship_confidence: number
    h1b_sponsor_count_1yr: number
    immigration_profile: CompanyImmigrationProfileSummary | null
  } | null
  resume: {
    id: string
    name: string | null
    full_name: string | null
    summary: string | null
    top_skills: string[] | null
    skills: {
      technical: string[]
      soft: string[]
      languages: string[]
      certifications: string[]
    } | null
    seniority_level: string | null
    /** ISO timestamp of last resume update — used for context freshness signal */
    updated_at: string | null
    work_experience: Array<{
      title?: string
      company?: string
      duration?: string
      description?: string
    }> | null
    education: Array<{
      degree?: string
      school?: string
      field?: string
    }> | null
  } | null
  matchScore: {
    overall_score: number
    skills_score: number | null
    seniority_score: number | null
    location_score: number | null
    sponsorship_score: number | null
    is_sponsorship_compatible: boolean | null
    matching_skills_count: number | null
    total_required_skills: number | null
    skills_match_rate: number | null
  } | null
  application: {
    id: string
    status: string
    applied_at: string | null
    notes: string | null
  } | null
  mode: ScoutMode
  pagePath: string | null
  behaviorSignals: ScoutBehaviorSignals | null
  /** Jobs to compare — populated when compareJobIds or autoCompare is set */
  compareJobs: CompareJobContext[] | null
}

/**
 * Retrieves grounded Scout context for the authenticated user.
 * Only returns data the user has access to. Returns null for missing data.
 */
const COMPARE_JOBS_SELECT = `
  SELECT
    j.id,
    j.title,
    COALESCE(c.name, '') AS company_name,
    j.company_id,
    j.location,
    j.is_remote,
    j.salary_min,
    j.salary_max,
    j.sponsors_h1b,
    j.requires_authorization,
    j.visa_language_detected,
    jms.overall_score AS match_score
  FROM jobs j
  LEFT JOIN companies c ON c.id = j.company_id
  LEFT JOIN job_match_scores jms
    ON jms.job_id = j.id AND jms.user_id = $2
  WHERE j.id = ANY($1) AND j.is_active = true
  LIMIT 5
`

const COMPARE_WATCHLIST_SELECT = `
  SELECT
    j.id,
    j.title,
    c.name AS company_name,
    c.id AS company_id,
    j.location,
    j.is_remote,
    j.salary_min,
    j.salary_max,
    j.sponsors_h1b,
    j.requires_authorization,
    j.visa_language_detected,
    jms.overall_score AS match_score
  FROM watchlist w
  INNER JOIN companies c ON c.id = w.company_id
  INNER JOIN jobs j ON j.company_id = c.id AND j.is_active = true
  LEFT JOIN LATERAL (
    SELECT overall_score
    FROM job_match_scores
    WHERE user_id = $1 AND job_id = j.id
    ORDER BY computed_at DESC
    LIMIT 1
  ) AS jms ON TRUE
  WHERE w.user_id = $1
  ORDER BY jms.overall_score DESC NULLS LAST, j.first_detected_at DESC
  LIMIT $2
`

export async function getScoutContext(input: ScoutContextInput): Promise<ScoutContext> {
  const pool = getPostgresPool()
  const {
    userId,
    pagePath,
    mode,
    jobId,
    companyId,
    resumeId,
    applicationId,
    compareJobIds,
    autoCompare,
    compareLimit = 5,
  } = input

  // Fetch user profile and behavior signals concurrently
  const [profileResult, behaviorSignals] = await Promise.all([
    pool.query<Profile>(
      "SELECT * FROM profiles WHERE id = $1 LIMIT 1",
      [userId]
    ),
    getScoutBehaviorSignals(userId).catch(() => null),
  ])
  const profile = profileResult.rows[0] ?? null

  // Fetch job if jobId provided
  let job: Job | null = null
  if (jobId) {
    const jobResult = await pool.query<Job>(
      "SELECT * FROM jobs WHERE id = $1 AND is_active = true LIMIT 1",
      [jobId]
    )
    job = jobResult.rows[0] ?? null
  }

  // Fetch company
  let company: Company | null = null
  const targetCompanyId = companyId ?? job?.company_id
  if (targetCompanyId) {
    const companyResult = await pool.query<Company>(
      "SELECT * FROM companies WHERE id = $1 LIMIT 1",
      [targetCompanyId]
    )
    company = companyResult.rows[0] ?? null
  }

  // Fetch resume
  let resume: Resume | null = null
  if (resumeId) {
    // Specific resume requested - must belong to user
    const resumeResult = await pool.query<Resume>(
      "SELECT * FROM resumes WHERE id = $1 AND user_id = $2 AND parse_status = 'complete' LIMIT 1",
      [resumeId, userId]
    )
    resume = resumeResult.rows[0] ?? null
  } else {
    // Get primary or latest completed resume
    const primaryResult = await pool.query<Resume>(
      `SELECT * FROM resumes 
       WHERE user_id = $1 AND is_primary = true AND parse_status = 'complete' 
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    )
    resume = primaryResult.rows[0] ?? null

    if (!resume) {
      const fallbackResult = await pool.query<Resume>(
        `SELECT * FROM resumes 
         WHERE user_id = $1 AND parse_status = 'complete' 
         ORDER BY updated_at DESC LIMIT 1`,
        [userId]
      )
      resume = fallbackResult.rows[0] ?? null
    }
  }

  // Fetch match score if we have both job and resume
  let matchScore: JobMatchScore | null = null
  if (jobId && resume) {
    const matchResult = await pool.query<JobMatchScore>(
      `SELECT * FROM job_match_scores 
       WHERE user_id = $1 AND job_id = $2 AND resume_id = $3 
       ORDER BY computed_at DESC LIMIT 1`,
      [userId, jobId, resume.id]
    )
    matchScore = matchResult.rows[0] ?? null
  }

  // Fetch application
  let application: JobApplication | null = null
  if (applicationId) {
    const appResult = await pool.query<JobApplication>(
      "SELECT * FROM job_applications WHERE id = $1 AND user_id = $2 LIMIT 1",
      [applicationId, userId]
    )
    application = appResult.rows[0] ?? null
  } else if (jobId) {
    // Check if user has applied to this job
    const appResult = await pool.query<JobApplication>(
      `SELECT * FROM job_applications 
       WHERE user_id = $1 AND job_id = $2 AND is_archived = false 
       ORDER BY created_at DESC LIMIT 1`,
      [userId, jobId]
    )
    application = appResult.rows[0] ?? null
  }

  // Fetch jobs for compare mode
  let compareJobs: CompareJobContext[] | null = null
  if (compareJobIds && compareJobIds.length >= 2) {
    try {
      const result = await pool.query<CompareJobContext>(COMPARE_JOBS_SELECT, [compareJobIds, userId])
      compareJobs = result.rows.length >= 2 ? result.rows : null
    } catch (err) {
      console.error("[Scout] COMPARE_JOBS_SELECT failed:", err)
      compareJobs = null
    }
  } else if (autoCompare) {
    try {
      const limit = Math.min(compareLimit, 5)
      const result = await pool.query<CompareJobContext>(COMPARE_WATCHLIST_SELECT, [userId, limit])
      compareJobs = result.rows.length >= 2 ? result.rows : null
    } catch (err) {
      console.error("[Scout] COMPARE_WATCHLIST_SELECT failed:", err)
      compareJobs = null
    }
  }

  // Build compact context object
  return {
    user: {
      id: userId,
      profile,
    },
    job: job
      ? {
          id: job.id,
          title: job.title,
          company_name: company?.name ?? "Unknown Company",
          location: job.location,
          is_remote: job.is_remote,
          is_hybrid: job.is_hybrid,
          employment_type: job.employment_type,
          seniority_level: job.seniority_level,
          salary_min: job.salary_min,
          salary_max: job.salary_max,
          description: job.description,
          sponsors_h1b: job.sponsors_h1b,
          requires_authorization: job.requires_authorization,
          visa_language_detected: job.visa_language_detected,
          intelligence: job.job_intelligence ?? null,
        }
      : null,
    company: company
      ? {
          id: company.id,
          name: company.name,
          domain: company.domain,
          industry: company.industry,
          size: company.size,
          sponsors_h1b: company.sponsors_h1b,
          sponsorship_confidence: company.sponsorship_confidence,
          h1b_sponsor_count_1yr: company.h1b_sponsor_count_1yr,
          immigration_profile: company.immigration_profile_summary ?? null,
        }
      : null,
    resume: resume
      ? {
          id: resume.id,
          name: resume.name,
          full_name: resume.full_name,
          summary: resume.summary,
          top_skills: resume.top_skills,
          skills: resume.skills,
          seniority_level: resume.seniority_level,
          updated_at: resume.updated_at ?? null,
          work_experience: resume.work_experience as ScoutContext["resume"]["work_experience"],
          education: resume.education as ScoutContext["resume"]["education"],
        }
      : null,
    matchScore: matchScore
      ? {
          overall_score: matchScore.overall_score,
          skills_score: matchScore.skills_score,
          seniority_score: matchScore.seniority_score,
          location_score: matchScore.location_score,
          sponsorship_score: matchScore.sponsorship_score,
          is_sponsorship_compatible: matchScore.is_sponsorship_compatible,
          matching_skills_count: matchScore.matching_skills_count,
          total_required_skills: matchScore.total_required_skills,
          skills_match_rate: matchScore.skills_match_rate,
        }
      : null,
    application: application
      ? {
          id: application.id,
          status: application.status,
          applied_at: application.applied_at,
          notes: application.notes,
        }
      : null,
    mode: mode ?? "general",
    pagePath: pagePath ?? null,
    behaviorSignals,
    compareJobs,
  }
}

/**
 * Formats Scout context into a readable string for Claude.
 */
export function formatScoutContextForClaude(context: ScoutContext): string {
  const sections: string[] = []

  sections.push(`Page Context:
- Mode: ${context.mode}
- Path: ${context.pagePath ?? "Unknown"}`)

  // User profile
  if (context.user.profile) {
    const profile = context.user.profile
    sections.push(`User Profile:
- Visa Status: ${profile.visa_status ?? "Not specified"}
- Preferred Locations: ${profile.preferred_locations?.join(", ") ?? "Any"}
- Years of Experience: ${profile.years_of_experience ?? "Not specified"}
- Requires Sponsorship: ${profile.requires_sponsorship ? "Yes" : "No"}`)
  }

  // Resume
  if (context.resume) {
    const resume = context.resume
    
    // Collect all skills from the skills object
    const allSkills: string[] = []
    if (resume.top_skills && Array.isArray(resume.top_skills)) {
      allSkills.push(...resume.top_skills)
    } else if (resume.skills) {
      if (Array.isArray(resume.skills.technical)) allSkills.push(...resume.skills.technical)
      if (Array.isArray(resume.skills.soft)) allSkills.push(...resume.skills.soft)
      if (Array.isArray(resume.skills.languages)) allSkills.push(...resume.skills.languages)
    }
    
    const resumeUpdated = resume.updated_at
      ? `updated ${new Date(resume.updated_at).toLocaleDateString()}`
      : "update date unknown"
    sections.push(`Resume (${resume.name ?? "Unnamed"}, ${resumeUpdated}):
- IMPORTANT: This resume data is current. Do NOT assume target roles from previous conversation turns.
- Name: ${resume.full_name ?? "Not specified"}
- Seniority Level: ${resume.seniority_level ?? "Not specified"}
- Summary: ${resume.summary ? resume.summary.substring(0, 300) : "No summary"}
- Skills (${allSkills.length}): ${allSkills.slice(0, 15).join(", ") || "None listed"}`)

    if (resume.work_experience && resume.work_experience.length > 0) {
      sections.push(`Recent Experience:
${resume.work_experience
  .slice(0, 3)
  .map((exp) => `  - ${exp.title ?? "Unknown"} at ${exp.company ?? "Unknown Company"}`)
  .join("\n")}`)
    }
  }

  // Job
  if (context.job) {
    const job = context.job
    sections.push(`Job Posting:
- Title: ${job.title}
- Company: ${job.company_name}
- Location: ${job.location ?? "Not specified"} ${job.is_remote ? "(Remote)" : job.is_hybrid ? "(Hybrid)" : ""}
- Employment Type: ${job.employment_type ?? "Not specified"}
- Seniority: ${job.seniority_level ?? "Not specified"}
- Salary Range: ${job.salary_min && job.salary_max ? `$${job.salary_min.toLocaleString()} - $${job.salary_max.toLocaleString()}` : "Not disclosed"}
- Sponsors H-1B: ${job.sponsors_h1b === true ? "Yes" : job.sponsors_h1b === false ? "No" : "Unknown"}
- Requires Authorization: ${job.requires_authorization ? "Yes (sponsorship blocker detected)" : "No explicit blocker"}
- Visa Language: ${job.visa_language_detected ?? "None detected"}`)

    if (job.description) {
      sections.push(`Job Description (excerpt):
${job.description.substring(0, 500)}...`)
    }
  }

  // Company
  if (context.company) {
    const company = context.company
    sections.push(`Company Information:
- Name: ${company.name}
- Industry: ${company.industry ?? "Not specified"}
- Size: ${company.size ?? "Not specified"}
- Sponsors H-1B: ${company.sponsors_h1b ? "Yes" : "No"}
- Sponsorship Confidence: ${company.sponsorship_confidence}%
- H-1B Sponsors (last year): ${company.h1b_sponsor_count_1yr}`)

    if (company.immigration_profile) {
      const profile = company.immigration_profile
      sections.push(`Immigration Profile:
- Recent H-1B Petitions: ${profile.recentH1BPetitions ?? 0}
- Total LCA Applications: ${profile.totalLcaApplications ?? 0}
- LCA Certification Rate: ${profile.lcaCertificationRate ? `${(profile.lcaCertificationRate * 100).toFixed(1)}%` : "Unknown"}`)
    }
  }

  // Match Score
  if (context.matchScore) {
    const score = context.matchScore
    sections.push(`Match Analysis:
- Overall Match: ${score.overall_score}%
- Skills Match: ${score.skills_score ?? "N/A"}% (${score.matching_skills_count ?? 0}/${score.total_required_skills ?? 0} skills)
- Seniority Match: ${score.seniority_score ?? "N/A"}%
- Location Match: ${score.location_score ?? "N/A"}%
- Sponsorship Compatible: ${score.is_sponsorship_compatible ? "Yes" : "No"} (Score: ${score.sponsorship_score ?? "N/A"}%)`)
  }

  // Application Status
  if (context.application) {
    const app = context.application
    sections.push(`Application Status:
- Status: ${app.status}
- Applied: ${app.applied_at ? new Date(app.applied_at).toLocaleDateString() : "Not yet applied"}
- Notes: ${app.notes ?? "No notes"}`)
  }

  // Behavior signals — appended last so they don't crowd page-level context
  if (context.behaviorSignals) {
    const behaviorSection = formatBehaviorSignalsForClaude(context.behaviorSignals)
    if (behaviorSection) {
      sections.push(behaviorSection)
    }
  }

  // Compare jobs — included when user asks for a comparison
  if (context.compareJobs && context.compareJobs.length >= 2) {
    const lines = context.compareJobs.map((cj, i) => {
      const salary =
        cj.salary_min && cj.salary_max
          ? `$${Math.round(cj.salary_min / 1000)}k–$${Math.round(cj.salary_max / 1000)}k`
          : "Salary not disclosed"
      const location = cj.is_remote
        ? "Remote"
        : (cj.location ?? "Location unknown")
      const h1b =
        cj.sponsors_h1b === true
          ? "Sponsors H-1B: Yes"
          : cj.sponsors_h1b === false
          ? "Sponsors H-1B: No"
          : "Sponsors H-1B: Unknown"
      const auth = cj.requires_authorization ? " | Requires authorization (sponsorship risk)" : ""
      const match =
        cj.match_score !== null
          ? `Match: ${cj.match_score}%`
          : "Match: Not scored"

      return `[${i + 1}] "${cj.title}" at ${cj.company_name} | jobId: "${cj.id}" | ${match} | ${location} | ${salary} | ${h1b}${auth}`
    })

    sections.push(
      `Compare Jobs Available (use ONLY these jobIds for the compare response — do NOT invent others):\n${lines.join("\n")}`
    )
  }

  if (sections.length === 0) {
    return "No context available. User has not provided job details, resume, or other information."
  }

  return sections.join("\n\n")
}

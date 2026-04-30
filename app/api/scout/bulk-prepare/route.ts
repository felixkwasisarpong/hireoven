import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { generateCoverLetter } from "@/lib/resume/cover-letter-generator"
import { compareResumeToJob } from "@/lib/resume/hub"
import { logApiUsage } from "@/lib/admin/usage"
import type { BulkFailReason } from "@/lib/scout/bulk-application/types"
import type { Resume, Job, Company } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

type Warning = { code: string; message: string; severity: "info" | "warning" | "error" }

type BulkPrepareBody = {
  jobId?:             string
  jobTitle?:          string
  company?:           string
  applyUrl?:          string | null
  sponsorshipSignal?: string | null
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as BulkPrepareBody | null
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const { jobId, jobTitle, company, applyUrl, sponsorshipSignal } = body
  const warnings: Warning[] = []

  // ── Hard gate 1: apply URL ───────────────────────────────────────────────────
  if (!applyUrl) {
    return NextResponse.json({ failReason: "missing_apply_url" satisfies BulkFailReason })
  }

  // ── Hard gate 2: explicit no-sponsorship blocker ─────────────────────────────
  if (sponsorshipSignal) {
    const sig = sponsorshipSignal.toLowerCase()
    if (/\bno\b|\bnone\b|\bnot\b|\bdoes not sponsor\b|\bwithout sponsorship\b/.test(sig)) {
      return NextResponse.json({ failReason: "no_sponsorship_blocker" satisfies BulkFailReason })
    }
  }

  const pool = getPostgresPool()

  // ── Resolve primary resume ───────────────────────────────────────────────────
  const resumeResult = await pool.query<Resume>(
    `SELECT * FROM resumes
     WHERE user_id = $1 AND is_primary = true AND parse_status = 'complete'
     ORDER BY updated_at DESC LIMIT 1`,
    [user.id]
  ).catch(() => null)

  const resume = resumeResult?.rows?.[0] ?? null
  if (!resume) {
    return NextResponse.json({ failReason: "missing_resume" satisfies BulkFailReason })
  }

  // ── Check autofill profile ───────────────────────────────────────────────────
  const autofillResult = await pool.query<{ id: string }>(
    `SELECT id FROM autofill_profiles WHERE user_id = $1 LIMIT 1`,
    [user.id]
  ).catch(() => null)

  const autofillStatus = (autofillResult?.rows?.length ?? 0) > 0 ? "ready" : "failed"
  if (autofillStatus === "failed") {
    warnings.push({
      code:     "no_autofill_profile",
      message:  "No autofill profile found — form fields won't be pre-filled automatically.",
      severity: "warning",
    })
  }

  // ── Fetch job from DB (needed for cover letter + tailor) ─────────────────────
  let job: (Job & { company: Company }) | null = null
  if (jobId) {
    const jobResult = await pool.query<Job & { company: Company }>(
      `SELECT jobs.*, to_jsonb(companies.*) AS company
       FROM jobs
       LEFT JOIN companies ON companies.id = jobs.company_id
       WHERE jobs.id = $1 LIMIT 1`,
      [jobId]
    ).catch(() => null)
    job = jobResult?.rows?.[0] ?? null
  }

  // ── Resume tailor analysis (local, no AI cost) ───────────────────────────────
  let resumeTailorStatus: string = "skipped"
  let resumeTailorJobId: string | undefined

  if (job?.description) {
    try {
      const analysis = compareResumeToJob(resume, job.description, job.title ?? jobTitle, company ?? job.company?.name)

      const insertResult = await pool.query<{ id: string }>(
        `INSERT INTO resume_tailoring_analyses
           (user_id, resume_id, job_id, job_title, company, job_description,
            match_score, present_keywords, missing_keywords, warnings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          user.id,
          resume.id,
          jobId ?? null,
          job.title ?? jobTitle ?? null,
          company ?? job.company?.name ?? null,
          job.description,
          analysis.matchScore,
          analysis.presentKeywords ?? [],
          analysis.missingKeywords ?? [],
          [],
        ]
      ).catch(() => null)

      if (insertResult?.rows?.[0]?.id) {
        resumeTailorStatus = "ready"
        resumeTailorJobId  = insertResult.rows[0].id
      }

      if (analysis.missingKeywords?.length > 5) {
        warnings.push({
          code:     "low_keyword_match",
          message:  `${analysis.missingKeywords.length} keywords missing from your resume. Consider tailoring before applying.`,
          severity: "warning",
        })
      }
    } catch {
      resumeTailorStatus = "failed"
      warnings.push({
        code:     "tailor_analysis_failed",
        message:  "Resume tailor analysis could not run — you can tailor manually from the review panel.",
        severity: "info",
      })
    }
  } else {
    warnings.push({
      code:     "no_job_description",
      message:  "Job description unavailable — resume tailor skipped.",
      severity: "info",
    })
  }

  // ── Cover letter generation ──────────────────────────────────────────────────
  let coverLetterStatus: string = "skipped"
  let coverLetterId: string | undefined

  if (job) {
    try {
      const coverLetter = await generateCoverLetter(
        resume,
        job,
        { tone: "professional", style: "achievement_focused", length: "medium" },
        user.id
      )
      if (coverLetter?.id) {
        coverLetterStatus = "ready"
        coverLetterId     = coverLetter.id
      }
    } catch {
      coverLetterStatus = "failed"
      warnings.push({
        code:     "cover_letter_failed",
        message:  "Cover letter draft could not be generated — you can generate one from the review panel.",
        severity: "warning",
      })
    }
  } else {
    warnings.push({
      code:     "no_job_data_for_cover",
      message:  "Job not in our database — cover letter skipped. You can generate one after opening the application.",
      severity: "info",
    })
  }

  console.log("[bulk-prepare]", { userId: user.id, jobId, resumeTailorStatus, coverLetterStatus, autofillStatus, warnings: warnings.length })
  if (coverLetterStatus === "ready") {
    await logApiUsage({ service: "anthropic", operation: "bulk-prepare/cover-letter", tokens_used: null, cost_usd: null }).catch(() => {})
  }

  return NextResponse.json({
    resumeTailorStatus,
    resumeTailorJobId,
    coverLetterStatus,
    coverLetterId,
    autofillStatus,
    warnings,
  })
}

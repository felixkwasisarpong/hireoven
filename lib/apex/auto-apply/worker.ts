/**
 * One overnight auto-apply run for one user.
 *
 * Orchestration only — the decisions live in the modules it calls, each of which
 * fails closed on its own: limits.ts decides how many, candidates.ts decides
 * which, fill-runner.ts decides whether a form can actually be completed.
 *
 * The run is a DRY RUN unless `allowSubmit` is explicitly true. A dry run does
 * everything except submit and records status 'dry_run', which is what makes a
 * closed beta possible: the whole pipeline is exercised, cost is measured
 * per-user, and no employer is contacted.
 */

import { randomUUID } from "node:crypto"
import { chromium } from "playwright"
import Anthropic from "@anthropic-ai/sdk"
import { getPostgresPool } from "@/lib/postgres/server"
import { getRemainingAllowance } from "./limits"
import { getAutoApplyCandidates } from "./candidates"
import { runFillAttempt } from "./fill-runner"
import { formatResumeContext } from "@/lib/autofill/resume-context"
import { buildDerivedFacts, computeYearsOfExperience } from "@/lib/autofill/resume-facts"
import type { Plan } from "@/lib/gates"
import type { AutofillProfile } from "@/types"

/** How many candidates to line up per allowed application. */
const CANDIDATE_OVERFETCH = 3
/** Ceiling on attempts per run, so a run of unfillable forms still terminates. */
const MAX_ATTEMPTS_PER_RUN = 15

export type RunOptions = {
  userId: string
  plan: Plan
  timezone?: string
  /** Must be explicitly true to contact employers. Absent means dry run. */
  allowSubmit?: boolean
  /** Try Greenhouse too (54% measured coverage — off by default). */
  includeUnproven?: boolean
}

export type RunResult = {
  runId: string
  attempted: number
  submittable: number
  blocked: number
  failed: number
  costUsd: number
  skippedReason: string | null
}

export async function runAutoApplyForUser(opts: RunOptions): Promise<RunResult> {
  const runId = randomUUID()
  const result: RunResult = {
    runId, attempted: 0, submittable: 0, blocked: 0, failed: 0,
    costUsd: 0, skippedReason: null,
  }

  const allowance = await getRemainingAllowance(opts.userId, opts.plan, opts.timezone ?? "UTC")
  if (allowance.allowed <= 0) {
    result.skippedReason = allowance.reason
    return result
  }

  const pool = getPostgresPool()

  // The profile grounds every deterministic field; without one there is nothing
  // truthful to fill from, so the run stops rather than guessing.
  const { rows: profileRows } = await pool.query<AutofillProfile>(
    `SELECT * FROM autofill_profiles WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [opts.userId],
  ).catch(() => ({ rows: [] as AutofillProfile[] }))
  const profile = profileRows[0]
  if (!profile) {
    result.skippedReason = "no_autofill_profile"
    return result
  }

  const { rows: resumeRows } = await pool.query(
    `SELECT summary, primary_role, top_skills, work_experience, education,
            projects, years_of_experience, raw_text
       FROM resumes WHERE user_id = $1
      ORDER BY is_primary DESC, updated_at DESC LIMIT 1`,
    [opts.userId],
  ).catch(() => ({ rows: [] as unknown[] }))
  const resumeRow = resumeRows[0] as Record<string, unknown> | undefined
  const prose = resumeRow ? formatResumeContext(resumeRow as never) : ""
  // Facts first, prose second. Forms ask "4+ years?" and "what city?", which the
  // résumé settles but only as date ranges and paragraphs — stating the answers
  // up front stops the model reporting that it cannot find them.
  const facts = resumeRow
    ? buildDerivedFacts({
        yearsOfExperience: resumeRow.years_of_experience as number | null,
        primaryRole: resumeRow.primary_role as string | null,
        topSkills: resumeRow.top_skills as string[] | null,
        workExperience: resumeRow.work_experience as never,
        city: profile.city, state: profile.state, country: profile.country,
        highestDegree: profile.highest_degree, fieldOfStudy: profile.field_of_study,
        university: profile.university,
      })
    : ""
  // Same figure the derived-facts block states, reused for level-based rate
  // defaults so the two can never disagree.
  const years = (resumeRow?.years_of_experience as number | null) ||
    computeYearsOfExperience((resumeRow?.work_experience as never) ?? [])
  const resumeContext = [facts, prose].filter(Boolean).join("\n\n")
  if (!prose) {
    result.skippedReason = "no_resume"
    return result
  }

  // Over-fetch deliberately. Fetching exactly `allowed` meant a night where
  // three forms could not be completed produced two applications instead of
  // five — the failures consumed the run even though the cap only counts
  // successes. We now work down a longer list until the allowance is actually
  // filled, bounded by MAX_ATTEMPTS so a bad streak cannot run all night.
  const candidates = await getAutoApplyCandidates(opts.userId, {
    minMatchScore: allowance.limits.minMatchScore,
    limit: allowance.allowed * CANDIDATE_OVERFETCH,
    includeUnproven: opts.includeUnproven,
  })
  if (candidates.length === 0) {
    result.skippedReason = "no_candidates"
    return result
  }

  const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null

  // One browser for the whole run; a fresh context per posting so cookies and
  // storage never leak between employers.
  const browser = await chromium.launch({ headless: true })
  try {
    for (const job of candidates) {
      // Stop once the allowance is genuinely filled, not once it has been
      // attempted. Counting attempts is what let failures eat the night.
      if (result.submittable >= allowance.allowed) break
      if (result.attempted >= MAX_ATTEMPTS_PER_RUN) {
        result.skippedReason = "attempt_limit"
        break
      }

      // Re-check before every attempt rather than trusting the opening figure:
      // a run is long, and the dollar ceiling can trip partway through it.
      const live = await getRemainingAllowance(opts.userId, opts.plan, opts.timezone ?? "UTC")
      if (live.allowed <= 0) {
        result.skippedReason = live.reason
        break
      }

      result.attempted++
      const attempt = await runFillAttempt({
        applyUrl: job.applyUrl,
        ats: job.ats,
        profile,
        resumeContext,
        jobTitle: job.title,
        companyName: job.companyName ?? "the company",
        userId: opts.userId,
        runId,
        anthropic,
        yearsOfExperience: years,
        resume: (resumeRow as never) ?? null,
        allowSubmit: opts.allowSubmit === true,
        browser,
      })
      result.costUsd += attempt.costUsd

      let status: string
      if (attempt.disqualified) {
        // Not a failure of ours — the form asks something we must not or cannot
        // answer. Recorded distinctly so "needs you" stays meaningful.
        status = "failed"
        result.failed++
      }
      else if (attempt.blocked) { status = "failed"; result.blocked++ }
      else if (attempt.error || !attempt.formReached) { status = "failed"; result.failed++ }
      else if (!attempt.ok) {
        // Reached the form but could not complete every required field. Not a
        // failure of the pipeline — a form we must not leave half-filled.
        status = "failed"; result.failed++
      } else {
        result.submittable++
        status = opts.allowSubmit && attempt.submitted ? "applied" : "dry_run"
      }

      await pool.query(
        `INSERT INTO apex_auto_apply_log
           (user_id, job_id, job_title, company, match_score, qualified_by,
            status, error, run_id, apply_url, ats, required_total, required_filled)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT DO NOTHING`,
        [
          opts.userId, job.jobId, job.title, job.companyName, job.matchScore,
          JSON.stringify({ minMatchScore: allowance.limits.minMatchScore, ats: job.ats }),
          status,
          attempt.error ?? (attempt.blocked ? "bot_wall" : attempt.formReached ? null : "no_form"),
          runId, job.applyUrl, job.ats,
          attempt.requiredTotal, attempt.requiredFilled,
        ],
      ).catch(() => {})
    }
  } finally {
    await browser.close().catch(() => {})
  }

  return result
}

/**
 * Run the full AI match analysis (the same one the dashboard's deep-match
 * page calls) for a given job ID, using a given user's primary resume.
 * Caches in resume_analyses just like the API endpoint.
 *
 *   npx tsx scripts/debug-job-match-analysis.ts <jobId> [userEmail]
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"
import { analyzeResumeForJob } from "@/lib/resume/analyzer"
import type { Company, Job, Resume } from "@/types"

async function main() {
  const jobId = process.argv[2]
  const email = process.argv[3] ?? "felixsarpong25@gmail.com"
  if (!jobId) {
    console.error("usage: npx tsx scripts/debug-job-match-analysis.ts <jobId> [userEmail]")
    process.exit(2)
  }

  const pool = getPostgresPool()
  try {
    const user = await pool.query<{ id: string }>(`SELECT id FROM auth.users WHERE email = $1`, [email])
    if (!user.rows[0]) throw new Error(`User not found for email ${email}`)
    const userId = user.rows[0].id

    const resumeRes = await pool.query<Resume>(
      `SELECT * FROM resumes WHERE user_id = $1 AND parse_status = 'parsed' AND archived_at IS NULL
       ORDER BY is_primary DESC, created_at DESC LIMIT 1`,
      [userId]
    )
    const resume = resumeRes.rows[0]
    if (!resume) throw new Error("No parsed primary resume on file")

    const jobRes = await pool.query<Job & { company: Company }>(
      `SELECT jobs.*, to_jsonb(companies.*) AS company
       FROM jobs LEFT JOIN companies ON companies.id = jobs.company_id
       WHERE jobs.id = $1`,
      [jobId]
    )
    const job = jobRes.rows[0]
    if (!job) throw new Error(`Job ${jobId} not found`)

    console.log(`User:    ${email} (${userId})`)
    console.log(`Resume:  ${resume.name ?? resume.file_name} | role=${resume.primary_role ?? "—"} | yrs=${resume.years_of_experience ?? "?"}`)
    console.log(`Job:     ${job.title} @ ${job.company.name} | seniority=${job.seniority_level ?? "—"}`)
    console.log(`\nRunning analyzeResumeForJob (may hit Claude — ~5–15s)...\n`)

    const t0 = Date.now()
    const a = await analyzeResumeForJob(resume, job, userId)
    const ms = Date.now() - t0
    console.log(`Done in ${ms}ms\n`)

    console.log(`═══════════════════════════════════════════════════════════════`)
    console.log(`OVERALL:        ${a.overall_score}/100   verdict=${a.verdict}`)
    console.log(`Apply?          ${a.apply_recommendation}`)
    if (a.apply_reasoning) console.log(`  → ${a.apply_reasoning}`)
    console.log(`═══════════════════════════════════════════════════════════════`)
    console.log(`Skills:         ${a.skills_score}/100`)
    console.log(`Experience:     ${a.experience_score}/100`)
    console.log(`Education:      ${a.education_score}/100`)
    console.log(`Keywords:       ${a.keywords_score}/100`)

    if (a.verdict_summary) {
      console.log(`\nSummary:\n  ${a.verdict_summary}`)
    }

    console.log(`\nMatching skills (${a.matching_skills?.length ?? 0}):`)
    for (const s of (a.matching_skills ?? []).slice(0, 20)) console.log(`  ✓ ${s}`)
    console.log(`\nMissing skills (${a.missing_skills?.length ?? 0}):`)
    for (const s of (a.missing_skills ?? []).slice(0, 20)) console.log(`  ✗ ${s}`)
    if ((a.bonus_skills ?? []).length > 0) {
      console.log(`\nBonus skills (${a.bonus_skills?.length}):`)
      for (const s of (a.bonus_skills ?? []).slice(0, 10)) console.log(`  + ${s}`)
    }

    if (a.experience_match) {
      console.log(`\nExperience match:`)
      console.log("  " + JSON.stringify(a.experience_match, null, 2).split("\n").join("\n  "))
    }

    if ((a.recommendations ?? []).length > 0) {
      console.log(`\nRecommendations:`)
      for (const r of a.recommendations ?? []) {
        const priority = (r as { priority?: string }).priority ?? ""
        const text = (r as { recommendation?: string; text?: string }).recommendation ?? (r as { text?: string }).text ?? JSON.stringify(r)
        console.log(`  [${priority}] ${text}`)
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })

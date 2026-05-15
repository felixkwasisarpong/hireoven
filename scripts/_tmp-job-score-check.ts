import { loadEnvConfig } from '@next/env'
import { Pool } from 'pg'

loadEnvConfig(process.cwd())

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL,
    ssl: undefined,
  })

  const jobId = 'c2bd9461-49c7-4dbb-8460-92a1c8f2dc6a'

  const job = await pool.query(
    `SELECT id, title, company_id, is_active, first_detected_at, updated_at
     FROM jobs
     WHERE id = $1`,
    [jobId]
  )
  console.log('job_rows', job.rows.length)
  console.log(JSON.stringify(job.rows[0] ?? null, null, 2))

  const scores = await pool.query(
    `SELECT user_id, resume_id, overall_score, skills_score, seniority_score,
            education_score, role_fit_score, domain_score, sponsorship_score,
            score_method, computed_at, resume_version, score_breakdown
     FROM job_match_scores
     WHERE job_id = $1
     ORDER BY computed_at DESC`,
    [jobId]
  )

  console.log('score_rows', scores.rows.length)
  console.log(JSON.stringify(scores.rows, null, 2))

  const latestPerUser = await pool.query(
    `SELECT DISTINCT ON (user_id, resume_id)
            user_id, resume_id, overall_score, computed_at, score_method
     FROM job_match_scores
     WHERE job_id = $1
     ORDER BY user_id, resume_id, computed_at DESC`,
    [jobId]
  )

  console.log('latest_per_user_resume', latestPerUser.rows.length)
  console.log(JSON.stringify(latestPerUser.rows, null, 2))

  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

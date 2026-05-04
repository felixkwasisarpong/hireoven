import { getPostgresPool } from "@/lib/postgres/server"
import { calculateGhostJobRisk, probeApplyUrl } from "@/lib/jobs/ghost-job-risk"
import { detectHiringFreeze } from "@/lib/jobs/signals/hiring-freeze-detector"

const BATCH_SIZE = 50
const STALE_HOURS = 24

type JobRow = {
  id: string
  title: string
  normalized_title: string | null
  company_id: string | null
  company_name: string | null
  domain: string | null
  ats_type: string | null
  apply_url: string | null
  salary_min: number | null
  salary_max: number | null
  description: string | null
  is_remote: boolean | null
  first_detected_at: string | null
  last_seen_at: string | null
  raw_data: Record<string, unknown> | null
}

function descriptionVaguenessScore(desc?: string | null): number {
  const text = desc?.replace(/\s+/g, " ").trim() ?? ""
  if (!text) return 10
  if (text.length < 280) return 8
  const vague = ["fast-paced","rockstar","ninja","wear many hats","self starter","competitive salary"]
  return vague.filter((t) => text.toLowerCase().includes(t)).length >= 2 ? 5 : 0
}

function urlStatusToDb(s: string): "live" | "redirects" | "dead" | "unknown" {
  if (s === "ok") return "live"
  if (s === "redirect") return "redirects"
  if (s === "dead") return "dead"
  return "unknown"
}

async function queryRepostCount(
  pool: ReturnType<typeof getPostgresPool>,
  jobId: string,
  companyId: string | null,
  title: string | null
): Promise<number> {
  if (!companyId || !title) return 0
  try {
    const { rows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM jobs
       WHERE company_id = $1
         AND id <> $2
         AND is_active = true
         AND first_detected_at > NOW() - INTERVAL '90 days'
         AND normalized_title ILIKE $3`,
      [companyId, jobId, `%${title.split(/\s+/).slice(0, 4).join("%")}%`]
    )
    return Number(rows[0]?.cnt ?? 0)
  } catch { return 0 }
}

async function scoreJob(pool: ReturnType<typeof getPostgresPool>, job: JobRow): Promise<void> {
  const now = new Date()
  const rawData = job.raw_data as Record<string, unknown> | null
  const postedAt = rawData?.posted_at_normalized as string | null ?? job.first_detected_at

  const [urlStatus, freeze, repostCount] = await Promise.all([
    probeApplyUrl(job.apply_url),
    detectHiringFreeze({ companyId: job.company_id, companyName: job.company_name }),
    queryRepostCount(pool, job.id, job.company_id, job.normalized_title),
  ])

  const result = calculateGhostJobRisk({
    postedAt,
    lastVerifiedAt: job.last_seen_at,
    applyUrlStatus: urlStatus,
    repostCount,
    description: job.description,
    salaryMin: job.salary_min,
    salaryMax: job.salary_max,
    atsType: job.ats_type,
    applyUrl: job.apply_url,
    companyDomain: job.domain,
    isRemote: job.is_remote,
    hasHiringFreeze: freeze.hasHiringFreeze,
    now,
  })

  const dbUrlStatus = urlStatusToDb(urlStatus)
  const scannedAt = now.toISOString()

  await pool.query(
    `INSERT INTO ghost_job_scores
       (job_id, risk_score, risk_level, signals, repost_count, url_status,
        has_hiring_freeze, has_salary, description_vagueness_score, last_scanned_at, updated_at)
     VALUES ($1, $2, $3, '[]'::jsonb, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (job_id) DO UPDATE SET
       risk_score = EXCLUDED.risk_score,
       risk_level = EXCLUDED.risk_level,
       repost_count = EXCLUDED.repost_count,
       url_status = EXCLUDED.url_status,
       has_hiring_freeze = EXCLUDED.has_hiring_freeze,
       has_salary = EXCLUDED.has_salary,
       description_vagueness_score = EXCLUDED.description_vagueness_score,
       last_scanned_at = EXCLUDED.last_scanned_at,
       updated_at = EXCLUDED.updated_at`,
    [
      job.id,
      result.riskScore,
      result.riskLevel,
      repostCount,
      dbUrlStatus,
      freeze.hasHiringFreeze,
      job.salary_min != null || job.salary_max != null,
      descriptionVaguenessScore(job.description),
      scannedAt,
    ]
  )
}

/**
 * Scans stale or unscored ghost jobs in batches.
 * Designed to run as a daily background cron task.
 *
 * Returns a summary of how many jobs were processed, skipped, and failed.
 */
export async function scanStaleGhostJobs(): Promise<{
  processed: number
  failed: number
  durationMs: number
}> {
  const pool = getPostgresPool()
  const started = Date.now()
  let processed = 0
  let failed = 0

  // Fetch stale + unscored active jobs
  const { rows: jobs } = await pool.query<JobRow>(
    `SELECT j.id, j.title, j.normalized_title, j.company_id, c.name AS company_name,
            c.domain, c.ats_type, j.apply_url, j.salary_min, j.salary_max, j.description,
            j.is_remote, j.first_detected_at, j.last_seen_at, j.raw_data
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.is_active = true
       AND (
         -- Not yet scored
         NOT EXISTS (
           SELECT 1 FROM ghost_job_scores gs WHERE gs.job_id = j.id
         )
         OR
         -- Stale score (older than 24 hours)
         EXISTS (
           SELECT 1 FROM ghost_job_scores gs
           WHERE gs.job_id = j.id
             AND gs.last_scanned_at < NOW() - INTERVAL '${STALE_HOURS} hours'
         )
       )
     ORDER BY j.last_seen_at DESC
     LIMIT $1`,
    [BATCH_SIZE]
  )

  // Process sequentially to avoid hammering DB or probe targets
  for (const job of jobs) {
    try {
      await scoreJob(pool, job)
      processed++
    } catch {
      failed++
    }
  }

  return { processed, failed, durationMs: Date.now() - started }
}

/**
 * "Previously sent" recap block for instant emails.
 *
 * An instant alert often carries a single job — a one-row email reads as thin
 * and burns the send. Instead of holding those back (the accumulation window
 * already does what it can), we top the email up: the new job(s) first, then a
 * captioned recap of the roles we instant-emailed this user recently that are
 * STILL open and that they haven't tracked yet.
 *
 * Rules that keep the recap honest:
 *  - never counted in the subject/header ("1 new match" stays 1 new match)
 *  - only fills the space the new jobs left (target row count, see slotsFor)
 *  - same notification_type only, so alert recaps stay alert-shaped and
 *    watchlist recaps stay watchlist-shaped
 *  - job must still be active + published, and not already in the user's tracker
 */
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Job, NotificationType } from "@/types"

/** Rows an instant email aims to show in total (new + recap). */
export const INSTANT_EMAIL_TARGET_ROWS = 5

/** How far back the recap looks for previously-emailed jobs. */
const RECAP_LOOKBACK_DAYS = Math.max(
  1,
  Number(process.env.INSTANT_EMAIL_RECAP_DAYS ?? "7") || 7,
)

/**
 * How many recap rows to fetch given how many NEW jobs the email already shows.
 * Zero once the email is full on its own — a 5-job alert needs no padding.
 */
export function slotsFor(newJobCount: number, target = INSTANT_EMAIL_TARGET_ROWS): number {
  return Math.max(0, target - Math.max(0, newJobCount))
}

export type PreviousInstantJobs = {
  jobs: Job[]
  /** Cached match scores (job_match_scores) keyed by job id, when we have them. */
  scores: Map<string, { overall_score: number }>
}

const EMPTY: PreviousInstantJobs = { jobs: [], scores: new Map() }

/**
 * Most recently instant-emailed jobs for this user that are still worth showing.
 * Best-effort: any failure returns an empty recap so the real email still sends.
 */
export async function fetchPreviouslySentInstantJobs({
  userId,
  notificationType,
  excludeJobIds,
  limit,
}: {
  userId: string
  notificationType: NotificationType
  excludeJobIds: string[]
  limit: number
}): Promise<PreviousInstantJobs> {
  if (limit <= 0) return EMPTY

  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<Job & { recap_match_score: number | null }>(
      `SELECT j.id, j.title, j.company_id, j.location, j.normalized_title, j.employment_type,
              j.seniority_level, j.skills, j.sponsors_h1b, j.sponsorship_score, j.requires_authorization,
              j.apply_url, j.is_remote, j.is_hybrid, j.first_detected_at, j.posted_at,
              j.salary_min, j.salary_max,
              (SELECT ms.overall_score
                 FROM job_match_scores ms
                WHERE ms.user_id = an.user_id AND ms.job_id = j.id
                ORDER BY ms.computed_at DESC NULLS LAST
                LIMIT 1) AS recap_match_score
         FROM alert_notifications an
         JOIN jobs j ON j.id = an.job_id
        WHERE an.user_id = $1
          AND an.notification_type = $2
          AND an.channel IN ('email', 'both')
          AND an.sent_at > now() - make_interval(days => $3)
          AND NOT (j.id = ANY($4::uuid[]))
          AND j.is_active = true
          AND ${sqlPublishedJob("j")}
          AND NOT EXISTS (
                SELECT 1 FROM job_applications ja
                 WHERE ja.user_id = an.user_id AND ja.job_id = j.id
              )
        ORDER BY an.sent_at DESC
        LIMIT $5`,
      [userId, notificationType, RECAP_LOOKBACK_DAYS, excludeJobIds, limit],
    )

    const scores = new Map<string, { overall_score: number }>()
    const jobs = rows.map(({ recap_match_score, ...job }) => {
      if (recap_match_score != null) scores.set(job.id, { overall_score: recap_match_score })
      return job as Job
    })
    return { jobs, scores }
  } catch (error) {
    console.warn("[instant-email] previous-jobs recap lookup failed", {
      userId,
      notificationType,
      error: error instanceof Error ? error.message : String(error),
    })
    return EMPTY
  }
}

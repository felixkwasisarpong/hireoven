/**
 * Apex "receipts" — proof of what Apex did while the user was away.
 *
 * The welcome-screen review (#8) found the strongest retention lever is showing
 * what the agent DID, not what the user could do: "since your last visit, Apex
 * scanned N new roles — M matched your profile, K sponsor-verified." This is
 * that data. Counts are grounded in the live index — nothing invented.
 *
 * Server-only (pg).
 */
import type { Pool } from "pg"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobSponsors } from "@/lib/jobs/sponsorship-sql"

export type ApexReceipts = {
  /** Window used for the counts. */
  hoursBack: number
  /** New active, published roles the crawler added platform-wide in the window. */
  scanned: number
  /** Of those, how many scored a strong match for this user. */
  matched: number
  /** Of the matches, how many are at a sponsoring employer. */
  sponsorVerified: number
}

const MATCH_THRESHOLD = 70

export async function getApexReceipts(
  pool: Pool,
  userId: string,
  hoursBack = 24,
): Promise<ApexReceipts> {
  const since = new Date(Date.now() - hoursBack * 3_600_000).toISOString()

  const [scanned, matched] = await Promise.all([
    // Cheap global count over the indexed first_detected_at window.
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM jobs j
        WHERE j.is_active = true AND ${sqlPublishedJob("j")}
          AND j.first_detected_at >= $1`,
      [since],
    ),
    // New roles that scored a strong match for this user, and the sponsoring slice.
    pool.query<{ matched: number; sponsor: number }>(
      `SELECT COUNT(*)::int AS matched,
              COUNT(*) FILTER (WHERE ${sqlJobSponsors("j", { companyAlias: "c" })})::int AS sponsor
         FROM jobs j
         JOIN job_match_scores jms ON jms.job_id = j.id AND jms.user_id = $1
         LEFT JOIN companies c ON c.id = j.company_id
        WHERE j.is_active = true AND ${sqlPublishedJob("j")}
          AND j.first_detected_at >= $2
          AND jms.overall_score >= ${MATCH_THRESHOLD}`,
      [userId, since],
    ),
  ])

  return {
    hoursBack,
    scanned: scanned.rows[0]?.n ?? 0,
    matched: matched.rows[0]?.matched ?? 0,
    sponsorVerified: matched.rows[0]?.sponsor ?? 0,
  }
}

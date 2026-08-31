import { getPostgresPool } from "@/lib/postgres/server"
import type { AutoApplyPreferences, AutoApplyRecord } from "./types"
import { AUTO_APPLY_DEFAULTS } from "./types"

/**
 * Server-side persistence for auto-apply prefs/log.
 *
 * NOTE: the client panel persists prefs in localStorage; these server helpers
 * are best-effort and degrade gracefully when the optional
 * `profiles.auto_apply_prefs` column or `apex_auto_apply_log` table are absent.
 */

export async function getAutoApplyPrefs(userId: string): Promise<AutoApplyPreferences> {
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ auto_apply_prefs: AutoApplyPreferences | null }>(
      `SELECT auto_apply_prefs FROM profiles WHERE id = $1 LIMIT 1`,
      [userId],
    )
    const raw = rows[0]?.auto_apply_prefs
    if (raw) return raw
  } catch {
    // column/table missing — fall through to defaults
  }
  return { enabled: false, criteria: AUTO_APPLY_DEFAULTS, enabledAt: null }
}

/**
 * `timezone` is saved alongside the prefs because the overnight sweep selects
 * users by their LOCAL hour. Without it the column stays null, the cron falls
 * back to UTC, and someone in the Americas gets their "overnight" run in the
 * early evening — the one thing the feature promises not to do. The browser
 * knows the answer, so the client sends it when the toggle is flipped.
 */
export async function saveAutoApplyPrefs(
  userId: string,
  prefs: AutoApplyPreferences,
  timezone?: string | null,
): Promise<void> {
  try {
    const pool = getPostgresPool()
    await pool.query(
      `UPDATE profiles
          SET auto_apply_prefs = $1::jsonb,
              timezone = COALESCE(NULLIF($3, ''), timezone)
        WHERE id = $2`,
      [JSON.stringify(prefs), userId, timezone ?? null],
    )
  } catch {
    // best-effort — client keeps prefs in localStorage regardless
  }
}

export async function getAutoApplyLog(
  userId: string,
  limit = 20,
): Promise<AutoApplyRecord[]> {
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<AutoApplyRecord>(
      // Explicit column aliases: the table is snake_case and AutoApplyRecord is
      // camelCase, so SELECT * silently produced records whose fields were all
      // undefined on the client.
      `SELECT id,
              job_id            AS "jobId",
              job_title         AS "jobTitle",
              company,
              match_score       AS "matchScore",
              applied_at        AS "appliedAt",
              qualified_by      AS "qualifiedBy",
              cover_letter_id   AS "coverLetterId",
              tailored_resume_id AS "tailoredResumeId",
              status,
              error,
              apply_url         AS "applyUrl",
              ats,
              run_id            AS "runId",
              required_total    AS "requiredTotal",
              required_filled   AS "requiredFilled"
         FROM apex_auto_apply_log
        WHERE user_id = $1
        ORDER BY applied_at DESC
        LIMIT $2`,
      [userId, limit],
    )
    return rows
  } catch {
    return []
  }
}

export async function logAutoApply(
  userId: string,
  record: Omit<AutoApplyRecord, "id">,
): Promise<void> {
  try {
    const pool = getPostgresPool()
    await pool.query(
      `INSERT INTO apex_auto_apply_log
         (user_id, job_id, job_title, company, match_score, applied_at,
          qualified_by, cover_letter_id, tailored_resume_id, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
      [
        userId, record.jobId, record.jobTitle, record.company, record.matchScore,
        record.appliedAt, JSON.stringify(record.qualifiedBy ?? {}),
        record.coverLetterId, record.tailoredResumeId, record.status, record.error,
      ],
    )
  } catch {
    // best-effort
  }
}

/** How many auto-applies have fired today for this user */
export async function getTodayAutoApplyCount(userId: string): Promise<number> {
  try {
    const pool = getPostgresPool()
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM apex_auto_apply_log
       WHERE user_id = $1 AND status = 'applied' AND applied_at >= $2`,
      [userId, startOfDay.toISOString()],
    )
    return parseInt(rows[0]?.count ?? "0", 10)
  } catch {
    return 0
  }
}

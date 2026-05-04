import { getPostgresPool } from "@/lib/postgres/server"
import { getCheckinSet } from "./question-sets"

export type PostHireCheckin = {
  id: string
  hired_outcome_id: string
  user_id: string
  company_id: string | null
  company_name: string | null
  role_title: string | null
  checkin_type: string
  scheduled_at: string
  responses: Record<string, unknown>
  satisfaction_score: number | null
  would_recommend: boolean | null
  compensation_accurate: boolean | null
  role_as_described: boolean | null
  culture_as_described: boolean | null
  red_flags_found: boolean | null
  red_flag_details: string | null
  planning_to_leave: boolean | null
  leave_reason: string | null
}

export async function getPendingCheckinForUser(userId: string): Promise<PostHireCheckin | null> {
  const pool = getPostgresPool()

  const result = await pool.query<PostHireCheckin & { company_name: string | null; role_title: string | null }>(
    `SELECT
       phc.id, phc.hired_outcome_id, phc.user_id, phc.company_id, phc.checkin_type,
       phc.scheduled_at, phc.responses, phc.satisfaction_score, phc.would_recommend,
       phc.compensation_accurate, phc.role_as_described, phc.culture_as_described,
       phc.red_flags_found, phc.red_flag_details, phc.planning_to_leave, phc.leave_reason,
       c.name AS company_name, ho.role_title
     FROM public.post_hire_checkins phc
     LEFT JOIN public.companies c ON c.id = phc.company_id
     LEFT JOIN public.hired_outcomes ho ON ho.id = phc.hired_outcome_id
     WHERE phc.user_id = $1
       AND phc.completed_at IS NULL
       AND phc.skipped = false
       AND phc.scheduled_at <= NOW() + INTERVAL '1 day'
     ORDER BY phc.scheduled_at ASC
     LIMIT 1`,
    [userId]
  )

  return result.rows[0] ?? null
}

export async function markCheckinSkipped(checkinId: string, userId: string): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE public.post_hire_checkins
     SET skipped = true, updated_at = now()
     WHERE id = $1 AND user_id = $2`,
    [checkinId, userId]
  )
}

export async function completeCheckin(
  checkinId: string,
  userId: string,
  responses: Record<string, unknown>
): Promise<void> {
  const pool = getPostgresPool()

  // Parse known fields from responses
  const satisfactionScore = typeof responses.satisfaction === "number"
    ? Math.min(5, Math.max(1, responses.satisfaction))
    : null

  const wouldRecommend =
    responses.recommend === "yes" || responses.recommend === true
      ? true
      : responses.recommend === "no" || responses.recommend === false
        ? false
        : null

  const compensationAccurate =
    responses.comp_accurate === "yes" || responses.comp_accurate === "increased"
      ? true
      : responses.comp_accurate === "different" || responses.comp_accurate === "decreased"
        ? false
        : null

  const roleAsDescribed =
    responses.role_match === "yes"
      ? true
      : responses.role_match === "no"
        ? false
        : null

  const cultureAsDescribed =
    responses.culture === "yes"
      ? true
      : responses.culture === "not_at_all"
        ? false
        : null

  const redFlagsFound =
    responses.red_flags === "yes" || responses.instability === "yes"
      ? true
      : responses.red_flags === "no" || responses.instability === "no"
        ? false
        : null

  const planningToLeave =
    responses.stay_12mo === "no" || responses.planning === "looking"
      ? true
      : responses.stay_12mo === "yes" || responses.planning === "yes" || responses.stay_another === "yes"
        ? false
        : null

  const leaveReason = typeof responses.leave_reason === "string" ? responses.leave_reason
    : typeof responses.what_changed === "string" ? responses.what_changed
    : null

  const redFlagDetails = typeof responses.red_flag_type === "string" ? responses.red_flag_type
    : typeof responses.instability_detail === "string" ? responses.instability_detail
    : typeof responses.what_to_know === "string" ? responses.what_to_know
    : null

  await pool.query(
    `UPDATE public.post_hire_checkins SET
       completed_at = now(),
       responses = $1::jsonb,
       satisfaction_score = $2,
       would_recommend = $3,
       compensation_accurate = $4,
       role_as_described = $5,
       culture_as_described = $6,
       red_flags_found = $7,
       red_flag_details = $8,
       planning_to_leave = $9,
       leave_reason = $10,
       updated_at = now()
     WHERE id = $11 AND user_id = $12`,
    [
      JSON.stringify(responses), satisfactionScore, wouldRecommend,
      compensationAccurate, roleAsDescribed, cultureAsDescribed,
      redFlagsFound, redFlagDetails, planningToLeave, leaveReason,
      checkinId, userId,
    ]
  )

  // Trigger signal extraction async
  const { extractEmployerSignals } = await import("./signal-extractor")
  extractEmployerSignals(checkinId).catch((err) =>
    console.error("[delivery-engine] signal extraction failed:", err instanceof Error ? err.message : err)
  )
}

export function buildCheckinOpeningMessage(checkin: PostHireCheckin): string {
  const set = getCheckinSet(checkin.checkin_type)
  const company = checkin.company_name ?? "your company"
  return set?.openingMessage(company) ?? `How is it going at ${company}?`
}

export async function deliverPendingCheckins(): Promise<void> {
  const pool = getPostgresPool()

  const result = await pool.query<{ user_id: string; id: string }>(
    `SELECT DISTINCT ON (user_id) user_id, id
     FROM public.post_hire_checkins
     WHERE completed_at IS NULL
       AND skipped = false
       AND scheduled_at <= NOW() + INTERVAL '1 day'
     ORDER BY user_id, scheduled_at ASC`
  )

  console.log(`[delivery-engine] ${result.rows.length} pending check-ins to deliver`)
  // Delivery is handled when user logs in — no push without opt-in
}

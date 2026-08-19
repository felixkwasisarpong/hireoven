import type { Pool } from "pg"

/**
 * Admin referral monitoring.
 *
 * The referral state machine has two payouts:
 *   1. Referee reward — 7 days of Pro, granted synchronously at signup by
 *      grantRefereeReward() (lib/referral/rewards.ts).
 *   2. Referrer reward — 14 days of Pro, granted only by processPendingReferrals(),
 *      which is only reachable through the /api/cron/process-referrals route and
 *      only after the referral is 7 days old (anti-throwaway).
 *
 * `status = 'converted'` and `converted_at` are set exclusively inside
 * grantReferrerReward(). So if that cron never runs, every referral stays
 * `pending` forever and no referrer is ever paid — which is invisible without a
 * view like this one. `awaitingPayout` below is the direct health signal: rows
 * that are past the 7-day gate and still unpaid. A non-zero, growing value means
 * the cron is not running.
 */

const REFERRER_REWARD_DAYS = 14
const REFEREE_REWARD_DAYS = 7
const MAX_REFERRAL_REWARDS = 3
const ELIGIBILITY_DAYS = 7

export interface ReferralSummary {
  total: number
  pending: number
  converted: number
  refereeRewardsGranted: number
  referrerRewardsGranted: number
  /** Past the 7-day gate, referee already rewarded, referrer still unpaid. */
  awaitingPayout: number
  /** Oldest awaiting-payout row, in whole days. Null when nothing is waiting. */
  oldestAwaitingDays: number | null
  /** Referees whose granted trial is still running. */
  activeRefereeTrials: number
  /** Referees who went on to a real (Stripe-backed) paid subscription. */
  refereesConvertedToPaid: number
}

export interface ReferralDayPoint {
  day: string
  signups: number
  conversions: number
}

export interface ReferralLeaderRow {
  referrerId: string
  email: string | null
  fullName: string | null
  referralCode: string | null
  total: number
  converted: number
  rewardsGranted: number
  /** Remaining payouts before the 3-reward cap. */
  capRemaining: number
}

export interface ReferralRecentRow {
  id: string
  status: string
  createdAt: string
  convertedAt: string | null
  refereeRewardGrantedAt: string | null
  referrerRewardGrantedAt: string | null
  referrerEmail: string | null
  refereeEmail: string | null
  /** Current plan/status of the referee's subscription, for spot-checking. */
  refereePlan: string | null
  refereeSubStatus: string | null
  refereeTrialEnd: string | null
  /** True once past the 7-day gate with the referrer still unpaid. */
  awaitingPayout: boolean
}

export interface ReferralMetrics {
  windowDays: number
  config: {
    refereeRewardDays: number
    referrerRewardDays: number
    maxReferralRewards: number
    eligibilityDays: number
  }
  summary: ReferralSummary
  series: ReferralDayPoint[]
  leaders: ReferralLeaderRow[]
  recent: ReferralRecentRow[]
}

function dateSpine(windowDays: number): string[] {
  const days: string[] = []
  const today = new Date()
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

export async function buildReferralMetrics(pool: Pool, windowDays = 30): Promise<ReferralMetrics> {
  const spine = dateSpine(windowDays)
  const startIso = new Date(`${spine[0]}T00:00:00.000Z`).toISOString()

  const [summaryRes, seriesRes, leadersRes, recentRes] = await Promise.all([
    pool.query<{
      total: string
      pending: string
      converted: string
      referee_granted: string
      referrer_granted: string
      awaiting_payout: string
      oldest_awaiting_days: string | null
      active_referee_trials: string
      referees_paid: string
    }>(
      `SELECT
         COUNT(*)::text                                                              AS total,
         COUNT(*) FILTER (WHERE status = 'pending')::text                            AS pending,
         COUNT(*) FILTER (WHERE status = 'converted')::text                          AS converted,
         COUNT(*) FILTER (WHERE referee_reward_granted_at IS NOT NULL)::text         AS referee_granted,
         COUNT(*) FILTER (WHERE referrer_reward_granted_at IS NOT NULL)::text        AS referrer_granted,
         COUNT(*) FILTER (
           WHERE status = 'pending'
             AND referee_reward_granted_at IS NOT NULL
             AND referrer_reward_granted_at IS NULL
             AND created_at < now() - ($1 || ' days')::interval
         )::text                                                                     AS awaiting_payout,
         FLOOR(EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (
           WHERE status = 'pending'
             AND referee_reward_granted_at IS NOT NULL
             AND referrer_reward_granted_at IS NULL
             AND created_at < now() - ($1 || ' days')::interval
         ))) / 86400)::text                                                          AS oldest_awaiting_days,
         (SELECT COUNT(*) FROM referrals r2
            JOIN subscriptions s ON s.user_id = r2.referee_id
           WHERE s.status = 'trialing'
             AND (s.current_period_end IS NULL OR s.current_period_end > now()))::text AS active_referee_trials,
         (SELECT COUNT(DISTINCT r3.referee_id) FROM referrals r3
            JOIN subscriptions s2 ON s2.user_id = r3.referee_id
           WHERE s2.status = 'active'
             AND s2.stripe_subscription_id IS NOT NULL)::text                        AS referees_paid
       FROM referrals`,
      [ELIGIBILITY_DAYS]
    ),

    pool.query<{ day: string; signups: string; conversions: string }>(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
              COUNT(r.id) FILTER (WHERE date_trunc('day', r.created_at AT TIME ZONE 'UTC') = d)::text   AS signups,
              COUNT(r2.id) FILTER (WHERE date_trunc('day', r2.converted_at AT TIME ZONE 'UTC') = d)::text AS conversions
         FROM generate_series($1::timestamptz, now(), interval '1 day') AS d
         LEFT JOIN referrals r  ON date_trunc('day', r.created_at AT TIME ZONE 'UTC') = d
         LEFT JOIN referrals r2 ON date_trunc('day', r2.converted_at AT TIME ZONE 'UTC') = d
        GROUP BY d
        ORDER BY d`,
      [startIso]
    ),

    pool.query<{
      referrer_id: string
      email: string | null
      full_name: string | null
      referral_code: string | null
      total: string
      converted: string
      rewards_granted: string
    }>(
      `SELECT r.referrer_id,
              p.email,
              p.full_name,
              p.referral_code,
              COUNT(*)::text                                                       AS total,
              COUNT(*) FILTER (WHERE r.status = 'converted')::text                 AS converted,
              COUNT(*) FILTER (WHERE r.referrer_reward_granted_at IS NOT NULL)::text AS rewards_granted
         FROM referrals r
         LEFT JOIN profiles p ON p.id = r.referrer_id
        GROUP BY r.referrer_id, p.email, p.full_name, p.referral_code
        ORDER BY COUNT(*) DESC, MAX(r.created_at) DESC
        LIMIT 25`
    ),

    pool.query<{
      id: string
      status: string
      created_at: string
      converted_at: string | null
      referee_reward_granted_at: string | null
      referrer_reward_granted_at: string | null
      referrer_email: string | null
      referee_email: string | null
      referee_plan: string | null
      referee_sub_status: string | null
      referee_trial_end: string | null
      awaiting_payout: boolean
    }>(
      `SELECT r.id,
              r.status,
              r.created_at,
              r.converted_at,
              r.referee_reward_granted_at,
              r.referrer_reward_granted_at,
              pr.email AS referrer_email,
              pe.email AS referee_email,
              s.plan   AS referee_plan,
              s.status AS referee_sub_status,
              s.trial_end AS referee_trial_end,
              (r.status = 'pending'
                AND r.referee_reward_granted_at IS NOT NULL
                AND r.referrer_reward_granted_at IS NULL
                AND r.created_at < now() - ($1 || ' days')::interval) AS awaiting_payout
         FROM referrals r
         LEFT JOIN profiles pr ON pr.id = r.referrer_id
         LEFT JOIN profiles pe ON pe.id = r.referee_id
         LEFT JOIN LATERAL (
           SELECT plan, status, trial_end
             FROM subscriptions
            WHERE user_id = r.referee_id
            ORDER BY updated_at DESC NULLS LAST, created_at DESC
            LIMIT 1
         ) s ON true
        ORDER BY r.created_at DESC
        LIMIT 100`,
      [ELIGIBILITY_DAYS]
    ),
  ])

  const s = summaryRes.rows[0]
  const byDay = new Map(seriesRes.rows.map((r) => [r.day, r]))

  return {
    windowDays,
    config: {
      refereeRewardDays: REFEREE_REWARD_DAYS,
      referrerRewardDays: REFERRER_REWARD_DAYS,
      maxReferralRewards: MAX_REFERRAL_REWARDS,
      eligibilityDays: ELIGIBILITY_DAYS,
    },
    summary: {
      total: Number(s?.total ?? 0),
      pending: Number(s?.pending ?? 0),
      converted: Number(s?.converted ?? 0),
      refereeRewardsGranted: Number(s?.referee_granted ?? 0),
      referrerRewardsGranted: Number(s?.referrer_granted ?? 0),
      awaitingPayout: Number(s?.awaiting_payout ?? 0),
      oldestAwaitingDays: s?.oldest_awaiting_days == null ? null : Number(s.oldest_awaiting_days),
      activeRefereeTrials: Number(s?.active_referee_trials ?? 0),
      refereesConvertedToPaid: Number(s?.referees_paid ?? 0),
    },
    series: spine.map((day) => ({
      day,
      signups: Number(byDay.get(day)?.signups ?? 0),
      conversions: Number(byDay.get(day)?.conversions ?? 0),
    })),
    leaders: leadersRes.rows.map((r) => {
      const granted = Number(r.rewards_granted)
      return {
        referrerId: r.referrer_id,
        email: r.email,
        fullName: r.full_name,
        referralCode: r.referral_code,
        total: Number(r.total),
        converted: Number(r.converted),
        rewardsGranted: granted,
        capRemaining: Math.max(0, MAX_REFERRAL_REWARDS - granted),
      }
    }),
    recent: recentRes.rows.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      convertedAt: r.converted_at,
      refereeRewardGrantedAt: r.referee_reward_granted_at,
      referrerRewardGrantedAt: r.referrer_reward_granted_at,
      referrerEmail: r.referrer_email,
      refereeEmail: r.referee_email,
      refereePlan: r.referee_plan,
      refereeSubStatus: r.referee_sub_status,
      refereeTrialEnd: r.referee_trial_end,
      awaitingPayout: r.awaiting_payout,
    })),
  }
}

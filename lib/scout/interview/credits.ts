import { getPostgresPool } from "@/lib/postgres/server"
import type { Plan } from "@/lib/gates"

// 1 credit = 1 session slot (any duration)
export function creditsForDuration(_durationMin: number): number {
  return 1
}

// Pro Max monthly grant: 2 free session slots
const PRO_MAX_MONTHLY_GRANT = 2
// Days between auto-grants (28 keeps it inside any billing cycle)
const GRANT_INTERVAL_DAYS = 28

export interface CreditBalance {
  balance: number
  /** Credits the user can get via the next monthly grant, or 0 if already granted this cycle */
  pendingProMaxGrant: number
  /** ISO timestamp of last monthly grant, or null */
  lastGrantAt: string | null
}

// ── Read balance (with lazy monthly grant for Pro Max) ──────────────────────

export async function getBalance(
  userId: string,
  plan: Plan | null
): Promise<CreditBalance> {
  const pool = getPostgresPool()

  // Check last monthly grant date
  const grantResult = await pool.query<{ created_at: string }>(
    `SELECT created_at FROM interview_credit_transactions
     WHERE user_id = $1 AND reason = 'monthly_pro_max_grant'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  )
  const lastGrant = grantResult.rows[0]?.created_at ?? null
  const daysSinceGrant = lastGrant
    ? (Date.now() - new Date(lastGrant).getTime()) / 86_400_000
    : Infinity

  // Lazy grant: Pro Max users who haven't received their monthly grant
  const shouldGrant = plan === "pro_max" && daysSinceGrant >= GRANT_INTERVAL_DAYS
  if (shouldGrant) {
    await grantCredits(userId, PRO_MAX_MONTHLY_GRANT, "monthly_pro_max_grant")
  }

  const balResult = await pool.query<{ balance: number }>(
    `SELECT balance FROM interview_credit_balances WHERE user_id = $1`,
    [userId]
  )

  return {
    balance: balResult.rows[0]?.balance ?? 0,
    pendingProMaxGrant: shouldGrant ? PRO_MAX_MONTHLY_GRANT : 0,
    lastGrantAt: shouldGrant ? new Date().toISOString() : lastGrant,
  }
}

// ── Grant credits ───────────────────────────────────────────────────────────

export async function grantCredits(
  userId: string,
  amount: number,
  reason: string,
  stripePaymentIntentId?: string
): Promise<number> {
  const pool = getPostgresPool()

  const result = await pool.query<{ balance: number }>(
    `INSERT INTO interview_credit_balances (user_id, balance, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET balance    = interview_credit_balances.balance + $2,
           updated_at = NOW()
     RETURNING balance`,
    [userId, amount]
  )

  await pool.query(
    `INSERT INTO interview_credit_transactions
       (user_id, amount, reason, stripe_payment_intent_id)
     VALUES ($1, $2, $3, $4)`,
    [userId, amount, reason, stripePaymentIntentId ?? null]
  )

  return result.rows[0].balance
}

// ── Deduct credits (atomic check-and-deduct) ────────────────────────────────

export type DeductResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "insufficient_credits"; balance: number; needed: number }

export async function deductCredits(
  userId: string,
  sessionId: string,
  durationMin: number
): Promise<DeductResult> {
  const pool = getPostgresPool()
  const needed = creditsForDuration(durationMin)

  // Atomic: only deduct if balance is sufficient and session not already deducted
  const result = await pool.query<{ balance: number; deducted: boolean }>(
    `WITH session_check AS (
       SELECT credit_deducted FROM interview_sessions WHERE id = $1
     ),
     deduct AS (
       UPDATE interview_credit_balances
       SET balance    = balance - $3,
           updated_at = NOW()
       WHERE user_id = $2
         AND balance  >= $3
         AND (SELECT NOT credit_deducted FROM session_check)
       RETURNING balance
     ),
     mark_session AS (
       UPDATE interview_sessions
       SET credit_deducted = TRUE
       WHERE id = $1
         AND (SELECT NOT credit_deducted FROM session_check)
       RETURNING id
     )
     SELECT
       COALESCE((SELECT balance FROM deduct), -1) AS balance,
       EXISTS(SELECT 1 FROM deduct) AS deducted`,
    [sessionId, userId, needed]
  )

  const { balance, deducted } = result.rows[0]

  if (!deducted) {
    // Could be: already deducted (reconnect) OR insufficient balance
    const currentBal = await pool.query<{ balance: number }>(
      `SELECT balance FROM interview_credit_balances WHERE user_id = $1`,
      [userId]
    )
    const current = currentBal.rows[0]?.balance ?? 0

    // Check if it was already deducted for this session
    const sessionRow = await pool.query<{ credit_deducted: boolean }>(
      `SELECT credit_deducted FROM interview_sessions WHERE id = $1`,
      [sessionId]
    )
    if (sessionRow.rows[0]?.credit_deducted) {
      // Already paid — allow reconnect
      return { ok: true, remaining: current }
    }

    return { ok: false, reason: "insufficient_credits", balance: current, needed }
  }

  await pool.query(
    `INSERT INTO interview_credit_transactions
       (user_id, amount, reason, session_id)
     VALUES ($1, $2, 'session_deduct', $3)`,
    [userId, -needed, sessionId]
  )

  return { ok: true, remaining: balance }
}

// ── Refund (if session never actually started) ─────────────────────────────

export async function refundCredits(
  userId: string,
  sessionId: string,
  durationMin: number
): Promise<void> {
  const pool = getPostgresPool()
  const amount = creditsForDuration(durationMin)

  // Only refund if no turns exist (session abandoned before any exchange)
  const turns = await pool.query<{ count: string }>(
    `SELECT count(*) FROM interview_turns
     WHERE session_id = $1 AND role = 'interviewer'`,
    [sessionId]
  )
  if (Number(turns.rows[0]?.count) > 0) return

  await grantCredits(userId, amount, "refund")

  // Reset the deducted flag so the session shows as un-billed
  await pool.query(
    `UPDATE interview_sessions SET credit_deducted = FALSE WHERE id = $1`,
    [sessionId]
  )
}

import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { STAY_OUTCOMES, isStayOutcome, type OutcomeSummary, type StayOutcome } from "./outcome-types"

export {
  STAY_OUTCOMES,
  OUTCOME_LABEL,
  OUTCOME_TONE,
  isStayOutcome,
  type StayOutcome,
  type OutcomeSummary,
} from "./outcome-types"

const emptyCounts = (): Record<StayOutcome, number> =>
  STAY_OUTCOMES.reduce((acc, k) => ({ ...acc, [k]: 0 }), {} as Record<StayOutcome, number>)

const isOutcome = isStayOutcome

export interface RecordOutcomeInput {
  companyId?: string | null
  employerName: string
  outcome: string
  wageLevel?: number | null
  isStem?: boolean | null
  note?: string | null
  visitorId?: string | null
}

export interface RecordOutcomeResult {
  ok: boolean
  reason?: "invalid" | "rate_limited" | "unavailable"
  summary: OutcomeSummary | null
}

/** Insert a reported outcome. Validates the enum, caps text, and applies a light
 *  per-visitor rate guard. Returns the refreshed employer tally on success. */
export async function recordStayOutcome(input: RecordOutcomeInput): Promise<RecordOutcomeResult> {
  if (!isOutcome(input.outcome)) return { ok: false, reason: "invalid", summary: null }
  const employerName = String(input.employerName ?? "").trim().slice(0, 120)
  if (!employerName) return { ok: false, reason: "invalid", summary: null }
  if (!hasPostgresEnv()) return { ok: false, reason: "unavailable", summary: null }

  const wageLevel =
    typeof input.wageLevel === "number" && input.wageLevel >= 1 && input.wageLevel <= 4
      ? Math.round(input.wageLevel)
      : null
  const note = input.note ? String(input.note).trim().slice(0, 280) || null : null
  const visitorId = input.visitorId ? String(input.visitorId).slice(0, 64) : null
  const companyId = input.companyId && /^[0-9a-f-]{32,36}$/i.test(input.companyId) ? input.companyId : null

  try {
    const pool = getPostgresPool()

    // Light abuse guard: cap reports per visitor per hour.
    if (visitorId) {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text n FROM stay_outcomes
          WHERE visitor_id = $1 AND created_at > now() - interval '1 hour'`,
        [visitorId]
      )
      if (Number(rows[0]?.n ?? 0) >= 15) {
        return { ok: false, reason: "rate_limited", summary: await getOutcomeSummary({ companyId, employerName }) }
      }
    }

    await pool.query(
      `INSERT INTO stay_outcomes (company_id, employer_name, outcome, wage_level, is_stem, note, visitor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [companyId, employerName, input.outcome, wageLevel, input.isStem ?? null, note, visitorId]
    )
    return { ok: true, summary: await getOutcomeSummary({ companyId, employerName }) }
  } catch {
    // Table not migrated yet, or a transient failure — degrade gracefully.
    return { ok: false, reason: "unavailable", summary: null }
  }
}

/** Aggregate reported outcomes for an employer (by id when known, else by name). */
export async function getOutcomeSummary(input: {
  companyId?: string | null
  employerName?: string | null
}): Promise<OutcomeSummary | null> {
  if (!hasPostgresEnv()) return null
  const companyId = input.companyId && /^[0-9a-f-]{32,36}$/i.test(input.companyId) ? input.companyId : null
  const employerName = input.employerName?.trim() ?? null
  if (!companyId && !employerName) return null

  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ outcome: string; n: string }>(
      `SELECT outcome, COUNT(*)::text n
         FROM stay_outcomes
        WHERE ${companyId ? "company_id = $1" : "lower(employer_name) = lower($1)"}
        GROUP BY outcome`,
      [companyId ?? employerName]
    )
    const counts = emptyCounts()
    let total = 0
    for (const r of rows) {
      if (isOutcome(r.outcome)) {
        counts[r.outcome] = Number(r.n)
        total += Number(r.n)
      }
    }
    return { total, counts }
  } catch {
    return null
  }
}

/** Global reported-outcome count for the /stay hub's social-proof line. */
export async function getGlobalOutcomeCount(): Promise<number> {
  if (!hasPostgresEnv()) return 0
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text n FROM stay_outcomes`)
    return Number(rows[0]?.n ?? 0)
  } catch {
    return 0
  }
}

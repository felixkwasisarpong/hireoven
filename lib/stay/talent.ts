import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { estimateWageLevel } from "./lottery-odds"
import { TALENT_VISA_STATUS, VISA_STATUS_LABEL, type TalentVisaStatus } from "./talent-types"

export { TALENT_VISA_STATUS, VISA_STATUS_LABEL, type TalentVisaStatus } from "./talent-types"

export interface TalentProfileInput {
  email: string
  headline?: string | null
  socGroup?: string | null
  targetSalary?: number | null
  visaStatus?: string | null
  isStem?: boolean | null
  stateAbbr?: string | null
  topSkills?: string[] | null
  visitorId?: string | null
}

export interface RecordTalentResult {
  ok: boolean
  reason?: "invalid" | "rate_limited" | "unavailable"
}

const isVisa = (v: unknown): v is TalentVisaStatus =>
  typeof v === "string" && (TALENT_VISA_STATUS as readonly string[]).includes(v)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function recordTalentProfile(input: TalentProfileInput): Promise<RecordTalentResult> {
  const email = String(input.email ?? "").trim().toLowerCase().slice(0, 160)
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "invalid" }
  if (!hasPostgresEnv()) return { ok: false, reason: "unavailable" }

  const headline = input.headline ? String(input.headline).trim().slice(0, 140) || null : null
  const socGroup =
    input.socGroup && /^\d{2}-\d{2,4}$/.test(input.socGroup) ? input.socGroup : null
  const targetSalary =
    typeof input.targetSalary === "number" && Number.isFinite(input.targetSalary) && input.targetSalary > 0
      ? Math.min(1_000_000, Math.round(input.targetSalary))
      : null
  const visaStatus = isVisa(input.visaStatus) ? input.visaStatus : null
  const stateAbbr =
    input.stateAbbr && /^[A-Za-z]{2}$/.test(input.stateAbbr) ? input.stateAbbr.toUpperCase() : null
  const topSkills = Array.isArray(input.topSkills)
    ? input.topSkills.map((s) => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 12)
    : []
  const visitorId = input.visitorId ? String(input.visitorId).slice(0, 64) : null
  const wageLevel = estimateWageLevel({ salary: targetSalary })?.level ?? null

  try {
    const pool = getPostgresPool()

    if (visitorId) {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text n FROM stay_talent_profiles
          WHERE visitor_id = $1 AND created_at > now() - interval '1 hour'`,
        [visitorId]
      )
      if (Number(rows[0]?.n ?? 0) >= 8) return { ok: false, reason: "rate_limited" }
    }

    // Upsert: re-submitting the same email updates the profile.
    await pool.query(
      `INSERT INTO stay_talent_profiles
         (email, headline, soc_group, target_salary, wage_level, visa_status, is_stem, state_abbr, top_skills, visitor_id, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active', now())
       ON CONFLICT (lower(email)) DO UPDATE SET
         headline = EXCLUDED.headline,
         soc_group = EXCLUDED.soc_group,
         target_salary = EXCLUDED.target_salary,
         wage_level = EXCLUDED.wage_level,
         visa_status = EXCLUDED.visa_status,
         is_stem = EXCLUDED.is_stem,
         state_abbr = EXCLUDED.state_abbr,
         top_skills = EXCLUDED.top_skills,
         status = 'active',
         updated_at = now()`,
      [email, headline, socGroup, targetSalary, wageLevel, visaStatus, input.isStem ?? null, stateAbbr, topSkills, visitorId]
    )
    return { ok: true }
  } catch {
    return { ok: false, reason: "unavailable" }
  }
}

export interface TalentPoolStats {
  total: number
  byRole: { socGroup: string; label: string; n: number }[]
  byVisa: { visa: TalentVisaStatus; label: string; n: number }[]
}

/** PII-free aggregates for the public talent-pool teaser (the employer hook). */
export async function getTalentPoolStats(labelFor?: (soc: string) => string): Promise<TalentPoolStats> {
  const empty: TalentPoolStats = { total: 0, byRole: [], byVisa: [] }
  if (!hasPostgresEnv()) return empty
  try {
    const pool = getPostgresPool()
    const [totalRes, roleRes, visaRes] = await Promise.all([
      pool.query<{ n: string }>(`SELECT COUNT(*)::text n FROM stay_talent_profiles WHERE status = 'active'`),
      pool.query<{ soc_group: string; n: string }>(
        `SELECT soc_group, COUNT(*)::text n FROM stay_talent_profiles
          WHERE status = 'active' AND soc_group IS NOT NULL
          GROUP BY soc_group ORDER BY COUNT(*) DESC LIMIT 8`
      ),
      pool.query<{ visa_status: string; n: string }>(
        `SELECT visa_status, COUNT(*)::text n FROM stay_talent_profiles
          WHERE status = 'active' AND visa_status IS NOT NULL
          GROUP BY visa_status ORDER BY COUNT(*) DESC`
      ),
    ])
    return {
      total: Number(totalRes.rows[0]?.n ?? 0),
      byRole: roleRes.rows.map((r) => ({
        socGroup: r.soc_group,
        label: labelFor?.(r.soc_group) ?? r.soc_group,
        n: Number(r.n),
      })),
      byVisa: visaRes.rows
        .filter((r) => isVisa(r.visa_status))
        .map((r) => ({
          visa: r.visa_status as TalentVisaStatus,
          label: VISA_STATUS_LABEL[r.visa_status as TalentVisaStatus],
          n: Number(r.n),
        })),
    }
  } catch {
    return empty
  }
}

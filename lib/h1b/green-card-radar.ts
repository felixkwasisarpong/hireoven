/**
 * §2 Green Card Radar — a lead on an employer that is about to sponsor a specific role.
 *
 * Before filing PERM an employer must obtain a Prevailing Wage Determination. Those are published
 * with employer, SOC, worksite and an expiration date, and PERM rows point back at them via
 * JOB_OPP_PWD_NUMBER (filled on 100% of PERM filings). So a determination that is still valid and
 * has NO PERM filed against it means: this employer is, right now, preparing to green-card
 * someone for that occupation at that worksite.
 *
 * Every competitor treats PERM as a historical record. It is the downstream stage of a pipeline
 * whose upstream stage is public.
 *
 * ⚠ PERM ONLY — do not build the H-1B equivalent. Of 147,244 determinations, 127,621 are PERM
 * and just 2,022 are H-1B (1.4%). H-1B employers self-determine the wage level from the published
 * tables rather than requesting a determination, so an H-1B radar would be built on noise.
 *
 * ⚠ THE EXPIRY WINDOW IS THE POINT. A determination is valid 90 days to 1 year; once it lapses
 * the employer must start over. An unexpired determination with no PERM yet, close to expiry, is
 * the sharpest sponsorship-intent signal in public data — 20,025 of the loaded rows are unexpired.
 *
 * ⚠ ABSENCE OF A PERM ROW IS NOT PROOF OF ABSENCE OF A FILING. Our PERM corpus is one quarterly
 * file; a filing made after that snapshot is simply not visible yet. Treat "no PERM filed" as
 * "none in our data", which is why nothing here claims the employer has failed to file.
 *
 * ⚠ THIS FEATURE HAS A SHELF LIFE — INGEST EVERY QUARTER OR IT GOES DARK. Determinations are
 * valid 90 days to 1 year, so once a disclosure file ages past that, every row in it has expired
 * and the radar returns nothing. Measured on the FY2026 Q3 file (data through ~June 2026) as of
 * 2026-08-16: 15,640 live signals, and ALL of them expire within 0-41 days. The count decays to
 * zero by roughly late September. OFLC publishes in Feb/May/Aug/Dec, so the ingest must track
 * that calendar; unlike the wage tables (annual) or the placement graph (historical), a stale
 * file here does not degrade the feature, it silently empties it.
 */

import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { bareSocCode } from "@/lib/salaries/soc-classifier"

export interface RadarSignal {
  caseNumber: string
  employerName: string
  employerNormalized: string
  employerFein: string | null
  socCode: string | null
  socTitle: string | null
  worksiteCity: string | null
  worksiteState: string | null
  determinationDate: string | null
  expirationDate: string | null
  /** Days until the determination lapses. Negative means already expired. */
  daysUntilExpiry: number | null
  wageRate: number | null
  wageLevel: string | null
  /** True when no PERM filing in our corpus references this determination. */
  noPermFiledYet: boolean
}

export interface RadarQuery {
  socPrefix?: string | null
  stateAbbr?: string | null
  /** Only determinations expiring within this many days (the urgent end). */
  expiringWithinDays?: number
  limit?: number
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 200

/**
 * Live sponsorship-intent signals: valid PERM determinations with no PERM filing against them,
 * soonest to expire first (an employer must file before expiry or redo the determination).
 */
export async function getGreenCardRadar(query: RadarQuery = {}): Promise<RadarSignal[]> {
  if (!hasPostgresEnv()) return []

  const soc = bareSocCode(query.socPrefix) ?? (query.socPrefix ?? "").trim()
  const state = (query.stateAbbr ?? "").trim().toUpperCase()
  if (soc && !/^\d{2}(-\d{2,4})?$/.test(soc)) return []
  if (state && !/^[A-Z]{2}$/.test(state)) return []

  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const within = query.expiringWithinDays

  const params: unknown[] = []
  let filter = ""
  if (soc) {
    params.push(`${soc}%`)
    filter += ` AND w.pwd_soc_code LIKE $${params.length}`
  }
  if (state) {
    params.push(state)
    filter += ` AND upper(w.worksite_state) = $${params.length}`
  }
  if (within && Number.isFinite(within)) {
    params.push(Math.max(1, Math.trunc(within)))
    filter += ` AND w.expiration_date <= CURRENT_DATE + ($${params.length}::int)`
  }
  params.push(limit)

  try {
    const { rows } = await getPostgresPool().query<{
      case_number: string; employer_name: string; employer_name_normalized: string
      employer_fein: string | null; pwd_soc_code: string | null; pwd_soc_title: string | null
      worksite_city: string | null; worksite_state: string | null
      determination_date: string | null; expiration_date: string | null
      days_left: string | null; pwd_wage_rate: string | null; pwd_oes_wage_level: string | null
    }>(
      `SELECT w.case_number, w.employer_name, w.employer_name_normalized, w.employer_fein,
              w.pwd_soc_code, w.pwd_soc_title, w.worksite_city, w.worksite_state,
              w.determination_date::text, w.expiration_date::text,
              (w.expiration_date - CURRENT_DATE)::text AS days_left,
              w.pwd_wage_rate::text, w.pwd_oes_wage_level
         FROM pwd_records w
        WHERE w.visa_class = 'PERM'
          AND w.expiration_date IS NOT NULL
          AND w.expiration_date >= CURRENT_DATE
          AND w.employer_name_normalized IS NOT NULL
          -- No PERM filing in our corpus references this determination.
          AND NOT EXISTS (
            SELECT 1 FROM perm_records p WHERE p.pwd_number = w.case_number
          )
          ${filter}
        ORDER BY w.expiration_date ASC
        LIMIT $${params.length}`,
      params
    )

    return rows.map((r) => ({
      caseNumber: r.case_number,
      employerName: r.employer_name,
      employerNormalized: r.employer_name_normalized,
      employerFein: r.employer_fein,
      socCode: r.pwd_soc_code,
      socTitle: r.pwd_soc_title,
      worksiteCity: r.worksite_city,
      worksiteState: r.worksite_state,
      determinationDate: r.determination_date,
      expirationDate: r.expiration_date,
      daysUntilExpiry: r.days_left === null ? null : Number(r.days_left),
      wageRate: r.pwd_wage_rate === null ? null : Number(r.pwd_wage_rate),
      wageLevel: r.pwd_oes_wage_level,
      noPermFiledYet: true,
    }))
  } catch {
    return []
  }
}

/** Does this employer have live green-card intent? For a company or job page. */
export async function getEmployerRadarSignals(input: {
  employerNormalized: string
  limit?: number
}): Promise<RadarSignal[]> {
  if (!hasPostgresEnv()) return []
  const norm = input.employerNormalized?.trim()
  if (!norm) return []
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 50)

  try {
    const { rows } = await getPostgresPool().query<{
      case_number: string; employer_name: string; employer_fein: string | null
      pwd_soc_code: string | null; pwd_soc_title: string | null
      worksite_city: string | null; worksite_state: string | null
      determination_date: string | null; expiration_date: string | null
      days_left: string | null; pwd_wage_rate: string | null; pwd_oes_wage_level: string | null
      has_perm: boolean
    }>(
      `SELECT w.case_number, w.employer_name, w.employer_fein,
              w.pwd_soc_code, w.pwd_soc_title, w.worksite_city, w.worksite_state,
              w.determination_date::text, w.expiration_date::text,
              (w.expiration_date - CURRENT_DATE)::text AS days_left,
              w.pwd_wage_rate::text, w.pwd_oes_wage_level,
              EXISTS (SELECT 1 FROM perm_records p WHERE p.pwd_number = w.case_number) AS has_perm
         FROM pwd_records w
        WHERE w.employer_name_normalized = $1
          AND w.visa_class = 'PERM'
          AND w.expiration_date IS NOT NULL
          AND w.expiration_date >= CURRENT_DATE
        ORDER BY w.expiration_date ASC
        LIMIT $2`,
      [norm, limit]
    )

    return rows
      .filter((r) => !r.has_perm)
      .map((r) => ({
        caseNumber: r.case_number,
        employerName: r.employer_name,
        employerNormalized: norm,
        employerFein: r.employer_fein,
        socCode: r.pwd_soc_code,
        socTitle: r.pwd_soc_title,
        worksiteCity: r.worksite_city,
        worksiteState: r.worksite_state,
        determinationDate: r.determination_date,
        expirationDate: r.expiration_date,
        daysUntilExpiry: r.days_left === null ? null : Number(r.days_left),
        wageRate: r.pwd_wage_rate === null ? null : Number(r.pwd_wage_rate),
        wageLevel: r.pwd_oes_wage_level,
        noPermFiledYet: true,
      }))
  } catch {
    return []
  }
}

/** One-line summary for a radar signal. Deliberately hedged — see the module note on absence. */
export function radarSummary(signal: RadarSignal): string {
  const where = [signal.worksiteCity, signal.worksiteState].filter(Boolean).join(", ")
  const occupation = signal.socTitle ?? signal.socCode ?? "an occupation"
  const expiry =
    signal.daysUntilExpiry !== null
      ? ` The determination expires in ${signal.daysUntilExpiry} day${signal.daysUntilExpiry === 1 ? "" : "s"}${signal.expirationDate ? ` (${signal.expirationDate})` : ""}, and a green-card filing must follow before then or the employer starts over.`
      : ""
  return (
    `${signal.employerName} obtained a prevailing wage determination for ${occupation}` +
    `${where ? ` in ${where}` : ""}${signal.determinationDate ? ` on ${signal.determinationDate}` : ""}. ` +
    `No matching green-card filing appears in our data yet.${expiry}`
  )
}

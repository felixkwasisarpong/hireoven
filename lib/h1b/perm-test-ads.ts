/**
 * §3 PERM Test-Ad Detection — the only ghost-job signal with legal ground truth.
 *
 * To get a green-card labor certification an employer must publicly advertise the role: an SWA
 * job order, two Sunday newspaper ads, and for professional occupations three more steps from a
 * fixed menu. In 70.0% of PERM filings the job is ALREADY HELD by the worker being sponsored
 * (OTHER_REQ_IS_FW_CURRENTLY_WRK = Y). Those ads are therefore postings that cannot be won, and
 * DOL publishes the exact date windows they ran.
 *
 * TWO TIERS, DELIBERATELY SEPARATED — they are not the same claim:
 *
 *   EXACT (tier 1): a posting's live window overlaps a recruitment window this employer reported
 *   to DOL for the same occupation and state. This is evidentiary — the employer told the
 *   government it was advertising this role, then.
 *
 *   BEHAVIOURAL (tier 3): this employer's PERM history in this occupation is overwhelmingly for
 *   incumbent workers. This is CONTEXT, not proof. It says nothing about the specific posting.
 *
 * ⚠ MEASURED COVERAGE. Exact matching is real but partial, and the limit is data vintage rather
 * than logic: recruitment windows in the current file cluster in 2024 (290,655 of 352,060) while
 * our real crawl history begins in 2026. 811 PERM cases carry a window reaching into 2026, and
 * a company+date-overlap join against the live feed matches 1,735 jobs across 57 companies.
 * That is a subset feature, not a product-wide one — but its yield grows automatically with each
 * quarterly PERM drop, since newer drops cover recruitment that happened while we were crawling.
 *
 * ⚠ WINDOW SANITY IS LOAD-BEARING. A recruitment window's median length is 18 days (p99 = 71),
 * but a few filings carry typo'd end dates — 2042-07-24 was in the loaded data. Those rows are
 * precisely the ones that survive any "is this window still open" filter, so they dominate
 * results out of all proportion to their number (83 of 352,143). The importer now rejects spans
 * over MAX_WINDOW_DAYS. Without that guard one keystroke flags an employer's postings as ghost
 * jobs for two decades — and telling someone not to apply is a costly thing to get wrong.
 *
 * ⚠ TWO NORMALIZERS. perm_records.employer_name_normalized comes from normalizeEmployerName(),
 * while companies.name_normalized is a generated column using the SQL company_name_norm(). They
 * disagree ('amazon com' vs 'amazon com services'), so joins across the two must go through
 * company_name_norm(perm_records.employer_name), never by equating the two stored columns.
 */

import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { bareSocCode } from "@/lib/salaries/soc-classifier"

export interface RecruitmentMatch {
  caseNumber: string
  channel: string
  fromDate: string
  toDate: string
  socCode: string | null
  socTitle: string | null
  worksiteCity: string | null
  worksiteState: string | null
  /** The sponsored worker already held the job when the ad ran. */
  incumbentWorker: boolean | null
  caseStatus: string | null
}

export interface TestAdVerdict {
  /** 'exact' = an overlapping reported recruitment window. 'behavioural' = employer-history only. */
  tier: "exact" | "behavioural" | "none"
  /** Only ever true for tier 'exact'. */
  hasReportedWindowOverlap: boolean
  matches: RecruitmentMatch[]
  /** Employer's PERM filings in this occupation (any date). */
  permFilingsInOccupation: number
  /** Share of those filings where the worker already held the job, 0-1, null if unknown. */
  incumbentShare: number | null
  /** Plain-language summary safe to render. Null when we have nothing to say. */
  summary: string | null
}

const MIN_OCCUPATION_FILINGS = 3

/**
 * An exact claim must be corroborated by BOTH occupation and worksite state, never by employer
 * name and dates alone.
 *
 * Why this is a hard rule: employer matching is by normalized name, and normalizeEmployerName()
 * strips legal/industry suffixes, which manufactures short collision-prone keys — 'DEV SYSTEMS,
 * INC.' becomes 'dev'. A junk tenant company literally named "Dev" therefore matched it, and a
 * Hair Stylist posting was flagged as a green-card advert for a Software Developer role in
 * another state. 5,448 PERM rows carry a normalized name of 4 characters or fewer.
 *
 * Without the occupation, "this employer advertised something, sometime" says nothing about THIS
 * posting. Telling someone an application is unwinnable is the most costly thing this module can
 * get wrong, so an uncorroborated match degrades to the behavioural tier rather than accusing.
 */
const MIN_EMPLOYER_KEY_LENGTH = 4

/**
 * Recruitment windows this employer reported that overlap a posting's live window.
 *
 * Overlap test is inclusive on both ends: a window [wf, wt] overlaps a posting [pf, pt] iff
 * wf <= pt AND wt >= pf.
 */
export async function findOverlappingRecruitmentWindows(input: {
  employerNormalized: string
  postedFrom: string | Date
  postedTo: string | Date
  socCode?: string | null
  stateAbbr?: string | null
  limit?: number
}): Promise<RecruitmentMatch[]> {
  if (!hasPostgresEnv()) return []
  const norm = input.employerNormalized?.trim()
  if (!norm || norm.length < MIN_EMPLOYER_KEY_LENGTH) return []

  const from = toIso(input.postedFrom)
  const to = toIso(input.postedTo)
  if (!from || !to) return []

  // Corroboration is mandatory — see MIN_EMPLOYER_KEY_LENGTH. Both must be present AND match.
  const soc = bareSocCode(input.socCode)
  const state = (input.stateAbbr ?? "").trim().toUpperCase()
  if (!soc || !/^[A-Z]{2}$/.test(state)) return []

  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50)

  const params: unknown[] = [norm, from, to, `${soc}%`, state]
  const extra = ` AND p.pwd_soc_code LIKE $4 AND upper(p.worksite_state) = $5`
  params.push(limit)

  try {
    const { rows } = await getPostgresPool().query<{
      case_number: string; channel: string; from_date: string; to_date: string
      pwd_soc_code: string | null; pwd_soc_title: string | null
      worksite_city: string | null; worksite_state: string | null
      fw_currently_working: boolean | null; case_status: string | null
    }>(
      `SELECT w.case_number, w.channel, w.from_date::text, w.to_date::text,
              p.pwd_soc_code, p.pwd_soc_title, p.worksite_city, p.worksite_state,
              p.fw_currently_working, p.case_status
         FROM perm_recruitment_windows w
         JOIN perm_records p ON p.case_number = w.case_number
        WHERE p.employer_name_normalized = $1
          AND w.from_date <= $3::date
          AND w.to_date   >= $2::date
          ${extra}
        ORDER BY w.from_date DESC
        LIMIT $${params.length}`,
      params
    )

    return rows.map((r) => ({
      caseNumber: r.case_number,
      channel: r.channel,
      fromDate: r.from_date,
      toDate: r.to_date,
      socCode: r.pwd_soc_code,
      socTitle: r.pwd_soc_title,
      worksiteCity: r.worksite_city,
      worksiteState: r.worksite_state,
      incumbentWorker: r.fw_currently_working,
      caseStatus: r.case_status,
    }))
  } catch {
    return []
  }
}

/** Employer's PERM behaviour in one occupation — tier-3 context. */
export async function getOccupationPermBehaviour(input: {
  employerNormalized: string
  socCode?: string | null
}): Promise<{ filings: number; incumbentShare: number | null }> {
  if (!hasPostgresEnv()) return { filings: 0, incumbentShare: null }
  const norm = input.employerNormalized?.trim()
  if (!norm || norm.length < MIN_EMPLOYER_KEY_LENGTH) return { filings: 0, incumbentShare: null }

  const soc = bareSocCode(input.socCode)
  const params: unknown[] = [norm]
  let extra = ""
  if (soc) {
    params.push(`${soc}%`)
    extra = ` AND pwd_soc_code LIKE $${params.length}`
  }

  try {
    const { rows } = await getPostgresPool().query<{
      filings: string; incumbent: string; known: string
    }>(
      `SELECT count(*) AS filings,
              count(*) FILTER (WHERE fw_currently_working)             AS incumbent,
              count(*) FILTER (WHERE fw_currently_working IS NOT NULL) AS known
         FROM perm_records
        WHERE employer_name_normalized = $1${extra}`,
      params
    )
    const r = rows[0]
    if (!r) return { filings: 0, incumbentShare: null }
    const known = Number(r.known)
    return {
      filings: Number(r.filings),
      incumbentShare: known > 0 ? Number(r.incumbent) / known : null,
    }
  } catch {
    return { filings: 0, incumbentShare: null }
  }
}

/**
 * Full verdict for one posting. Exact evidence wins; behavioural context is only offered when
 * there is no exact match and the employer has enough filings in the occupation to be worth
 * mentioning. Returns tier 'none' rather than inventing a signal.
 */
export async function assessTestAd(input: {
  employerNormalized: string
  postedFrom: string | Date
  postedTo: string | Date
  socCode?: string | null
  stateAbbr?: string | null
}): Promise<TestAdVerdict> {
  const [matches, behaviour] = await Promise.all([
    findOverlappingRecruitmentWindows(input),
    getOccupationPermBehaviour({ employerNormalized: input.employerNormalized, socCode: input.socCode }),
  ])

  if (matches.length > 0) {
    const m = matches[0]
    const where = [m.worksiteCity, m.worksiteState].filter(Boolean).join(", ")
    return {
      tier: "exact",
      hasReportedWindowOverlap: true,
      matches,
      permFilingsInOccupation: behaviour.filings,
      incumbentShare: behaviour.incumbentShare,
      summary:
        `This posting's live window overlaps a recruitment period this employer reported to the ` +
        `Department of Labor for ${m.socTitle ?? "the same occupation"}${where ? ` in ${where}` : ""} ` +
        `(${m.fromDate} to ${m.toDate}). Green-card labor certification requires publicly advertising ` +
        `a role that is often already committed to a specific employee` +
        `${m.incumbentWorker ? ", and that filing states the worker already held the job" : ""}.`,
    }
  }

  if (behaviour.filings >= MIN_OCCUPATION_FILINGS && behaviour.incumbentShare !== null) {
    const pct = Math.round(behaviour.incumbentShare * 100)
    return {
      tier: "behavioural",
      hasReportedWindowOverlap: false,
      matches: [],
      permFilingsInOccupation: behaviour.filings,
      incumbentShare: behaviour.incumbentShare,
      summary:
        `Context, not a finding about this posting: of this employer's ${behaviour.filings} green-card ` +
        `filings in this occupation, ${pct}% were for a worker who already held the job.`,
    }
  }

  return {
    tier: "none",
    hasReportedWindowOverlap: false,
    matches: [],
    permFilingsInOccupation: behaviour.filings,
    incumbentShare: behaviour.incumbentShare,
    summary: null,
  }
}

function toIso(v: string | Date): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  const s = (v ?? "").trim()
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

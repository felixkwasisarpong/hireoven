/**
 * §5 ACWIA cap-exempt registry — employer-attested H-1B cap exemption.
 *
 * THERE IS NO OFFICIAL CAP-EXEMPT LIST. Exemption is adjudicated per-petition on Form I-129 and
 * never published, so every list in this market (Ellis, H1BGrader) is guessed from IPEDS or from
 * name heuristics — which is exactly what lib/cap-exempt/classify.ts does today: `.edu` domains,
 * "university" in the name, a federal-lab pattern.
 *
 * The prevailing wage file carries something better. On the ETA-9141 an employer states, under
 * penalty of perjury, whether it is covered by ACWIA and WHICH of the three statutory prongs of
 * INA 214(g)(5) it falls under:
 *
 *   ACWIA_INST_HIGHER_EDUCATION    -> (a) an institution of higher education
 *   ACWIA_AFFILIATED_NON_PROFIT    -> (b) a nonprofit related to or affiliated with one
 *   ACWIA_RESEARCH_ORG             -> (c) a nonprofit or governmental research organization
 *
 * That is a government-collected, employer-attested signal keyed to FEIN. Measured in the loaded
 * data: 1,125 distinct FEINs / 1,212 distinct employer names attest coverage.
 *
 * ⚠ ATTESTED, NOT ADJUDICATED. The employer asserted this; USCIS did not confirm it, and coverage
 * can change. It is materially stronger than inferring from a company name, and materially weaker
 * than an approved I-129. The wording downstream should say "states" / "attested", never
 * "verified" or "confirmed" — a candidate turning down a lottery-subject offer because we told
 * them an employer was exempt is a real harm.
 */

import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

export type AcwiaProng = "higher_education" | "affiliated_nonprofit" | "research_org"

export interface AcwiaAttestation {
  employerNormalized: string
  employerName: string
  /** Distinct FEINs attesting under this employer name. */
  feins: string[]
  prongs: AcwiaProng[]
  /** Filings in which the employer attested ACWIA coverage. */
  attestingFilings: number
  /** Total filings by this employer — a low ratio means the attestation is inconsistent. */
  totalFilings: number
  lastAttestedAt: string | null
}

const PRONG_LABELS: Record<AcwiaProng, string> = {
  higher_education: "an institution of higher education",
  affiliated_nonprofit: "a nonprofit affiliated with an institution of higher education",
  research_org: "a nonprofit or governmental research organization",
}

/** Maps an attestation to the companies.cap_exempt_reason vocabulary. */
export function prongToReason(prong: AcwiaProng): "university" | "affiliated_nonprofit" | "nonprofit_research" {
  if (prong === "higher_education") return "university"
  if (prong === "affiliated_nonprofit") return "affiliated_nonprofit"
  return "nonprofit_research"
}

/** Human-readable sentence for a surface. Deliberately says "states", not "is". */
export function attestationSummary(a: AcwiaAttestation): string {
  const prongText =
    a.prongs.length > 0
      ? a.prongs.map((p) => PRONG_LABELS[p]).join(", or ")
      : "covered by the ACWIA cap exemption"
  return (
    `In ${a.attestingFilings} Department of Labor filing${a.attestingFilings === 1 ? "" : "s"}, this employer ` +
    `states it is ${prongText} — one of the statutory grounds for exemption from the H-1B cap. ` +
    `Cap-exempt employers can file year-round without entering the lottery.`
  )
}

export interface CapExemptCompany {
  id: string
  name: string
  domain: string | null
  reason: string | null
  /** 'acwia_attested' outranks every name/domain heuristic. */
  source: string | null
  jobCount: number
}

/**
 * Cap-exempt employers we can name, best-evidenced first.
 *
 * Ordered so employer-attested records lead: those come from the employer's own ACWIA
 * declaration on a wage determination, while the rest are inferred from a .edu domain or a name
 * pattern. Restricted to companies with live jobs, because a directory of employers you cannot
 * apply to is not useful.
 */
export async function listCapExemptCompanies(input: {
  limit?: number
  attestedOnly?: boolean
} = {}): Promise<CapExemptCompany[]> {
  if (!hasPostgresEnv()) return []
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000)

  try {
    const { rows } = await getPostgresPool().query<{
      id: string; name: string; domain: string | null
      cap_exempt_reason: string | null; cap_exempt_source: string | null; job_count: number | null
    }>(
      `SELECT id::text, name, domain, cap_exempt_reason, cap_exempt_source, job_count
         FROM companies
        WHERE is_cap_exempt
          AND COALESCE(job_count, 0) > 0
          AND duplicate_of_company_id IS NULL
          ${input.attestedOnly ? "AND cap_exempt_source = 'acwia_attested'" : ""}
        ORDER BY (cap_exempt_source = 'acwia_attested') DESC,
                 COALESCE(job_count, 0) DESC,
                 name ASC
        LIMIT $1`,
      [limit]
    )
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
      reason: r.cap_exempt_reason,
      source: r.cap_exempt_source,
      jobCount: r.job_count ?? 0,
    }))
  } catch {
    return []
  }
}

/** Headline counts for the registry page. */
export async function getCapExemptCounts(): Promise<{ total: number; attested: number; withJobs: number } | null> {
  if (!hasPostgresEnv()) return null
  try {
    const { rows } = await getPostgresPool().query<{ total: string; attested: string; with_jobs: string }>(
      `SELECT count(*)::text total,
              count(*) FILTER (WHERE cap_exempt_source = 'acwia_attested')::text attested,
              count(*) FILTER (WHERE COALESCE(job_count,0) > 0)::text with_jobs
         FROM companies WHERE is_cap_exempt AND duplicate_of_company_id IS NULL`
    )
    const r = rows[0]
    return r ? { total: Number(r.total), attested: Number(r.attested), withJobs: Number(r.with_jobs) } : null
  } catch {
    return null
  }
}

export async function getAcwiaAttestation(input: {
  employerNormalized: string
}): Promise<AcwiaAttestation | null> {
  if (!hasPostgresEnv()) return null
  const norm = input.employerNormalized?.trim()
  if (!norm) return null

  try {
    const { rows } = await getPostgresPool().query<{
      employer_name: string
      feins: string[] | null
      attesting: string
      total: string
      he: string
      np: string
      ro: string
      last_attested: string | null
    }>(
      `SELECT min(employer_name) AS employer_name,
              array_remove(array_agg(DISTINCT employer_fein) FILTER (WHERE covered_by_acwia), NULL) AS feins,
              count(*) FILTER (WHERE covered_by_acwia)                 AS attesting,
              count(*)                                                 AS total,
              count(*) FILTER (WHERE acwia_higher_education)           AS he,
              count(*) FILTER (WHERE acwia_affiliated_nonprofit)       AS np,
              count(*) FILTER (WHERE acwia_research_org)               AS ro,
              max(determination_date) FILTER (WHERE covered_by_acwia)::text AS last_attested
         FROM pwd_records
        WHERE employer_name_normalized = $1`,
      [norm]
    )

    const r = rows[0]
    if (!r) return null
    const attesting = Number(r.attesting)
    if (attesting < 1) return null

    const prongs: AcwiaProng[] = []
    if (Number(r.he) > 0) prongs.push("higher_education")
    if (Number(r.np) > 0) prongs.push("affiliated_nonprofit")
    if (Number(r.ro) > 0) prongs.push("research_org")

    return {
      employerNormalized: norm,
      employerName: r.employer_name,
      feins: r.feins ?? [],
      prongs,
      attestingFilings: attesting,
      totalFilings: Number(r.total),
      lastAttestedAt: r.last_attested,
    }
  } catch {
    return null
  }
}

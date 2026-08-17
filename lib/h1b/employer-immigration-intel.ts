/**
 * One server-side gather for everything the DOL corpus knows about a specific job's employer.
 *
 * Combines, in a single parallel fetch:
 *   §3 test-ad assessment      — is this posting one of the legally-mandated PERM adverts?
 *   §2 green-card radar        — has this employer just obtained a prevailing wage determination?
 *   §7 follow-through rate     — do their green-card certifications actually get used?
 *   §6 placement profile       — would you be placed at a third-party client?
 *   §4 transfer velocity       — can they file an H-1B transfer, and how fast?
 *
 * Exists so the job page makes ONE call instead of five, and so the "do we have anything worth
 * showing" decision is made once, server-side. Every underlying module already returns null/empty
 * rather than guessing, so a job at an employer with no DOL footprint costs five cheap indexed
 * lookups and renders nothing.
 *
 * ⚠ EMPLOYER MATCHING. The DOL tables key on normalizeEmployerName(), while companies.name_normalized
 * is a generated column using the SQL company_name_norm(). The two disagree ('amazon com' vs
 * 'amazon com services'), so we always derive the key by running normalizeEmployerName() over the
 * company's display name — never by reading companies.name_normalized.
 */

import { assessTestAd, type TestAdVerdict } from "@/lib/h1b/perm-test-ads"
import { getEmployerRadarSignals, type RadarSignal } from "@/lib/h1b/green-card-radar"
import {
  getEmployerGreenCardProfile,
  type EmployerGreenCardProfile,
} from "@/lib/h1b/green-card-followthrough"
import { getPlacementProfile, type PlacementProfile } from "@/lib/h1b/placement-graph"
import { getCompanyTransferProfile, type CompanyTransferProfile } from "@/lib/h1b/transfer-velocity"
import { getAcwiaAttestation, type AcwiaAttestation } from "@/lib/h1b/cap-exempt-registry"
import {
  getSocOverrideSignal,
  getLayoffAttestations,
  type SocOverrideSignal,
  type LayoffAttestation,
} from "@/lib/h1b/employer-filing-signals"
import { normalizeEmployerName } from "@/lib/h1b/normalize-employer"

export interface JobImmigrationIntel {
  employerNormalized: string
  testAd: TestAdVerdict | null
  radar: RadarSignal[]
  followThrough: EmployerGreenCardProfile | null
  placement: PlacementProfile | null
  transfers: CompanyTransferProfile | null
  /** Employer-attested H-1B cap exemption (§5). Attested, not adjudicated. */
  capExempt: AcwiaAttestation | null
  /** §9 — how often DOL reclassified this employer's requested occupation. */
  socOverride: SocOverrideSignal | null
  /** §10 — employer-attested layoffs in this occupation, point-in-time. */
  layoffs: LayoffAttestation[]
  /** False when nothing is worth rendering — the caller should omit the panel entirely. */
  hasAnything: boolean
}

/** Below this share of filings, third-party placement isn't characteristic enough to mention. */
const PLACEMENT_SHARE_FLOOR = 0.2

/**
 * Shortest employer key we will match on. normalizeEmployerName() strips legal and industry
 * suffixes, so real employers collapse to very short keys — 'DEV SYSTEMS, INC.' becomes 'dev' —
 * and a company in our own data literally named "Dev" (a junk SmartRecruiters test tenant) then
 * inherits that employer's entire DOL history. 5,448 PERM rows have a key of 4 characters or
 * fewer. Suppressing every signal for short keys costs us a few genuine three-letter employers
 * and prevents attributing another company's filings to them.
 */
const MIN_EMPLOYER_KEY_LENGTH = 4

export async function getJobImmigrationIntel(input: {
  companyName: string | null | undefined
  socCode?: string | null
  stateAbbr?: string | null
  /** The posting's live window, for the §3 overlap test. */
  postedFrom?: string | Date | null
  postedTo?: string | Date | null
}): Promise<JobImmigrationIntel | null> {
  const name = (input.companyName ?? "").trim()
  if (!name) return null

  const employerNormalized = normalizeEmployerName(name)
  if (!employerNormalized || employerNormalized.length < MIN_EMPLOYER_KEY_LENGTH) return null

  const [testAd, radar, followThrough, placement, transfers, capExempt, socOverride, layoffs] =
    await Promise.all([
    input.postedFrom && input.postedTo
      ? assessTestAd({
          employerNormalized,
          postedFrom: input.postedFrom,
          postedTo: input.postedTo,
          socCode: input.socCode,
          stateAbbr: input.stateAbbr,
        })
      : Promise.resolve(null),
    getEmployerRadarSignals({ employerNormalized, limit: 3 }),
    getEmployerGreenCardProfile({ employerNormalized }),
    getPlacementProfile({ employerNormalized, topN: 4 }),
    getCompanyTransferProfile({ employerNormalized }),
    getAcwiaAttestation({ employerNormalized }),
    getSocOverrideSignal({ employerNormalized }),
    getLayoffAttestations({ employerNormalized, socCode: input.socCode, limit: 3 }),
  ])

  const hasAnything = Boolean(
    (testAd && testAd.tier !== "none") ||
      radar.length > 0 ||
      (followThrough && followThrough.rate !== null) ||
      (placement && placement.placementShare >= PLACEMENT_SHARE_FLOOR && placement.topEndClients.length > 0) ||
      (transfers && transfers.transferFilings > 0) ||
      Boolean(capExempt) ||
      Boolean(socOverride?.isElevated) ||
      layoffs.length > 0
  )

  return {
    employerNormalized,
    testAd,
    radar,
    followThrough,
    placement,
    transfers,
    capExempt,
    socOverride,
    layoffs,
    hasAnything,
  }
}

export { PLACEMENT_SHARE_FLOOR }

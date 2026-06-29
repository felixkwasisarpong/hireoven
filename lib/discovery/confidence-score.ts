/**
 * Confidence scoring for discovered career-source candidates.
 *
 * Every discovery channel (probe scripts, crt.sh, Common Crawl) scores each
 * candidate before deciding whether to enroll it in the companies table or
 * hold it in discovered_candidates for later retry.
 *
 * Thresholds:
 *   score ≥ 60  → enroll directly into companies (tier_3)
 *   score 40-59 → hold in discovered_candidates; re-verify in 7 days
 *   score < 40  → reject; store with rejected_reason, no retry
 */

export type ScoreFactors = {
  /** URL matched a known ATS domain pattern (detectAdapter returned non-null). */
  atsMatch: boolean
  /** Live HTTP 200 from the ATS listing/verification endpoint. */
  apiHttp200: boolean
  /** Number of jobs returned by the listing API at discovery time. */
  jobsFound: number
  /** At least one job has a US or Canada location. */
  usaConfirmed: boolean
  /** Number of US/Canada-located jobs seen. */
  usaJobCount: number
  /** Candidate came from a curated seed file or GitHub seed list. */
  fromCuratedSeed: boolean
  /** Candidate came from the Common Crawl CDX index. */
  fromCommonCrawl: boolean
  /** The URL is a job-detail page rather than a board/listing root. */
  isJobDetailPageOnly: boolean
  /** DNS resolution failed for the candidate domain. */
  isDnsFailure: boolean
  /** The endpoint returned a login / auth redirect instead of job data. */
  isLoginRedirect: boolean
  /** Slug pattern matches known free-trial junk patterns (BambooHR, etc.). */
  isLikelyTrial: boolean
  /** HTTP 4xx/5xx on verification (but not DNS failure). */
  isHttpError: boolean
  /** Number of previous rejected retries for this candidate. */
  priorRejections: number
  // ─── Signal-resolver factors (resolve-source.ts). All optional so the
  //     probe scripts that predate them keep compiling. ───
  /** Jobs were checked but NONE were US/Canada — an out-of-market source is
   *  pure waste for a US/Canada product. Strong negative, drives to reject. */
  usaRejected?: boolean
  /** Came from a directory/name list with no live ATS or careers-page
   *  confirmation. Holds for re-verification instead of enrolling. */
  directoryOnly?: boolean
  /** Careers page reached but no known ATS and no JobPosting schema — the
   *  expensive-to-crawl custom-portal case. */
  customAtsNoJsonLd?: boolean
}

export type ScoreResult = {
  score: number
  factors: Partial<Record<keyof ScoreFactors, number>>
  decision: "enroll" | "hold" | "reject"
  rejectedReason: string | null
}

/**
 * ATSes with a cheap, reliable public listing endpoint — a clean job-count from
 * one of these is conclusive on its own, so we skip the full heuristic score.
 */
const FAST_PATH_ATS = new Set([
  "greenhouse", "lever", "ashby", "smartrecruiters",
  "workable", "bamboohr", "recruitee", "teamtailor",
])

export interface FastPathInput {
  atsType: string | null
  endpointStatus: "ok" | "empty" | "error" | "unknown"
  jobCount: number
}

export interface FastPathResult {
  fastPath: boolean
  confidence: number
  decision: "enroll" | "retry_later" | "reject" | "fallthrough"
}

/**
 * Short-circuit for high-trust ATSes whose board endpoint we already hit. A
 * confirmed board with ≥1 job is an immediate enroll (confidence 90); a real
 * but empty board is a retry_later (confidence 60). Anything else — unknown
 * ATS, error, or unexpected status — returns `fallthrough` so the caller runs
 * the full computeConfidence heuristic instead.
 */
export function fastPathDecision(input: FastPathInput): FastPathResult {
  if (!input.atsType || !FAST_PATH_ATS.has(input.atsType)) {
    return { fastPath: false, confidence: 0, decision: "fallthrough" }
  }
  if (input.endpointStatus === "ok" && input.jobCount >= 1) {
    return { fastPath: true, confidence: 90, decision: "enroll" }
  }
  if (input.endpointStatus === "empty") {
    return { fastPath: true, confidence: 60, decision: "retry_later" }
  }
  if (input.endpointStatus === "error") {
    return { fastPath: false, confidence: 0, decision: "fallthrough" }
  }
  return { fastPath: false, confidence: 0, decision: "fallthrough" }
}

export function computeConfidence(f: ScoreFactors): ScoreResult {
  const factors: Partial<Record<keyof ScoreFactors, number>> = {}
  let score = 0

  const add = (key: keyof ScoreFactors, points: number) => {
    factors[key] = points
    score += points
  }

  if (f.atsMatch)                                   add("atsMatch",            30)
  if (f.apiHttp200 && f.jobsFound > 0)              add("apiHttp200",          30)
  else if (f.apiHttp200)                            add("apiHttp200",          15)
  if (f.usaConfirmed)                               add("usaConfirmed",        20)
  if (f.usaJobCount >= 5)                           add("usaJobCount",          5)
  if (f.fromCuratedSeed)                            add("fromCuratedSeed",     10)
  if (f.fromCommonCrawl && !f.fromCuratedSeed)      add("fromCommonCrawl",      5)

  if (f.isJobDetailPageOnly)                        add("isJobDetailPageOnly", -10)
  if (f.isLoginRedirect)                            add("isLoginRedirect",     -15)
  if (f.isLikelyTrial)                              add("isLikelyTrial",       -30)
  if (f.isDnsFailure)                               add("isDnsFailure",        -80)
  if (f.isHttpError && !f.isDnsFailure)             add("isHttpError",         -20)
  if (f.priorRejections > 0)                        add("priorRejections",     -5 * Math.min(f.priorRejections, 4))
  // Signal-resolver penalties. usaRejected is sized to push an otherwise-
  // strong (atsMatch + http200) source below the 40 reject line.
  if (f.usaRejected)                                add("usaRejected",         -50)
  if (f.directoryOnly)                              add("directoryOnly",       -15)
  if (f.customAtsNoJsonLd)                          add("customAtsNoJsonLd",   -15)

  const clamped = Math.max(0, Math.min(100, score))

  let decision: ScoreResult["decision"]
  let rejectedReason: string | null = null

  if (clamped >= 60) {
    decision = "enroll"
  } else if (clamped >= 40) {
    decision = "hold"
  } else {
    decision = "reject"
    if (f.isDnsFailure)        rejectedReason = "dns_failure"
    else if (f.usaRejected)    rejectedReason = "non_usa_only"
    else if (f.isLikelyTrial)  rejectedReason = "likely_trial_account"
    else if (f.isLoginRedirect) rejectedReason = "login_required"
    else if (f.isHttpError)    rejectedReason = "http_error"
    else                       rejectedReason = "low_confidence"
  }

  return { score: clamped, factors, decision, rejectedReason }
}

export const ENROLL_THRESHOLD = 60
export const HOLD_THRESHOLD   = 40

/**
 * How — and whether — an application can actually be submitted for a job.
 *
 * The feed and the *applyable* feed are very different numbers, and conflating
 * them overstates what auto-apply can reach by roughly 5x. Measured against the
 * 14-day active feed:
 *
 *   tier1_fillable        18.9%   public form, no account — automatable today
 *   tier2_account         41.5%   Workday/Oracle/iCIMS — needs an account first
 *   aggregator_redirect   29.6%   Dice, Adzuna, Jooble — link goes to the
 *                                 aggregator's own listing, not a form at all
 *   denylisted             0.1%   LinkedIn/Indeed — ToS, never automate
 *   unknown                9.9%   custom/company-hosted, needs a live probe
 *
 * Dice alone is ~17% of the fresh feed — the single largest source in the
 * system — and contributes zero applyable inventory. Classifying here keeps
 * that distinction in one tested place instead of scattered regexes.
 *
 * Host matching is done on the parsed URL host, never a substring of the whole
 * URL: `?redirect=greenhouse.io` in an aggregator's query string must not make
 * that job look fillable.
 */

export type ApplyMethod =
  | "tier1_fillable"
  | "tier2_account"
  | "aggregator_redirect"
  | "denylisted"
  | "unknown"

/** Public application forms that accept a submission without an account. */
const TIER1_HOSTS = [
  "greenhouse.io",
  "job-boards.greenhouse.io",
  "boards.greenhouse.io",
  "lever.co",
  "jobs.lever.co",
  "ashbyhq.com",
  "jobs.ashbyhq.com",
  "workable.com",
  "apply.workable.com",
  "applytojob.com",
  "jazzhr.com",
  "breezy.hr",
  "bamboohr.com",
  "smartrecruiters.com",
  "jobs.smartrecruiters.com",
  "recruitee.com",
  "teamtailor.com",
  "personio.de",
  "jobs.personio.de",
  "pinpointhq.com",
  "zohorecruit.com",
]

/** Applying requires creating or signing into a candidate account first. */
const TIER2_HOSTS = [
  "myworkdayjobs.com",
  "myworkdaysite.com",
  "wd1.myworkdayjobs.com",
  "oraclecloud.com",
  "icims.com",
  "taleo.net",
  "successfactors.com",
  "successfactors.eu",
  "avature.net",
  "csod.com",
  "cornerstoneondemand.com",
]

/** The link lands on an aggregator's listing page, not an application form. */
const AGGREGATOR_HOSTS = [
  "dice.com",
  "adzuna.com",
  "adzuna.ca",
  "adzuna.co.uk",
  "jooble.org",
  "arbeitnow.com",
  "arbeitnow.co.uk",
  "careerjet.com",
  "remoteok.com",
  "remoteok.io",
  "remotive.com",
  "themuse.com",
  "builtin.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
  "simplyhired.com",
]

/** Automating these violates the site's terms; the extension already blocks them. */
const DENYLISTED_HOSTS = ["linkedin.com", "indeed.com"]

function hostOf(applyUrl: string): string | null {
  try {
    const raw = applyUrl.trim()
    if (!raw) return null
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

function hostMatches(host: string, patterns: string[]): boolean {
  return patterns.some((p) => host === p || host.endsWith(`.${p}`))
}

/**
 * Classify a job by how an application would actually be submitted.
 *
 * `atsType` (from companies.ats_type) is only a fallback: the apply URL is
 * where the applicant genuinely lands, so it wins whenever it is conclusive.
 * A company tagged `greenhouse` whose posting links to Dice is a Dice link.
 */
export function classifyApplyMethod(
  applyUrl: string | null | undefined,
  atsType?: string | null,
): ApplyMethod {
  const host = hostOf(applyUrl ?? "")

  if (host) {
    if (hostMatches(host, DENYLISTED_HOSTS)) return "denylisted"
    if (hostMatches(host, AGGREGATOR_HOSTS)) return "aggregator_redirect"
    if (hostMatches(host, TIER1_HOSTS)) return "tier1_fillable"
    if (hostMatches(host, TIER2_HOSTS)) return "tier2_account"
  }

  // Vanity-domain Workday and Oracle are common (careers.acme.com fronting a
  // Workday tenant), so fall back to the company's ATS tag when the host alone
  // is inconclusive. Never upgrade to tier1 this way — claiming a form is
  // fillable when it isn't wastes a worker slot and looks like a failure.
  const ats = (atsType ?? "").trim().toLowerCase()
  if (!ats) return "unknown"
  if (["workday", "oraclecloud", "icims", "taleo", "successfactors", "avature", "cornerstone"].includes(ats)) {
    return "tier2_account"
  }
  if (["greenhouse", "lever", "ashby", "workable", "jazzhr", "breezy", "bamboohr",
       "smartrecruiters", "recruitee", "teamtailor", "personio", "pinpoint"].includes(ats)) {
    // The tag says a fillable ATS but the URL didn't confirm it — treat as
    // unknown so a live probe decides, rather than trusting a stale tag.
    return "unknown"
  }
  return "unknown"
}

/** True when auto-apply can attempt this job today (v1 scope). */
export function isAutoApplyable(applyUrl: string | null | undefined, atsType?: string | null): boolean {
  return classifyApplyMethod(applyUrl, atsType) === "tier1_fillable"
}

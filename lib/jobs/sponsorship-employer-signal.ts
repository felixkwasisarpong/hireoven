import type { Company, Job, VisaFitScoreLabel } from "@/types"
import { isStaffingIntermediaryListing } from "@/lib/jobs/hiring-entity"
import { createVisaIntelligenceFallback } from "@/lib/jobs/intelligence"

/** Job row plus joined company (nullable when join missing). */
export type EmployerSponsorshipJobInput = Job & { company?: Company | null }

// Derived directly from raw DB fields — avoids importing read-model/normalize (which pulls
// in @anthropic-ai/sdk and breaks client bundles).
function deriveVisaCardLabel(job: EmployerSponsorshipJobInput): SponsorshipVisaCardLabel | null {
  if (job.sponsors_h1b === true) return "Sponsors"
  if (job.requires_authorization === true) return "No sponsorship"
  return null
}

function deriveSponsorshipBadge(job: EmployerSponsorshipJobInput): string | null {
  const score = coercedSponsorshipPercent(job.sponsorship_score)
  if (job.sponsors_h1b === true) return "sponsors"
  if (job.requires_authorization === true) return "no_sponsorship"
  if (score >= 65) return "likely"
  return null
}

/** Normalize DB/API values: 0–100, fractional 0–1, or numeric strings. */
export function coercedSponsorshipPercent(value: unknown): number {
  if (value == null || value === "") return 0
  const n = typeof value === "number" ? value : Number.parseFloat(String(value).trim())
  if (!Number.isFinite(n)) return 0
  if (n > 0 && n <= 1) return Math.round(n * 100)
  return Math.round(Math.max(0, Math.min(100, n)))
}

export function effectiveEmployerSponsorshipScore(job: EmployerSponsorshipJobInput): number {
  const staffingIntermediary = isStaffingIntermediaryListing({ rawData: job.raw_data })
  const jobScore = coercedSponsorshipPercent(job.sponsorship_score)
  const companyConf = !staffingIntermediary && job.company
    ? coercedSponsorshipPercent(job.company.sponsorship_confidence)
    : 0
  return Math.max(jobScore, companyConf)
}

export function employerLikelySponsorsH1b(job: EmployerSponsorshipJobInput): boolean {
  const staffingIntermediary = isStaffingIntermediaryListing({ rawData: job.raw_data })
  if (staffingIntermediary) return Boolean(job.sponsors_h1b)
  return Boolean(job.sponsors_h1b) || Boolean(job.company?.sponsors_h1b)
}

export type SponsorshipVisaCardLabel =
  | "Sponsors"
  | "No sponsorship"
  | "Historical sponsorship signal"
  | null

export type H1BSponsorshipStrength = "strong" | "moderate" | "limited"
export type H1BSponsorshipTone = "emerald" | "sky" | "amber" | "rose"

export type H1BSponsorshipDisplay = {
  label: string
  sublabel: string
  tone: H1BSponsorshipTone
  strength: H1BSponsorshipStrength | null
  blockedByPosting: boolean
}

function formatH1bPetitionCount(count: number): string {
  return `${count.toLocaleString()} petition${count === 1 ? "" : "s"} last yr`
}

function sponsorshipStrengthLabel(strength: H1BSponsorshipStrength): string {
  if (strength === "strong") return "strong signal"
  if (strength === "moderate") return "moderate signal"
  return "limited signal"
}

function sponsorshipTone(strength: H1BSponsorshipStrength): H1BSponsorshipTone {
  if (strength === "strong") return "emerald"
  if (strength === "moderate") return "sky"
  return "amber"
}

/**
 * UI-friendly sponsorship badge:
 * - Uses one positive label (`H-1B sponsor`) everywhere.
 * - Varies strength by historical signal quality.
 * - Keeps explicit "No sponsorship" when posting language blocks sponsorship.
 */
export function resolveH1BSponsorshipDisplay(
  job: EmployerSponsorshipJobInput,
  options?: { visaCardLabel?: SponsorshipVisaCardLabel }
): H1BSponsorshipDisplay | null {
  const staffingIntermediary = isStaffingIntermediaryListing({ rawData: job.raw_data })
  const resolvedVisaLabel = options?.visaCardLabel ?? deriveVisaCardLabel(job)
  const blockedByPosting = resolvedVisaLabel === "No sponsorship" || job.requires_authorization === true
  if (blockedByPosting) {
    return {
      label: "No sponsorship",
      sublabel: "from posting",
      tone: "rose",
      strength: null,
      blockedByPosting: true,
    }
  }

  const count1yr = staffingIntermediary
    ? 0
    : Math.max(0, Number(job.company?.h1b_sponsor_count_1yr ?? 0))
  const count3yr = staffingIntermediary
    ? 0
    : Math.max(0, Number(job.company?.h1b_sponsor_count_3yr ?? 0))
  const score = effectiveEmployerSponsorshipScore(job)
  const hasJobTextSignal = resolvedVisaLabel === "Sponsors" || resolvedVisaLabel === "Historical sponsorship signal"
  // T1-04: a bare employer score alone must clear a real floor (65) before it
  // earns a badge — a mid-range score with no corroborating signal (petition
  // history, job-text, sponsors flag) isn't strong enough evidence, and this is
  // what suppressed the leaked constant-60 "moderate" badges. Real signals
  // (counts / job text / sponsors flag) still render regardless of score.
  const hasSponsorSignal =
    employerLikelySponsorsH1b(job) || hasJobTextSignal || count1yr > 0 || count3yr > 0 || score >= 65
  if (!hasSponsorSignal) return null

  const strongByCount = count1yr >= 25 || count3yr >= 80
  const moderateByCount = count1yr >= 5 || count3yr >= 20
  const strongByScore = score >= 78
  const moderateByScore = score >= 58

  const strength: H1BSponsorshipStrength =
    strongByCount || strongByScore
      ? "strong"
      : moderateByCount || moderateByScore || employerLikelySponsorsH1b(job) || hasJobTextSignal
        ? "moderate"
        : "limited"

  const sourceLabel =
    count1yr > 0
      ? formatH1bPetitionCount(count1yr)
      : staffingIntermediary && hasJobTextSignal
        ? "from job description"
      : score > 0
        ? `${score}% confidence`
        : hasJobTextSignal
          ? "from job description"
          : "historical signal"

  return {
    label: "H-1B sponsor",
    sublabel: `${sourceLabel} · ${sponsorshipStrengthLabel(strength)}`,
    tone: sponsorshipTone(strength),
    strength,
    blockedByPosting: false,
  }
}

export type EmployerSponsorshipPill = {
  label: string
  className: string
}

const PILL_LIKELY: EmployerSponsorshipPill = {
  label: "H-1B sponsorship likely",
  className: "border-emerald-200 bg-emerald-50 text-emerald-900",
}

const PILL_STRONG: EmployerSponsorshipPill = {
  label: "Strong sponsorship signal",
  className: "border-cyan-200 bg-cyan-50 text-cyan-900",
}

const PILL_MODERATE: EmployerSponsorshipPill = {
  label: "Moderate sponsorship signal",
  className: "border-amber-200 bg-amber-50 text-amber-900",
}

const PILL_LIMITED: EmployerSponsorshipPill = {
  label: "Limited sponsorship signal",
  className: "border-slate-200 bg-slate-50 text-slate-700",
}

const PILL_UNSPECIFIED: EmployerSponsorshipPill = {
  label: "Sponsorship not specified",
  className: "border-sky-200 bg-sky-50 text-sky-900",
}

/**
 * Employer / posting sponsorship (USCIS + job text), not resume-match "Sponsorship %" in analysis.
 * Blends job row + company and honors normalized `sponsorship_badge` so a strong canonical signal is not
 * overridden by a stale `jobs.sponsorship_score` column.
 */
/**
 * Pills for each visa-fit band. The wording deliberately mirrors the band names
 * used by the score itself, so a rail showing "Strong sponsorship signal" and
 * "Strong · 78/100" cannot disagree.
 */
const PILL_BY_BAND: Record<VisaFitScoreLabel, EmployerSponsorshipPill> = {
  "Very Strong": PILL_LIKELY,
  Strong: PILL_STRONG,
  Medium: PILL_MODERATE,
  Weak: PILL_LIMITED,
  Blocked: PILL_LIMITED,
}

/**
 * Employer / posting sponsorship signal.
 *
 * CANONICAL SOURCE: `calculateVisaFitScore`, reached through
 * `createVisaIntelligenceFallback`. This pill and the "visa fit NN/100" readout
 * on the job rail used to be two independent models — the pill read three
 * inputs (sponsors_h1b, requires_authorization, a blended score) while the
 * score reads about nine including LCA filing history, wage level, E-Verify and
 * cap-exempt status. They routinely disagreed on the same screen: "Moderate
 * sponsorship signal" a hundred lines above "Very strong visa signal 92/100".
 * The pill is now a band of the same number.
 *
 * The legacy ladder survives only as a fallback for rows too thin to score.
 */
export function employerSponsorshipPill(job: EmployerSponsorshipJobInput): EmployerSponsorshipPill {
  const visa = createVisaIntelligenceFallback(job)
  if (visa.label && typeof visa.visaFitScore === "number") {
    return PILL_BY_BAND[visa.label] ?? PILL_UNSPECIFIED
  }
  return legacyEmployerSponsorshipPill(job)
}

/**
 * Pre-consolidation ladder. Retained for rows where the visa-fit model has no
 * score to give; do not add new callers.
 */
export function legacyEmployerSponsorshipPill(job: EmployerSponsorshipJobInput): EmployerSponsorshipPill {
  const badge = deriveSponsorshipBadge(job)
  const s = effectiveEmployerSponsorshipScore(job)
  const sponsors = employerLikelySponsorsH1b(job)

  if (sponsors || badge === "sponsors") return PILL_LIKELY

  if (badge === "no_sponsorship" || job.requires_authorization) {
    return PILL_LIMITED
  }

  if (badge === "likely") return PILL_STRONG

  if (s >= 70) return PILL_STRONG
  if (s >= 50) return PILL_MODERATE
  if (job.sponsors_h1b === false && !job.company?.sponsors_h1b && s < 40) return PILL_LIMITED

  return PILL_UNSPECIFIED
}

export type EmployerSponsorshipCardCopy = {
  /** Pill label (e.g. "H-1B sponsorship likely") — derived from job + company signal. */
  title: string
  /** Numeric employer signal (0-100) when available — null means "no score on file". */
  scorePercent: number | null
  /** What the score is grounded in: "USCIS confirmed", "Posting analysis", etc. */
  sourceLabel: string
}

/**
 * Card copy is derived strictly from real fields on the job + company:
 *  - `sponsors_h1b` (USCIS-confirmed boolean)
 *  - `effectiveEmployerSponsorshipScore` (0-100 blended numeric signal)
 *  - `requires_authorization` (definitive negative signal)
 * No body strings are hard-coded; consumers render the score and source as-is.
 */
export function employerSponsorshipCardCopy(
  job: EmployerSponsorshipJobInput
): EmployerSponsorshipCardCopy {
  const pill = employerSponsorshipPill(job)
  const score = effectiveEmployerSponsorshipScore(job)
  const uscisConfirmed = employerLikelySponsorsH1b(job)
  const declined = Boolean(job.requires_authorization)

  let sourceLabel: string
  if (uscisConfirmed) sourceLabel = "USCIS-confirmed sponsor"
  else if (declined) sourceLabel = "Listing requires existing work authorization"
  else if (score > 0) sourceLabel = "Inferred from posting + employer history"
  else sourceLabel = "No sponsorship data on file"

  return {
    title: pill.label,
    scorePercent: score > 0 ? score : null,
    sourceLabel,
  }
}

export type EmployerSponsorshipSidebar = {
  scorePercent: number
  tierLabel: string
  toneClass: string
}

/** Numeric blend of job + company scores; null when no score is stored (0 means unknown, not “0%”). */
export function employerSponsorshipPercentDisplay(job: EmployerSponsorshipJobInput): number | null {
  const n = effectiveEmployerSponsorshipScore(job)
  return n > 0 ? n : null
}

/** Show the employer sponsorship card when we have a numeric signal or a non-default visa pill. */
export function shouldShowEmployerSponsorshipSidebar(job: EmployerSponsorshipJobInput): boolean {
  if (employerSponsorshipPercentDisplay(job) != null) return true
  return employerSponsorshipPill(job).label !== PILL_UNSPECIFIED.label
}

export function employerSponsorshipSidebar(job: EmployerSponsorshipJobInput): EmployerSponsorshipSidebar {
  const pill = employerSponsorshipPill(job)

  const tierLabel =
    pill.label === PILL_LIKELY.label
      ? "High sponsorship likelihood"
      : pill.label === PILL_STRONG.label
        ? "Strong employer signal"
        : pill.label === PILL_MODERATE.label
          ? "Moderate employer signal"
          : pill.label === PILL_LIMITED.label
            ? "Limited employer signal"
            : "Employer signal unclear"

  const toneClass =
    pill.label === PILL_LIKELY.label
      ? "text-emerald-700"
      : pill.label === PILL_STRONG.label
        ? "text-cyan-800"
        : pill.label === PILL_MODERATE.label
          ? "text-amber-700"
          : pill.label === PILL_LIMITED.label
            ? "text-slate-600"
            : "text-slate-600"

  return {
    scorePercent: effectiveEmployerSponsorshipScore(job),
    tierLabel,
    toneClass,
  }
}

/**
 * Company Intel Aggregator — pure derivation, no DB calls.
 *
 * Inputs:  Company row (with hiring_health + immigration_profile_summary)
 *          + recent active Job rows
 *
 * Outputs: CompanyIntel — fully evidence-backed, phrased cautiously
 *
 * Safety rules:
 *   - No fabricated response rates
 *   - No fake probabilities
 *   - No guaranteed sponsorship claims
 *   - Every signal includes the data it came from
 */

import type { Company, Job } from "@/types"
import type { CompanyIntel, CompanyIntelSummary } from "./types"

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function medianAge(jobs: Job[]): number | null {
  if (jobs.length === 0) return null
  const ages = jobs.map((j) => daysSince(j.first_detected_at)).sort((a, b) => a - b)
  const mid = Math.floor(ages.length / 2)
  return ages.length % 2 === 0 ? (ages[mid - 1] + ages[mid]) / 2 : ages[mid]
}

// ── Hiring velocity ───────────────────────────────────────────────────────────

function deriveHiringVelocity(company: Company): CompanyIntel["hiringVelocity"] {
  const health = company.hiring_health
  if (!health) return { trend: "unknown" }

  const trend: "rising" | "stable" | "slowing" | "unknown" =
    health.status === "growing"  ? "rising"  :
    health.status === "steady"   ? "stable"  :
    health.status === "slowing"  ? "slowing" :
    "unknown"

  const evidence: string[] = []

  if (health.activeJobCount != null) {
    evidence.push(`${health.activeJobCount} active opening${health.activeJobCount !== 1 ? "s" : ""} currently posted`)
  }
  if (health.recentJobCount != null && health.recentJobCount > 0) {
    evidence.push(`${health.recentJobCount} role${health.recentJobCount !== 1 ? "s" : ""} posted in the last 30 days`)
  }
  for (const sig of (health.signals ?? []).slice(0, 2)) {
    if (sig.label) evidence.push(sig.label)
  }

  return { trend, evidence: evidence.length > 0 ? evidence : undefined }
}

// ── Sponsorship signals ───────────────────────────────────────────────────────

function deriveSponsorship(company: Company): CompanyIntel["sponsorshipSignals"] {
  const immig = company.immigration_profile_summary

  return {
    h1bHistory:          (company.h1b_sponsor_count_3yr ?? 0) > 0,
    lcaHistory:          (immig?.totalLcaApplications ?? 0) > 0,
    likelySponsorsRoles: immig?.commonJobTitles?.slice(0, 6) ?? [],
    confidence:          company.sponsorship_confidence ?? 0,
  }
}

// ── Response signals ──────────────────────────────────────────────────────────

function deriveResponseSignals(jobs: Job[]): CompanyIntel["responseSignals"] {
  if (jobs.length === 0) return { likelihood: "unknown" }

  const median = medianAge(jobs) ?? 0
  const activeCount = jobs.filter((j) => j.is_active).length
  const reasons: string[] = []

  let likelihood: "high" | "medium" | "low" | "unknown"

  if (median < 21 && activeCount >= 3) {
    likelihood = "high"
    reasons.push("Recently posted active openings suggest active hiring")
    reasons.push(`${activeCount} open role${activeCount !== 1 ? "s" : ""} currently listed`)
  } else if (median < 60 || activeCount >= 1) {
    likelihood = "medium"
    if (median < 60) reasons.push("Jobs were posted within the last 2 months")
  } else {
    likelihood = "low"
    reasons.push("Job postings appear older — response likelihood may be reduced")
    if (median > 90) reasons.push("Median posting age exceeds 90 days")
  }

  return { likelihood, reasons: reasons.length > 0 ? reasons : undefined }
}

// ── Hiring freshness ──────────────────────────────────────────────────────────

function deriveFreshness(jobs: Job[]): CompanyIntel["hiringFreshness"] {
  if (jobs.length === 0) return { freshness: "unknown" }

  const now = Date.now()
  const FRESH_CUTOFF = 21   // days
  const STALE_CUTOFF = 90   // days

  const fresh = jobs.filter((j) => daysSince(j.first_detected_at) <= FRESH_CUTOFF).length
  const stale = jobs.filter((j) => daysSince(j.first_detected_at) >  STALE_CUTOFF).length
  const total = jobs.length

  const evidence: string[] = []
  let freshness: "active" | "mixed" | "stale" | "unknown"

  const freshRate = fresh / total
  const staleRate = stale / total

  if (freshRate >= 0.6) {
    freshness = "active"
    evidence.push(`${fresh} of ${total} posting${total !== 1 ? "s" : ""} added in the last 3 weeks`)
  } else if (staleRate >= 0.6) {
    freshness = "stale"
    evidence.push(`${stale} of ${total} posting${total !== 1 ? "s" : ""} older than 90 days`)
    evidence.push("Older postings may indicate reposts or slower hiring")
  } else {
    freshness = "mixed"
    evidence.push(`Mix of ${fresh} fresh and ${stale} older posting${total !== 1 ? "s" : ""}`)
  }

  // Repost signal: any job seen for > 60 days without change
  const reposts = jobs.filter((j) => daysSince(j.first_detected_at) > 60 && j.is_active).length
  if (reposts > 0) {
    evidence.push(`${reposts} role${reposts !== 1 ? "s" : ""} have been listed for over 60 days — possible repost`)
  }

  return { freshness, evidence }
}

// ── Interview signals ─────────────────────────────────────────────────────────

function deriveInterviewSignals(company: Company): CompanyIntel["interviewSignals"] {
  const size = company.size
  // Rough heuristics from company size + ATS type — no fabrication
  const stages: string[] = []
  let processLength: "short" | "medium" | "long" | "unknown" = "unknown"

  if (size === "enterprise" || size === "large") {
    processLength = "long"
    stages.push("HR screen likely", "Technical phone screen likely", "Multi-round on-site likely")
  } else if (size === "medium") {
    processLength = "medium"
    stages.push("Recruiter screen likely", "Technical assessment likely")
  } else if (size === "startup" || size === "small") {
    processLength = "short"
    stages.push("Founder/team interview likely")
  }

  // ATS type as a signal
  const ats = company.ats_type
  if (ats === "workday" || ats === "icims") {
    if (!stages.includes("HR screen likely")) stages.push("HR screen likely")
  }

  return {
    processLength: stages.length > 0 ? processLength : "unknown",
    commonStages:  stages,
  }
}

// ── Market position ───────────────────────────────────────────────────────────

function deriveMarketPosition(company: Company): CompanyIntel["marketPosition"] {
  return {
    category: company.industry ?? undefined,
    size:     company.size    ?? undefined,
  }
}

// ── Main aggregator ───────────────────────────────────────────────────────────

export function deriveCompanyIntel(company: Company, jobs: Job[]): CompanyIntel {
  return {
    companyId:         company.id,
    hiringVelocity:    deriveHiringVelocity(company),
    sponsorshipSignals: deriveSponsorship(company),
    responseSignals:   deriveResponseSignals(jobs),
    interviewSignals:  deriveInterviewSignals(company),
    hiringFreshness:   deriveFreshness(jobs),
    marketPosition:    deriveMarketPosition(company),
  }
}

// ── Summary + conversational surfacing ───────────────────────────────────────

export function buildCompanyIntelSummary(
  company: Company,
  intel: CompanyIntel,
  activeJobCount: number,
): CompanyIntelSummary {
  const conf = intel.sponsorshipSignals?.confidence ?? 0
  const signals: string[] = []

  // Sponsorship
  let sponsorshipLabel: string | undefined
  if (intel.sponsorshipSignals?.h1bHistory && conf >= 0.6) {
    sponsorshipLabel = "Historically sponsors H-1B"
    signals.push(`This company historically sponsors H-1B visas (confidence: ${Math.round(conf * 100)}%).`)
  } else if (intel.sponsorshipSignals?.h1bHistory && conf >= 0.3) {
    sponsorshipLabel = "Some H-1B history"
    signals.push("This company has some H-1B petition history, but sponsorship confidence is moderate.")
  }

  if ((intel.sponsorshipSignals?.likelySponsorsRoles?.length ?? 0) > 0) {
    signals.push(`Roles historically sponsored: ${intel.sponsorshipSignals!.likelySponsorsRoles!.slice(0, 3).join(", ")}.`)
  }

  // Hiring velocity
  let hiringLabel: string | undefined
  const trend = intel.hiringVelocity?.trend
  if (trend === "rising") {
    hiringLabel = "Hiring actively"
    signals.push("Hiring activity appears to be increasing based on job posting patterns.")
  } else if (trend === "slowing") {
    signals.push("Hiring activity may be slowing — fewer new postings in recent weeks.")
  } else if (trend === "stable") {
    signals.push("Hiring pace appears stable.")
  }

  // Freshness
  let freshnessLabel: string | undefined
  const freshness = intel.hiringFreshness?.freshness
  if (freshness === "stale") {
    freshnessLabel = "Posting appears stale"
    signals.push("Job postings appear older — some may be reposts or slow-moving roles.")
  } else if (freshness === "active") {
    signals.push("Most open roles were posted recently.")
  }

  // Response likelihood
  const likelihood = intel.responseSignals?.likelihood
  let competitionLabel: string | undefined
  if (likelihood === "low") {
    competitionLabel = "Likely high competition"
    signals.push("Response likelihood may be lower for older postings.")
  } else if (likelihood === "high") {
    signals.push("Active recent postings suggest faster response likelihood.")
  }

  // Interview
  const processLen = intel.interviewSignals?.processLength
  if (processLen === "long") {
    signals.push("Interview process is likely multi-stage — prepare for an extended timeline.")
  } else if (processLen === "short") {
    signals.push("Interview process is likely streamlined for this company size.")
  }

  return {
    companyId: company.id,
    companyName: company.name,
    sponsorshipLabel,
    hiringLabel,
    freshnessLabel,
    competitionLabel,
    activeOpeningsCount: activeJobCount,
    conversationalSignals: signals,
  }
}

/** Format company intel as a concise block for Claude's system context. */
export function formatCompanyIntelForClaude(summary: CompanyIntelSummary): string {
  const lines: string[] = [
    `Company Intelligence: ${summary.companyName}`,
    `Active openings: ${summary.activeOpeningsCount ?? "unknown"}`,
  ]

  if (summary.sponsorshipLabel) lines.push(`Sponsorship: ${summary.sponsorshipLabel}`)
  if (summary.hiringLabel)      lines.push(`Hiring status: ${summary.hiringLabel}`)
  if (summary.freshnessLabel)   lines.push(`Posting freshness: ${summary.freshnessLabel}`)
  if (summary.competitionLabel) lines.push(`Competition: ${summary.competitionLabel}`)

  if (summary.conversationalSignals.length > 0) {
    lines.push("Evidence-backed signals:")
    for (const s of summary.conversationalSignals.slice(0, 4)) {
      lines.push(`  - ${s}`)
    }
  }

  lines.push("Note: All signals are evidence-based and phrased cautiously. Do not overstate confidence.")
  return lines.join("\n")
}

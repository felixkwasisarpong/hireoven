import type {
  HiringRealityAssessment,
  HiringRealityBand,
  JobAvailabilityEvidence,
  XRayFinding,
} from "./types"
import type { HiringRealitySignalInput } from "./inputs"

const HIDDEN_CLOSED_STATUSES = new Set(["hidden_expired", "hidden_invalid"])

export function isDefinitivelyClosed(availability: JobAvailabilityEvidence): boolean {
  if (availability.isActive !== false) return false
  if (availability.closedAt && availability.closedAtReliable) return true
  return typeof availability.publicationStatus === "string" &&
    HIDDEN_CLOSED_STATUSES.has(availability.publicationStatus)
}

export function assessHiringReality(input: {
  availability: JobAvailabilityEvidence | null
  signals: HiringRealitySignalInput
  computedAt: string
  canonicalUnresolved: boolean
}): HiringRealityAssessment {
  const fallbackAvailability = input.availability ?? unknownAvailability()
  const findings: XRayFinding[] = [...(input.signals.findings ?? [])]
  const dataGaps: HiringRealityAssessment["dataGaps"] = []
  let band: HiringRealityBand = "UNKNOWN"
  let confidence = input.signals.confidence ?? "medium"
  let headline = "Posting status is not clear from the supplied data."
  const conflictingSignals = [...(input.signals.conflictingSignals ?? [])]

  if (input.canonicalUnresolved) {
    dataGaps.push({
      id: "canonical-resolution-unresolved",
      dimension: "hiringReality",
      severity: "dimension_blocking",
      label: "Canonical job could not be resolved",
      missingField: "jobs.duplicate_of_id",
      whyNotDefaulted: "A failed pointer lookup says nothing about whether the job is open.",
      resolution: { actor: "hireoven", step: "Repair the duplicate pointer or evaluate the canonical row." },
    })
    confidence = "unknown"
  } else if (isDefinitivelyClosed(fallbackAvailability)) {
    band = "CLOSED"
    confidence = "high"
    headline = "The stored posting record shows this role as closed."
    findings.push(finding("hr-closed", "Stored closure fields mark this posting closed.", "fact", "high", "limiting"))
  } else if (fallbackAvailability.isActive === false) {
    band = "LIKELY_CLOSED"
    confidence = "low"
    headline = "The row is inactive, but closure details are incomplete."
    dataGaps.push({
      id: "closure-timestamp-unreliable",
      dimension: "hiringReality",
      severity: "decision_relevant",
      label: "Closure marker is incomplete",
      missingField: "jobs.closed_at or jobs.publication_status",
      whyNotDefaulted: "Legacy crawler rows can deactivate without setting a reliable closure timestamp.",
      resolution: { actor: "hireoven", step: "Re-check the employer posting or backfill closure metadata." },
    })
  } else if (
    fallbackAvailability.lastSeenAtTrustworthy &&
    fallbackAvailability.lastSeenAt &&
    fallbackAvailability.boardLastCheckedAt &&
    daysBetween(fallbackAvailability.lastSeenAt, fallbackAvailability.boardLastCheckedAt) >= 14
  ) {
    band = "LIKELY_CLOSED"
    confidence = "low"
    headline = "The board was checked more recently than this job was observed."
  } else if (
    fallbackAvailability.applyUrlStatus === "dead" ||
    input.signals.ghostRisk.band === "high" ||
    (input.signals.employerCapacity.healthUsable &&
      input.signals.employerCapacity.healthVerdict === "critical")
  ) {
    band = "UNCERTAIN"
    confidence = "low"
    headline = "Soft signals make this posting worth verifying before relying on it."
    if (fallbackAvailability.applyUrlStatus === "dead") {
      dataGaps.push({
        id: "apply-url-unverified",
        dimension: "hiringReality",
        severity: "decision_relevant",
        label: "Apply link probe is uncertain",
        missingField: "apply_url browser verification",
        whyNotDefaulted: "A blocked HEAD request can look like a closed posting.",
        resolution: { actor: "candidate", step: "Open the employer apply link directly." },
      })
      conflictingSignals.push({
        a: "live-row",
        b: "apply-url-probe",
        resolution: "Treat the URL probe as an inference and verify the employer page.",
      })
    }
  } else if (fallbackAvailability.boardCheckIsStale) {
    band = "LIKELY_LIVE"
    confidence = "medium"
    headline = "The row is active, but the employer board check is stale."
    dataGaps.push({
      id: "board-check-stale",
      dimension: "hiringReality",
      severity: "decision_relevant",
      label: "Board check is stale",
      missingField: "companies.last_crawled_at",
      whyNotDefaulted: "Not being checked recently is not evidence the role closed.",
      resolution: { actor: "hireoven", step: "Refresh the employer board." },
    })
  } else if (fallbackAvailability.isActive === true) {
    band = "LIVE"
    headline = "The stored posting record is active."
    confidence = input.signals.confidence ?? "high"
  }

  return {
    band,
    confidence,
    headline,
    findings,
    dataGaps,
    oldestInputObservedAt: oldest([
      fallbackAvailability.firstDetectedAt,
      fallbackAvailability.lastSeenAtTrustworthy ? fallbackAvailability.lastSeenAt : null,
      fallbackAvailability.boardLastCheckedAt,
      input.signals.ghostRisk.computedAt,
      input.signals.employerCapacity.healthComputedAt,
    ]),
    computedAt: input.computedAt,
    staleInputsDowngraded: fallbackAvailability.boardCheckIsStale,
    availability: fallbackAvailability,
    ghostRisk: input.signals.ghostRisk,
    employerCapacity: input.signals.employerCapacity,
    conflictingSignals,
  }
}

function unknownAvailability(): JobAvailabilityEvidence {
  return {
    isActive: null,
    publicationStatus: null,
    closedAt: null,
    closedAtReliable: false,
    firstDetectedAt: null,
    ageDays: null,
    lastSeenAt: null,
    lastSeenAtTrustworthy: false,
    lastSeenEpochIso: null,
    ingestionPath: "unknown",
    boardLastCheckedAt: null,
    boardCheckIsStale: false,
    applyUrlStatus: "unknown",
    applyUrlProbedAt: null,
  }
}

function finding(
  id: string,
  statement: string,
  basis: XRayFinding["basis"],
  confidence: XRayFinding["confidence"],
  impact: XRayFinding["impact"],
): XRayFinding {
  return { id, statement, basis, confidence, impact, sourceFactIds: [], explanation: statement }
}

function daysBetween(a: string, b: string): number {
  const start = Date.parse(a)
  const end = Date.parse(b)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.floor((end - start) / 86_400_000))
}

function oldest(values: Array<string | null>): string | null {
  const parsed = values
    .map((value) => value ? { value, time: Date.parse(value) } : null)
    .filter((value): value is { value: string; time: number } => Boolean(value && Number.isFinite(value.time)))
    .sort((a, b) => a.time - b.time)
  return parsed[0]?.value ?? null
}

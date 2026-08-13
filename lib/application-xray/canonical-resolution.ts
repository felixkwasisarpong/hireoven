import type { ApplicationXRayInput, ApplicationXRayJobRecord } from "./inputs"
import type { CanonicalResolution, XRayDataGap } from "./types"

export type CanonicalResolutionResult = {
  canonical: CanonicalResolution
  evaluatedJob: ApplicationXRayJobRecord | null
  dataGap: XRayDataGap | null
}

const MAX_CANONICAL_HOPS = 3

export function resolveCanonicalJob(input: ApplicationXRayInput): CanonicalResolutionResult {
  const byId = new Map(input.jobRecords.map((job) => [job.id, job]))
  const requested = byId.get(input.requestedJobId) ?? null
  const requestedApplyUrl = requested?.applyUrl ?? null
  if (!requested) {
    return unresolved("unresolved_dangling", input.requestedJobId, null, 0, requestedApplyUrl)
  }

  if (!requested.duplicateOfId) {
    return {
      canonical: {
        requestedJobId: input.requestedJobId,
        evaluatedJobId: requested.id,
        outcome: "not_a_duplicate",
        hops: 0,
        canonicalApplyUrl: requested.applyUrl,
        requestedApplyUrl,
        applyUrlDiffers: false,
        sourceFactIds: [],
        note: null,
      },
      evaluatedJob: requested,
      dataGap: null,
    }
  }

  let current = requested
  const seen = new Set<string>([requested.id])
  for (let hops = 1; hops <= MAX_CANONICAL_HOPS; hops += 1) {
    const targetId = current.duplicateOfId
    if (!targetId) {
      return resolved(input.requestedJobId, requestedApplyUrl, current, hops - 1)
    }
    if (seen.has(targetId)) {
      return unresolved("unresolved_canonical_invalid", input.requestedJobId, targetId, hops, requestedApplyUrl)
    }
    const next = byId.get(targetId)
    if (!next) {
      return unresolved("unresolved_dangling", input.requestedJobId, targetId, hops, requestedApplyUrl)
    }
    if (!next.duplicateOfId) {
      return resolved(input.requestedJobId, requestedApplyUrl, next, hops)
    }
    seen.add(targetId)
    current = next
  }

  return unresolved(
    "unresolved_chain_limit",
    input.requestedJobId,
    current.duplicateOfId ?? current.id,
    MAX_CANONICAL_HOPS,
    requestedApplyUrl,
  )
}

function resolved(
  requestedJobId: string,
  requestedApplyUrl: string | null,
  job: ApplicationXRayJobRecord,
  hops: number,
): CanonicalResolutionResult {
  return {
    canonical: {
      requestedJobId,
      evaluatedJobId: job.id,
      outcome: hops === 0 ? "not_a_duplicate" : "resolved",
      hops,
      canonicalApplyUrl: job.applyUrl,
      requestedApplyUrl,
      applyUrlDiffers: Boolean(requestedApplyUrl && job.applyUrl && requestedApplyUrl !== job.applyUrl),
      sourceFactIds: [],
      note: hops === 0 ? null : "This listing is a duplicate; Application X-Ray evaluated the canonical job.",
    },
    evaluatedJob: job,
    dataGap: null,
  }
}

function unresolved(
  outcome: CanonicalResolution["outcome"],
  requestedJobId: string,
  targetId: string | null,
  hops: number,
  requestedApplyUrl: string | null,
): CanonicalResolutionResult {
  const gapId =
    outcome === "unresolved_chain_limit"
      ? "duplicate-chain-too-deep"
      : outcome === "unresolved_canonical_invalid"
        ? "canonical-row-invalid"
        : "canonical-row-missing"
  return {
    canonical: {
      requestedJobId,
      evaluatedJobId: null,
      outcome,
      hops,
      canonicalApplyUrl: null,
      requestedApplyUrl,
      applyUrlDiffers: false,
      sourceFactIds: [],
      note: targetId
        ? `Canonical job ${targetId} could not be evaluated.`
        : "Requested job could not be evaluated.",
    },
    evaluatedJob: null,
    dataGap: {
      id: gapId,
      dimension: "overall",
      severity: "dimension_blocking",
      label: "Canonical job could not be resolved",
      missingField: "jobs.duplicate_of_id",
      whyNotDefaulted: "A failed duplicate pointer lookup says nothing about the posting.",
      resolution: { actor: "hireoven", step: "Repair the duplicate pointer." },
    },
  }
}

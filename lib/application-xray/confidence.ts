import type { XRayConfidence } from "./types"

const RANK: Record<XRayConfidence, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
}

const BY_RANK: XRayConfidence[] = ["unknown", "low", "medium", "high"]

export function confidenceAtLeast(value: XRayConfidence, floor: XRayConfidence): boolean {
  return RANK[value] >= RANK[floor]
}

export function minConfidence(values: XRayConfidence[]): XRayConfidence {
  if (values.length === 0) return "unknown"
  return BY_RANK[Math.min(...values.map((value) => RANK[value]))] ?? "unknown"
}

export function capConfidence(value: XRayConfidence, cap: XRayConfidence): XRayConfidence {
  return RANK[value] <= RANK[cap] ? value : cap
}

export function lowerConfidence(value: XRayConfidence, steps = 1): XRayConfidence {
  return BY_RANK[Math.max(0, RANK[value] - steps)] ?? "unknown"
}

export function confidenceFromCoverage(
  base: XRayConfidence,
  knownDimensionCount: number,
): XRayConfidence {
  if (knownDimensionCount <= 2) return "unknown"
  if (knownDimensionCount === 3) return lowerConfidence(base)
  return base
}

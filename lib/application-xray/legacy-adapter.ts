import type {
  ApplicationXRay,
  LegacyVerdictLabel,
  LegacyVerdictRecommendation,
} from "./types"

export type ApplicationXRayLegacyVerdictProjection = NonNullable<ApplicationXRay["legacyVerdictProjection"]>

export function xrayToApplicationVerdict(xray: ApplicationXRay): ApplicationXRayLegacyVerdictProjection {
  return {
    verdict: verdictForXRay(xray),
    recommendation: recommendationForXRay(xray),
    derivedFrom: "application_xray",
  }
}

function verdictForXRay(xray: ApplicationXRay): LegacyVerdictLabel {
  switch (xray.finalAction) {
    case "APPLY_NOW":
      return xray.confidence === "low" ? "Maybe" : "Apply Today"
    case "STRENGTHEN_FIRST":
      return "Apply, But Customize Resume"
    case "FIND_ACCESS":
      return "Maybe"
    case "SKIP":
      return xray.confidence === "high" ? "Skip" : "High Risk"
    case "INSUFFICIENT_DATA":
      return "Unknown"
  }
}

function recommendationForXRay(xray: ApplicationXRay): LegacyVerdictRecommendation {
  switch (xray.finalAction) {
    case "APPLY_NOW":
      return xray.confidence === "low" ? "watch" : "apply_now"
    case "STRENGTHEN_FIRST":
      return xray.capability.band === "STRETCH" ? "stretch_role" : "apply_with_tweaks"
    case "FIND_ACCESS":
      return "watch"
    case "SKIP":
      return xray.confidence === "high" ? "skip" : "avoid"
    case "INSUFFICIENT_DATA":
      return "unknown"
  }
}

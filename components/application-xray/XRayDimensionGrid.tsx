import type { ApplicationXRay, XRayDimensionKey } from "@/lib/application-xray/types"
import { DIMENSION_ORDER } from "./xray-presenters"
import { XRayDimensionCard } from "./XRayDimensionCard"

export function XRayDimensionGrid({
  xray,
  onExpandDimension,
}: {
  xray: ApplicationXRay
  onExpandDimension?: (dimension: XRayDimensionKey) => void
}) {
  return (
    <div className="space-y-2.5" aria-label="Application X-Ray dimensions">
      {DIMENSION_ORDER.map((dimensionKey) => (
        <XRayDimensionCard
          key={dimensionKey}
          xray={xray}
          dimensionKey={dimensionKey}
          onExpand={onExpandDimension}
        />
      ))}
    </div>
  )
}

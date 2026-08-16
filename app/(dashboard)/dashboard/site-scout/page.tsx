import type { Metadata } from "next"
import { Suspense } from "react"
import { CareerSiteScoutPageClient } from "./CareerSiteScoutPageClient"

export const metadata: Metadata = {
  title: "Career Site Scout | Hireoven",
  description: "Scan external career sites, rank matching roles, and prepare selected applications.",
}

export default function CareerSiteScoutPage() {
  return (
    <Suspense>
      <CareerSiteScoutPageClient />
    </Suspense>
  )
}

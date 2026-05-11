export const dynamic = "force-dynamic"

import dynamic from "next/dynamic"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"

const LayoffCohortHub = dynamic(
  () => import("@/components/cohorts/LayoffCohortHub"),
  { ssr: false }
)

export default function CohortsPage() {
  return (
    <>
      <DashboardPageHeader
        kicker="Layoff Cohorts"
        title="Collective Applying"
        description="Join former colleagues, vouch for each other, and get found by employers hiring from your cohort."
        className="rounded-none border-x-0 border-t-0"
      />
      <LayoffCohortHub />
    </>
  )
}

export const dynamic = "force-dynamic"

import dynamicImport from "next/dynamic"
import { Users } from "lucide-react"
import GrowPageShell from "@/components/grow/GrowPageShell"

const LayoffCohortHub = dynamicImport(
  () => import("@/components/cohorts/LayoffCohortHub"),
  { ssr: false }
)

export default function CohortsPage() {
  return (
    <GrowPageShell
      kicker="Grow"
      title="Collective Applying"
      description="Join peers from the same transition, share leads, vouch for each other, and get found by employers hiring from your cohort."
      icon={Users}
      signals={[
        { label: "Network", value: "Peer cohorts" },
        { label: "Proof", value: "Member vouches" },
        { label: "Demand", value: "Employer requests" },
      ]}
    >
      <LayoffCohortHub />
    </GrowPageShell>
  )
}

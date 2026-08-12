export const dynamic = "force-dynamic"

import dynamicImport from "next/dynamic"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"

const OutreachSequences = dynamicImport(() => import("@/components/outreach/OutreachSequences"), { ssr: false })

export default function OutreachPage() {
  return (
    <main>
      <DashboardPageHeader
        kicker="Search & Apply"
        title="Outreach"
        description="Run AI-drafted, multi-touch outreach to recruiters and hiring managers — Apex schedules the follow-ups and stops when they reply."
        className="rounded-none border-x-0 border-t-0"
      />
      <OutreachSequences />
    </main>
  )
}

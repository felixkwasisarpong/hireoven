export const dynamic = "force-dynamic"

import dynamicImport from "next/dynamic"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"

const BackgroundCheckTool = dynamicImport(
  () => import("@/components/background-check/BackgroundCheckTool"),
  { ssr: false }
)

export default function BackgroundCheckPage() {
  return (
    <>
      <DashboardPageHeader
        kicker="Background Check Awareness"
        title="Fair Chance Check"
        description="Understand how your background may be reviewed — and where your protections are."
        className="rounded-none border-x-0 border-t-0"
      />
      <BackgroundCheckTool />
    </>
  )
}

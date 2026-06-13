export const dynamic = "force-dynamic"

import dynamicImport from "next/dynamic"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"

const SkillGapEngine = dynamicImport(() => import("@/components/grow/SkillGapEngine"), { ssr: false })

export default function SkillGapPage() {
  return (
    <>
      <DashboardPageHeader
        kicker="Grow"
        title="Skill Gaps"
        description="See which skills unlock the most roles you're targeting — and what they pay — then learn the one that moves the needle."
        className="rounded-none border-x-0 border-t-0"
      />
      <SkillGapEngine />
    </>
  )
}

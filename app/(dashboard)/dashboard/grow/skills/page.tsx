export const dynamic = "force-dynamic"

import dynamicImport from "next/dynamic"
import { GraduationCap } from "lucide-react"
import GrowPageShell from "@/components/grow/GrowPageShell"

const SkillGapEngine = dynamicImport(() => import("@/components/grow/SkillGapEngine"), { ssr: false })

export default function SkillGapPage() {
  return (
    <GrowPageShell
      kicker="Grow"
      title="Skill Gaps"
      description="See which skills unlock the most roles you're targeting, what they pay, and the one learning move that changes your odds."
      icon={GraduationCap}
      signals={[
        { label: "Ranked by", value: "Jobs unlocked" },
        { label: "Market data", value: "Live postings" },
        { label: "Next step", value: "Course picks" },
      ]}
    >
      <SkillGapEngine />
    </GrowPageShell>
  )
}

export const dynamic = "force-dynamic"

import dynamicImport from "next/dynamic"
import { ShieldCheck } from "lucide-react"
import GrowPageShell from "@/components/grow/GrowPageShell"

const BackgroundCheckTool = dynamicImport(
  () => import("@/components/background-check/BackgroundCheckTool"),
  { ssr: false }
)

export default function BackgroundCheckPage() {
  return (
    <GrowPageShell
      kicker="Grow"
      title="Fair Chance Check"
      description="Understand how your background may be reviewed, what protections apply, and which employers are more open to second-chance hiring."
      icon={ShieldCheck}
      signals={[
        { label: "Privacy", value: "Browser-only intake" },
        { label: "Coverage", value: "State protections" },
        { label: "Search", value: "Fair chance employers" },
      ]}
    >
      <BackgroundCheckTool />
    </GrowPageShell>
  )
}

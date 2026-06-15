export const dynamic = "force-dynamic"

import dynamicImport from "next/dynamic"
import { TrendingUp } from "lucide-react"
import GrowPageShell from "@/components/grow/GrowPageShell"

const PersonalBrandHub = dynamicImport(
  () => import("@/components/brand/PersonalBrandHub"),
  { ssr: false }
)

export default function BrandPage() {
  return (
    <GrowPageShell
      kicker="Grow"
      title="Brand Visibility"
      description="Audit your recruiter-facing presence, generate credible LinkedIn ideas, and keep a steady content rhythm."
      icon={TrendingUp}
      signals={[
        { label: "Measure", value: "Visibility score" },
        { label: "Create", value: "Content ideas" },
        { label: "Ship", value: "Draft writer" },
      ]}
    >
      <PersonalBrandHub />
    </GrowPageShell>
  )
}

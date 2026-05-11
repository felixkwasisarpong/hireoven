export const dynamic = "force-dynamic"

import dynamic from "next/dynamic"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"

const PersonalBrandHub = dynamic(
  () => import("@/components/brand/PersonalBrandHub"),
  { ssr: false }
)

export default function BrandPage() {
  return (
    <>
      <DashboardPageHeader
        kicker="Personal Brand"
        title="Brand Visibility"
        description="Build your presence, generate content ideas, and track what recruiters see when they search for you."
        className="rounded-none border-x-0 border-t-0"
      />
      <PersonalBrandHub />
    </>
  )
}

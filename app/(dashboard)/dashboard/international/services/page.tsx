export const dynamic = "force-dynamic"

import dynamicImport from "next/dynamic"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"

const ImmigrationServices = dynamicImport(() => import("@/components/immigration/ImmigrationServices"), { ssr: false })

export default function ImmigrationServicesPage() {
  return (
    <>
      <DashboardPageHeader
        kicker="International"
        title="Immigration Services"
        description="Book vetted immigration attorneys and document-prep partners — consults, petition reviews, and RFE support, at flat quoted prices."
        className="rounded-none border-x-0 border-t-0"
      />
      <ImmigrationServices />
    </>
  )
}

import { NextResponse } from "next/server"
import { getFeatureFlags } from "@/lib/admin/feature-flags"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const flags = await getFeatureFlags()
  return NextResponse.json({
    paymentsDisabled: flags.paymentsDisabled.enabled,
    maintenanceBanner: flags.maintenanceBanner.enabled
      ? { enabled: true, message: flags.maintenanceBanner.message }
      : { enabled: false, message: "" },
  })
}

import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import { buildGrowthMetrics } from "@/lib/admin/growth-metrics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const daysParam = Number(request.nextUrl.searchParams.get("days"))
  const windowDays = Number.isFinite(daysParam) && daysParam >= 7 && daysParam <= 90 ? Math.floor(daysParam) : 14

  try {
    const payload = await buildGrowthMetrics(getPostgresPool(), windowDays)
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, max-age=0" } })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

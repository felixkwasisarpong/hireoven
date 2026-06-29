import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import { buildDiscoveryStats } from "@/lib/admin/discovery-stats"

export const dynamic = "force-dynamic"

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const payload = await buildDiscoveryStats(getPostgresPool())
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

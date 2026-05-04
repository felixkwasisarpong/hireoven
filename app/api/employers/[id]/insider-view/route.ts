import { NextResponse } from "next/server"
import { getInsiderViewStats } from "@/lib/checkins/signal-extractor"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params

  try {
    const stats = await getInsiderViewStats(companyId)
    if (!stats) return NextResponse.json({ stats: null })
    return NextResponse.json({ stats })
  } catch (err) {
    console.error("[insider-view] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ stats: null })
  }
}

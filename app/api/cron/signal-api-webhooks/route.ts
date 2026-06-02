import { NextResponse } from "next/server"
import { drainSignalApiWebhookDeliveryQueue } from "@/lib/signal-api/webhooks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = clampInt(searchParams.get("limit"), 25, 1, 200)
  const workerId = searchParams.get("workerId")?.trim() || undefined
  const result = await drainSignalApiWebhookDeliveryQueue({ limit, workerId })

  return NextResponse.json({ ok: true, ...result })
}

import { NextRequest, NextResponse } from "next/server"
import { removeSubscription, savePushSubscription } from "@/lib/alerts/push-subscriptions"
import { createClient } from "@/lib/supabase/server"
import type { WebPushSubscription } from "@/types"

async function getCurrentUserId() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.id ?? null
}

export async function GET() {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return NextResponse.json(
      { error: "Missing VAPID public key configuration" },
      { status: 503 }
    )
  }

  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY })
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json()) as { subscription?: WebPushSubscription }
  if (!body.subscription) {
    return NextResponse.json(
      { error: "Missing push subscription payload" },
      { status: 400 }
    )
  }

  await savePushSubscription(userId, body.subscription)
  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { endpoint?: string }
  if (!body.endpoint) {
    return NextResponse.json(
      { error: "Missing subscription endpoint" },
      { status: 400 }
    )
  }

  await removeSubscription(body.endpoint)
  return NextResponse.json({ success: true })
}

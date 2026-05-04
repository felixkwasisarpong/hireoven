import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getTimingOptimizedQueue } from "@/lib/scout/timing/queue-manager"

export const runtime = "nodejs"
export const maxDuration = 30

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const queue = await getTimingOptimizedQueue(user.id)
    return NextResponse.json({ queue })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[application-queue]", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

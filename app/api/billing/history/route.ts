import { NextResponse } from "next/server"
import { getBillingHistoryByUserId } from "@/lib/billing/history"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const snapshot = await getBillingHistoryByUserId(user.id)
  return NextResponse.json(snapshot)
}

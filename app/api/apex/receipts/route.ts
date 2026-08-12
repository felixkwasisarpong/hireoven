import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { getApexReceipts } from "@/lib/apex/receipts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// What Apex did since the user was away (welcome-screen review #8).
export async function GET() {
  if (!hasPostgresEnv()) return NextResponse.json({ receipts: null })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const receipts = await getApexReceipts(getPostgresPool(), user.id).catch(() => null)
  return NextResponse.json({ receipts }, { headers: { "Cache-Control": "no-store" } })
}

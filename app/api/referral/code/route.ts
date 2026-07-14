import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getOrCreateReferralCode } from "@/lib/referral/codes"
import { resolveAppOrigin } from "@/lib/app-url"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const code = await getOrCreateReferralCode(pool, user.id)
  const url = `${resolveAppOrigin()}/ref/${code}`

  return NextResponse.json({ code, url })
}

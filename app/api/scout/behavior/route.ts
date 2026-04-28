import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getScoutBehaviorSignals } from "@/lib/scout/behavior"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const signals = await getScoutBehaviorSignals(user.id)
    return NextResponse.json({ signals })
  } catch (err) {
    console.error("Scout behavior signals error:", err)
    return NextResponse.json({ signals: null })
  }
}

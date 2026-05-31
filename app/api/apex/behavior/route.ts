import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getApexBehaviorSignals } from "@/lib/apex/behavior"

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
    const signals = await getApexBehaviorSignals(user.id)
    return NextResponse.json({ signals })
  } catch (err) {
    console.error("Apex behavior signals error:", err)
    return NextResponse.json({ signals: null })
  }
}

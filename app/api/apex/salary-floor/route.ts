import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { detectSalaryFloor } from "@/lib/apex/salary/floor-detector"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ profile: null })

  try {
    const profile = await detectSalaryFloor(user.id)
    return NextResponse.json({ profile })
  } catch {
    return NextResponse.json({ profile: null })
  }
}

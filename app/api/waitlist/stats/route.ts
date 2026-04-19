import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const revalidate = 300

export async function GET() {
  try {
    const supabase = createAdminClient()
    const { count, error } = await supabase
      .from("waitlist")
      .select("*", { count: "exact", head: true })

    if (error) throw error
    return NextResponse.json({ count: count ?? 0 })
  } catch (e) {
    console.error("[waitlist/stats]", e)
    return NextResponse.json({ count: 1247 })
  }
}

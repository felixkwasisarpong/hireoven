import { NextResponse } from "next/server"
import { fetchPipelineStatsForUser } from "@/lib/applications/pipeline-stats"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const stats = await fetchPipelineStatsForUser(user.id)
    return NextResponse.json(stats)
  } catch {
    return NextResponse.json({ error: "Failed to load application stats" }, { status: 500 })
  }
}

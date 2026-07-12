import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isValidTimeZone, suggestSlotsForDay } from "@/lib/interview/scheduling"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_DURATIONS = [15, 30]

// GET /api/interview/schedule/slots?date=YYYY-MM-DD&tz=America/New_York&durationMin=30
// Suggests bookable slots for the day, ranked by how busy the system is.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = request.nextUrl
  const date = url.searchParams.get("date") ?? ""
  const timeZone = url.searchParams.get("tz") ?? "UTC"
  const durationMin = parseInt(url.searchParams.get("durationMin") ?? "30", 10)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be formatted YYYY-MM-DD" }, { status: 400 })
  }
  if (!isValidTimeZone(timeZone)) {
    return NextResponse.json({ error: "tz must be a valid IANA timezone" }, { status: 400 })
  }
  if (!VALID_DURATIONS.includes(durationMin)) {
    return NextResponse.json({ error: "durationMin must be 15 or 30" }, { status: 400 })
  }

  try {
    const slots = await suggestSlotsForDay({ date, timeZone, durationMin })
    return NextResponse.json({ slots })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to suggest slots" },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getMarketIntelligence } from "@/lib/scout/market-intelligence"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const maxDuration = 15

type ProfileSalaryRow = { salary_expectation_min: number | null }

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Fetch salary expectation for salary alignment signal
    const pool = getPostgresPool()
    const profileRes = await pool.query<ProfileSalaryRow>(
      `SELECT salary_expectation_min FROM profiles WHERE id = $1 LIMIT 1`,
      [user.id],
    )
    const salaryExpMin = profileRes.rows[0]?.salary_expectation_min ?? null

    const result = await getMarketIntelligence(user.id, salaryExpMin)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ signals: [], computedAt: new Date().toISOString() })
  }
}

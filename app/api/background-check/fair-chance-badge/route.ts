import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const companyId = searchParams.get("companyId")

  if (!companyId) {
    return NextResponse.json({ isFairChance: false })
  }

  try {
    const pool = getPostgresPool()
    const result = await pool.query<{ pledge_type: string; verified: boolean }>(
      `SELECT pledge_type, verified
       FROM public.fair_chance_employers
       WHERE company_id = $1
       LIMIT 1`,
      [companyId]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ isFairChance: false })
    }

    return NextResponse.json({
      isFairChance: true,
      pledgeType: result.rows[0].pledge_type,
      verified: result.rows[0].verified,
    })
  } catch (err) {
    console.error("[fair-chance-badge] Query error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ isFairChance: false })
  }
}

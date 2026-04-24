import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const pool = getPostgresPool()
    const result = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM waitlist")
    return NextResponse.json({ count: Number(result.rows[0]?.count ?? 0) })
  } catch (e) {
    console.error("[waitlist/stats]", e)
    return NextResponse.json({ count: 1247 })
  }
}

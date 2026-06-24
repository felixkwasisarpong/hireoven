import { NextResponse } from "next/server"
import { z } from "zod"
import { getCompanyH1bRank } from "@/lib/h1b/leaderboard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ParamsSchema = z.object({ company_id: z.string().uuid() })

export async function GET(
  _req: Request,
  { params }: { params: { company_id: string } }
) {
  const parsed = ParamsSchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_company_id", code: "VALIDATION_ERROR" },
      { status: 400 }
    )
  }

  try {
    const rank = await getCompanyH1bRank(parsed.data.company_id)
    if (!rank) {
      return NextResponse.json({ error: "not_found", code: "NOT_FOUND" }, { status: 404 })
    }
    return NextResponse.json(rank, {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    })
  } catch (err) {
    console.error("[leaderboard:h1b:rank]", err)
    return NextResponse.json({ error: "internal_error", code: "INTERNAL" }, { status: 500 })
  }
}

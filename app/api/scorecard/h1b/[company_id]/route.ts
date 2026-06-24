import { NextResponse } from "next/server"
import { z } from "zod"
import { getCompanyScorecard } from "@/lib/h1b/scorecard-query"

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
    const payload = await getCompanyScorecard(parsed.data.company_id)
    if (!payload) {
      return NextResponse.json(
        { error: "not_found", code: "COMPANY_NOT_FOUND" },
        { status: 404 }
      )
    }
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    })
  } catch (err) {
    console.error("[scorecard:h1b]", err)
    return NextResponse.json({ error: "internal_error", code: "INTERNAL" }, { status: 500 })
  }
}

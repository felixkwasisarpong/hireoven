import { NextResponse } from "next/server"
import { z } from "zod"
import { getCompanyLayoffSignal } from "@/lib/h1b/layoff-signal-query"

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
    const signal = await getCompanyLayoffSignal(parsed.data.company_id)
    if (!signal) {
      return NextResponse.json({ error: "not_found", code: "COMPANY_NOT_FOUND" }, { status: 404 })
    }
    return NextResponse.json(signal, {
      // Shorter than scorecard (1h): layoff events are time-sensitive and the
      // importer runs daily — stale "stable" here is more damaging than stale rank.
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    })
  } catch (err) {
    console.error("[layoff-signal]", err)
    return NextResponse.json({ error: "internal_error", code: "INTERNAL" }, { status: 500 })
  }
}

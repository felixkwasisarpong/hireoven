import { NextResponse } from "next/server"
import { z } from "zod"
import { getWageForCompanyRole, getCompanyWageBreakdown } from "@/lib/salaries/wage-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const P = z.object({ company_id: z.string().uuid() })

export async function GET(
  req: Request,
  { params }: { params: { company_id: string } }
) {
  const parsed = P.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_company_id" }, { status: 400 })
  }
  const id = parsed.data.company_id
  const url = new URL(req.url)
  const socGroup = url.searchParams.get("soc_group")
  const state = url.searchParams.get("state") ?? undefined
  const level = url.searchParams.get("wage_level")

  if (socGroup) {
    const rollup = await getWageForCompanyRole(id, socGroup, state, level ? Number(level) : undefined)
    return NextResponse.json(rollup, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    })
  }
  const breakdown = await getCompanyWageBreakdown(id)
  return NextResponse.json(breakdown, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  })
}

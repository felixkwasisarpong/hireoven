import { NextResponse } from "next/server"
import { getSocRoleBySlug } from "@/lib/salaries/soc-roles"
import { getWageForRole, getTopPayingCompaniesForRole } from "@/lib/salaries/wage-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: { soc_group_slug: string } }
) {
  const role = await getSocRoleBySlug(params.soc_group_slug)
  if (!role) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const url = new URL(req.url)
  const state = url.searchParams.get("state") ?? undefined
  const level = url.searchParams.get("wage_level")
  const wageLevel = level ? Number(level) : undefined

  const [rollup, top] = await Promise.all([
    getWageForRole(role.soc_group, state, wageLevel),
    getTopPayingCompaniesForRole(role.soc_group, state, 25),
  ])
  return NextResponse.json(
    { role, ...rollup, top_companies: top },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  )
}

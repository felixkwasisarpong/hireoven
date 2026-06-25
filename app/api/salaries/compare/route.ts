import { NextResponse } from "next/server"
import { z } from "zod"
import { getSocRoleBySlug } from "@/lib/salaries/soc-roles"
import { getWageForCompanyRole } from "@/lib/salaries/wage-query"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const Q = z.object({
  a: z.string().uuid(),
  b: z.string().uuid(),
  role: z.string().min(1),
  state: z.string().length(2).optional(),
})

async function companyName(id: string): Promise<string | null> {
  if (!hasPostgresEnv()) return null
  const { rows } = await getPostgresPool().query<{ name: string }>(
    "SELECT name FROM companies WHERE id = $1 LIMIT 1",
    [id]
  )
  return rows[0]?.name ?? null
}

export async function GET(req: Request) {
  const parsed = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", code: "VALIDATION_ERROR" }, { status: 400 })
  }
  const { a, b, role: roleSlug, state } = parsed.data
  const role = await getSocRoleBySlug(roleSlug)
  if (!role) return NextResponse.json({ error: "role_not_found" }, { status: 404 })

  const [na, nb, wa, wb] = await Promise.all([
    companyName(a),
    companyName(b),
    getWageForCompanyRole(a, role.soc_group, state),
    getWageForCompanyRole(b, role.soc_group, state),
  ])

  return NextResponse.json(
    {
      role,
      state: state ?? null,
      a: { id: a, name: na, ...wa },
      b: { id: b, name: nb, ...wb },
    },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  )
}

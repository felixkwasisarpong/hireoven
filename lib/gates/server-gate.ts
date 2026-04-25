import { NextRequest, NextResponse } from "next/server"
import { getSessionUser, getSessionUserFromRequest } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import { type FeatureKey, type Plan, canAccess, requiredPlanFor } from "./index"

export async function getUserPlan(request?: NextRequest): Promise<{ userId: string | null; plan: Plan | null }> {
  const session = request ? await getSessionUserFromRequest(request) : await getSessionUser()
  if (!session) return { userId: null, plan: null }

  const pool = getPostgresPool()
  try {
    const result = await pool.query<{ plan: string | null; status: string | null }>(
      `SELECT plan, status
       FROM subscriptions
       WHERE user_id = $1
         AND status IN ('active', 'trialing')
       ORDER BY created_at DESC
       LIMIT 1`,
      [session.sub]
    )
    const sub = result.rows[0] ?? null

    const plan: Plan = (sub?.plan as Plan) ?? "free"
    return { userId: session.sub, plan }
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : null
    // Local/test restores may not include billing tables; default to free instead of hard-failing APIs.
    if (code === "42P01") {
      return { userId: session.sub, plan: "free" }
    }
    throw error
  }
}

export function gateResponse(status: 401 | 403, message: string, requiredPlan?: string): NextResponse {
  return NextResponse.json(
    { error: message, requiredPlan: requiredPlan ?? null, code: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" },
    { status }
  )
}

export async function requireFeature(
  feature: FeatureKey,
  request?: NextRequest
): Promise<{ userId: string; plan: Plan } | NextResponse> {
  const { userId, plan } = await getUserPlan(request)

  if (!userId) return gateResponse(401, "Authentication required")

  if (!canAccess(plan, feature)) {
    const needed = requiredPlanFor(feature)
    return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
  }

  return { userId, plan: plan! }
}

import { NextRequest, NextResponse } from "next/server"
import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { cookies } from "next/headers"
import { type FeatureKey, type Plan, canAccess, requiredPlanFor } from "./index"

export async function getUserPlan(request?: NextRequest): Promise<{ userId: string | null; plan: Plan | null }> {
  const cookieStore = request
    ? {
        get: (name: string) => request.cookies.get(name)?.value,
        set: (_name: string, _value: string, _opts: CookieOptions) => {},
        remove: (_name: string, _opts: CookieOptions) => {},
      }
    : {
        get: async (name: string) => {
          const store = await cookies()
          return store.get(name)?.value
        },
        set: async () => {},
        remove: async () => {},
      }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieStore as any }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, plan: null }

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", user.id)
    .in("status", ["active", "trialing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const plan: Plan = (sub?.plan as Plan) ?? "free"
  return { userId: user.id, plan }
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

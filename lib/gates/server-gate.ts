import { NextRequest, NextResponse } from "next/server"
import { getSessionUser, getSessionUserFromRequest } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import { type FeatureKey, type Plan, canAccess, requiredPlanFor } from "./index"

const INTERNATIONAL_VISA_STATUSES = new Set(["opt", "stem_opt", "h1b", "green_card", "other"])

/** Normalise the raw plan string from the DB.
 *  Existing subscribers stored as "pro_international" are treated as pro_max.
 */
function normalisePlan(raw: string | null | undefined): Plan {
  if (!raw) return "free"
  if (raw === "pro_international") return "pro_max"
  if (raw === "pro" || raw === "pro_max") return raw
  return "free"
}

export async function getPlanForUserId(userId: string): Promise<Plan> {
  const pool = getPostgresPool()
  try {
    // Only consider subscriptions whose paid window hasn't expired. A row in
    // past_due / unpaid whose current_period_end is in the past has no
    // active entitlements left — Stripe will have moved it to canceled
    // shortly via the webhook, but we don't want to trust the row in the
    // gap.
    const result = await pool.query<{ plan: string | null }>(
      `SELECT plan
       FROM subscriptions
       WHERE user_id = $1
         AND status IN ('active', 'trialing', 'past_due', 'unpaid')
         AND (current_period_end IS NULL OR current_period_end > now())
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [userId]
    )
    return normalisePlan(result.rows[0]?.plan)
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : null
    if (code === "42P01") return "free"
    throw error
  }
}

export async function getUserPlan(
  request?: NextRequest
): Promise<{ userId: string | null; plan: Plan | null }> {
  const session = request ? await getSessionUserFromRequest(request) : await getSessionUser()
  if (!session) return { userId: null, plan: null }

  const plan = await getPlanForUserId(session.sub)
  return { userId: session.sub, plan }
}

/** True when the user's profile indicates they are an international candidate.
 *  Used to gate international tools — these are free, not plan-gated. */
export async function isInternationalUser(userId: string): Promise<boolean> {
  const pool = getPostgresPool()
  const result = await pool.query<{
    is_international: boolean
    visa_status: string | null
    needs_sponsorship: boolean
  }>(
    `SELECT is_international, visa_status, needs_sponsorship
     FROM profiles
     WHERE id = $1`,
    [userId]
  )
  const p = result.rows[0]
  if (!p) return false
  return (
    Boolean(p.is_international) ||
    Boolean(p.needs_sponsorship) ||
    INTERNATIONAL_VISA_STATUSES.has(p.visa_status ?? "")
  )
}

export function gateResponse(
  status: 401 | 403,
  message: string,
  requiredPlan?: string
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      requiredPlan: requiredPlan ?? null,
      code: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
    },
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
    return gateResponse(
      403,
      `This feature requires the ${needed} plan`,
      needed ?? undefined
    )
  }

  return { userId, plan: plan! }
}

/** Require auth + international profile. Returns 403 with a profile-prompt
 *  error code if the user hasn't set their visa status. */
export async function requireInternational(
  request?: NextRequest
): Promise<{ userId: string; plan: Plan } | NextResponse> {
  const { userId, plan } = await getUserPlan(request)
  if (!userId) return gateResponse(401, "Authentication required")

  const intl = await isInternationalUser(userId)
  if (!intl) {
    return NextResponse.json(
      {
        error: "Set your visa status to access international tools.",
        code: "INTERNATIONAL_PROFILE_REQUIRED",
      },
      { status: 403 }
    )
  }

  return { userId, plan: plan! }
}

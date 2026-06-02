import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getMarketIntelligence } from "@/lib/apex/market-intelligence"
import { requireSignalApiAuth } from "@/lib/signal-api/auth"
import { signalApiError, signalApiJson } from "@/lib/signal-api/http"
import { logAndReturnSignalApiResponse } from "@/lib/signal-api/request-log"

export const runtime = "nodejs"
export const maxDuration = 15

type ProfileSalaryRow = {
  salary_expectation_min: number | null
}

export async function GET(request: Request) {
  const startedAtMs = Date.now()
  const auth = await requireSignalApiAuth(request, {
    requiredScopes: ["signals.read"],
    requireUser: true,
  })
  if (auth instanceof NextResponse) return auth

  const finish = (response: Response) =>
    logAndReturnSignalApiResponse(request, auth, startedAtMs, response)

  try {
    const pool = getPostgresPool()
    const profileRes = await pool.query<ProfileSalaryRow>(
      `SELECT salary_expectation_min
       FROM profiles
       WHERE id = $1
       LIMIT 1`,
      [auth.subjectUserId]
    )

    const salaryExpMin = profileRes.rows[0]?.salary_expectation_min ?? null
    const result = await getMarketIntelligence(auth.subjectUserId!, salaryExpMin, auth.tenantId)

    return finish(signalApiJson(auth, result))
  } catch (error) {
    console.error("[signal/v1/signals/market] error", error)
    return finish(signalApiError(500, "Unable to compute market signals", "INTERNAL_ERROR", auth.requestId, auth.rateLimit, undefined, auth.quota))
  }
}

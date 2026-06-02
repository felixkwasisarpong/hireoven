import { NextResponse } from "next/server"
import type {
  SignalApiAuthContext,
  SignalApiQuotaState,
  SignalApiRateLimitState,
} from "./types"

type JsonInit = {
  status?: number
  headers?: HeadersInit
}

function baseHeaders(
  rateLimit?: SignalApiRateLimitState,
  quota?: SignalApiQuotaState
): Headers {
  const headers = new Headers()

  if (rateLimit) {
    headers.set("X-RateLimit-Limit", String(rateLimit.limit))
    headers.set("X-RateLimit-Remaining", String(rateLimit.remaining))
    headers.set("X-RateLimit-Reset", String(rateLimit.reset))
    if (!rateLimit.allowed) {
      headers.set("Retry-After", String(rateLimit.windowSeconds))
    }
  }

  if (quota) {
    headers.set("X-Quota-Plan", quota.planName)
    headers.set("X-Quota-Enforced", quota.enforce ? "1" : "0")
    headers.set("X-Quota-Daily-Limit", quota.dailyLimit == null ? "-1" : String(quota.dailyLimit))
    headers.set(
      "X-Quota-Daily-Remaining",
      quota.dailyRemaining == null ? "-1" : String(quota.dailyRemaining)
    )
    headers.set("X-Quota-Daily-Reset", String(quota.dailyReset))
    headers.set(
      "X-Quota-Monthly-Limit",
      quota.monthlyLimit == null ? "-1" : String(quota.monthlyLimit)
    )
    headers.set(
      "X-Quota-Monthly-Remaining",
      quota.monthlyRemaining == null ? "-1" : String(quota.monthlyRemaining)
    )
    headers.set("X-Quota-Monthly-Reset", String(quota.monthlyReset))
  }

  return headers
}

export function signalApiJson<T>(
  ctx: SignalApiAuthContext,
  body: T,
  init: JsonInit = {}
) {
  const headers = baseHeaders(ctx.rateLimit, ctx.quota)
  headers.set("X-Request-Id", ctx.requestId)

  const extra = new Headers(init.headers)
  extra.forEach((value, key) => headers.set(key, value))

  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers,
  })
}

export function signalApiError(
  status: number,
  error: string,
  code: string,
  requestId: string,
  rateLimit?: SignalApiRateLimitState,
  extra?: Record<string, unknown>,
  quota?: SignalApiQuotaState
) {
  const headers = baseHeaders(rateLimit, quota)
  headers.set("X-Request-Id", requestId)

  return NextResponse.json(
    {
      error,
      code,
      status,
      requestId,
      ...(extra ?? {}),
    },
    { status, headers }
  )
}

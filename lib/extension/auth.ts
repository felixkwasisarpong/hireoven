/**
 * Shared helpers for extension API routes.
 *
 * Auth strategy:
 *   The Chrome extension reads the `ho_session` cookie from hireoven.com and
 *   sends it as `Authorization: Bearer <jwt>` on every request. We verify the
 *   JWT using the same secret as the main session system.
 */

import { NextResponse } from "next/server"
import { verifySessionJwt } from "@/lib/auth/jwt"
import type { AppSessionClaims } from "@/lib/auth/jwt"

type JsonInit = ResponseInit & { headers?: HeadersInit }

// ── Origin helpers ─────────────────────────────────────────────────────────────

/** Return true if the origin looks like a chrome-extension:// URL. */
export function isChromeExtensionOrigin(origin: string | null): boolean {
  return typeof origin === "string" && origin.startsWith("chrome-extension://")
}

/**
 * Build CORS headers for a chrome-extension:// request.
 * We reflect the exact extension origin rather than using "*" so that
 * cookies / credentials headers are allowed by the browser.
 */
export function extensionCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = isChromeExtensionOrigin(origin) ? origin! : "null"
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization, X-Hireoven-Extension",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  }
}

export function extensionJson<T>(request: Request, body: T, init: JsonInit = {}): NextResponse<T> {
  const origin = request.headers.get("origin")
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...extensionCorsHeaders(origin),
      ...Object.fromEntries(new Headers(init.headers ?? {}).entries()),
    },
  })
}

export function extensionError(
  request: Request,
  status: number,
  message: string,
  init: JsonInit = {}
): NextResponse {
  return extensionJson(
    request,
    {
      ok: false,
      status,
      message,
      error: message,
    },
    { ...init, status }
  )
}

export async function readExtensionJsonBody<T extends object>(
  request: Request
): Promise<[T, null] | [null, NextResponse]> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("application/json")) {
    return [null, extensionError(request, 415, "Content-Type must be application/json")]
  }

  try {
    return [(await request.json()) as T, null]
  } catch {
    return [null, extensionError(request, 400, "Request body must be valid JSON")]
  }
}

/** Respond to a CORS preflight OPTIONS request. */
export function handleExtensionPreflight(request: Request): NextResponse {
  const origin = request.headers.get("origin")
  return new NextResponse(null, {
    status: 204,
    headers: extensionCorsHeaders(origin),
  })
}

// ── Auth ───────────────────────────────────────────────────────────────────────

/** Extract and verify the Bearer JWT sent by the extension. */
export async function getExtensionUser(
  request: Request
): Promise<AppSessionClaims | null> {
  const authHeader = request.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) return null
  return verifySessionJwt(token)
}

/**
 * Convenience: auth-guard an extension route.
 * Returns [user, null] on success or [null, errorResponse] on failure.
 */
export async function requireExtensionAuth(
  request: Request
): Promise<[AppSessionClaims, null] | [null, NextResponse]> {
  const origin = request.headers.get("origin")
  const user = await getExtensionUser(request)
  if (!user) {
    return [
      null,
      extensionError(request, 401, "Unauthorized", { headers: extensionCorsHeaders(origin) }),
    ]
  }
  return [user, null]
}

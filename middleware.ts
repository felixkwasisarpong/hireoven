import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants"
import { verifySessionJwt } from "@/lib/auth/jwt"

const PROTECTED_PREFIXES = ["/dashboard", "/admin"]

const PROTECTED_API_PREFIXES = [
  "/api/resume",
  "/api/cover-letter",
  "/api/autofill",
  "/api/match",
  "/api/alerts",
  "/api/watchlist",
  "/api/applications",
  "/api/subscription",
  "/api/billing",
]

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isProtectedApi(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

type SessionSummary = {
  authenticated: boolean
  isAdmin: boolean
  suspended: boolean
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === "/api/auth/session-summary" || pathname.startsWith("/api/auth/session-summary/")) {
    return NextResponse.next({ request: { headers: request.headers } })
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null
  const sessionUser = token ? await verifySessionJwt(token) : null
  const user = sessionUser ? { id: sessionUser.sub } : null

  async function fetchSessionSummary(): Promise<SessionSummary | null> {
    if (!user) return null
    const cookie = request.headers.get("cookie") ?? ""
    const res = await fetch(new URL("/api/auth/session-summary", request.nextUrl.origin), {
      headers: { cookie },
      cache: "no-store",
    })
    if (!res.ok) return null
    return (await res.json()) as SessionSummary
  }

  if (isProtected(pathname) && !user) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("next", pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (isProtectedApi(pathname) && !user) {
    return NextResponse.json(
      { error: "Authentication required", code: "UNAUTHENTICATED" },
      { status: 401 }
    )
  }

  if (user && (isProtected(pathname) || isProtectedApi(pathname))) {
    const summary = await fetchSessionSummary()
    if (summary?.suspended) {
      if (isProtectedApi(pathname)) {
        return NextResponse.json(
          { error: "Account suspended", code: "SUSPENDED" },
          { status: 403 }
        )
      }
      const loginUrl = new URL("/login", request.url)
      loginUrl.searchParams.set("reason", "suspended")
      return NextResponse.redirect(loginUrl)
    }
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const summary = await fetchSessionSummary()
    const destination = summary?.isAdmin ? "/admin" : "/dashboard"
    return NextResponse.redirect(new URL(destination, request.url))
  }

  return NextResponse.next({ request: { headers: request.headers } })
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}

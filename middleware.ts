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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null
  const session = token ? await verifySessionJwt(token) : null
  const user = session ? { id: session.sub } : null
  let flagsPromise: Promise<{ isAdmin: boolean; suspended: boolean }> | null = null

  async function getSessionFlags() {
    if (flagsPromise) return flagsPromise

    flagsPromise = (async () => {
      if (typeof session?.isAdmin === "boolean" && typeof session?.suspended === "boolean") {
        return {
          isAdmin: session.isAdmin,
          suspended: session.suspended,
        }
      }

      if (!user) {
        return { isAdmin: false, suspended: false }
      }

      // Backward-compat fallback for older session cookies that don't yet carry flags.
      const cookie = request.headers.get("cookie") ?? ""
      const res = await fetch(new URL("/api/auth/session-summary", request.nextUrl.origin), {
        headers: { cookie },
        cache: "no-store",
      })
      if (!res.ok) return { isAdmin: false, suspended: false }
      const body = (await res.json().catch(() => null)) as
        | { isAdmin?: boolean; suspended?: boolean }
        | null
      return {
        isAdmin: Boolean(body?.isAdmin),
        suspended: Boolean(body?.suspended),
      }
    })()

    return flagsPromise
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

  if (user && isProtected(pathname)) {
    const flags = await getSessionFlags()
    if (!flags.suspended) return NextResponse.next({ request: { headers: request.headers } })
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("reason", "suspended")
    return NextResponse.redirect(loginUrl)
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const flags = await getSessionFlags()
    const destination = flags.isAdmin ? "/admin" : "/dashboard"
    return NextResponse.redirect(new URL(destination, request.url))
  }

  return NextResponse.next({ request: { headers: request.headers } })
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/login",
    "/signup",
    "/api/resume/:path*",
    "/api/cover-letter/:path*",
    "/api/autofill/:path*",
    "/api/match/:path*",
    "/api/alerts/:path*",
    "/api/watchlist/:path*",
    "/api/applications/:path*",
    "/api/subscription/:path*",
    "/api/billing/:path*",
  ],
}

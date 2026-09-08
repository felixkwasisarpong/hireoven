import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE_NAME, SESSION_FLAGS_COOKIE_NAME, SESSION_FLAGS_TTL_SECONDS } from "@/lib/auth/constants"
import {
  verifySessionJwt,
  signSessionFlagsJwt,
  verifySessionFlagsJwt,
  type SessionFlags,
} from "@/lib/auth/jwt"
import {
  buildSessionFlagsSetCookie,
  clearSessionCookieHeader,
  clearSessionFlagsCookieHeader,
} from "@/lib/auth/session-cookie"

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

/**
 * Cron-authenticated routes under `/api/alerts/*` that do their own
 * Bearer-token auth via requireCronAuth(). The middleware must skip the
 * session check for these or the cron call gets 401 before the route's
 * own auth can run.
 */
const CRON_ALERTS_PATHS = [
  "/api/alerts/digest",
  "/api/alerts/weekly",
  "/api/alerts/recent-jobs",
]

const SCHEDULER_API_PREFIXES = [
  "/api/cron",
  "/api/crawl",
]

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isProtectedApi(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isCronAlertsPath(pathname: string): boolean {
  return CRON_ALERTS_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )
}

function isSchedulerApiPath(pathname: string): boolean {
  return (
    SCHEDULER_API_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ) || isCronAlertsPath(pathname)
  )
}

function isWebRuntime(): boolean {
  return (process.env.HIREOVEN_RUNTIME_ROLE ?? "").toLowerCase() === "web"
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isWebRuntime() && isSchedulerApiPath(pathname)) {
    return NextResponse.json(
      {
        error: "scheduler_not_available_on_web_runtime",
        message: "Scheduled jobs run on the private app-worker, not the public web app.",
      },
      { status: 409 },
    )
  }

  // Embeddable widget routes (Spec 07) are public, framed cross-origin, and must
  // not carry app chrome (providers, service worker) or read session cookies. Mark
  // them so the root layout renders a bare document, and pass through with no auth.
  if (pathname.startsWith("/embed/v1")) {
    const headers = new Headers(request.headers)
    headers.set("x-hireoven-embed", "1")
    return NextResponse.next({ request: { headers } })
  }

  // We do not use Server Actions. Malformed forwarded action requests without
  // Origin can currently trip a Next 14 runtime error while trying to compute a
  // digest. Reject them before they reach the app renderer.
  if (request.headers.has("next-action") && !request.headers.get("origin")) {
    return new NextResponse("Bad Request", { status: 400 })
  }

  // Cron-authenticated alerts routes manage their own Bearer auth — pass through.
  if (isCronAlertsPath(pathname)) {
    return NextResponse.next({ request: { headers: request.headers } })
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null
  const session = token ? await verifySessionJwt(token) : null
  const user = session ? { id: session.sub } : null
  let flagsPromise: Promise<SessionFlags> | null = null
  let refreshedFlagsToken: string | null = null

  /**
   * Resolve the account flags this request is gated on.
   *
   * Deliberately does NOT trust `suspended` off the session JWT: that claim is
   * signed at login and good for 14 days, so an account suspended afterwards
   * would keep its old `suspended: false` for the rest of that fortnight — the
   * suspension would not take effect until the user chose to sign in again.
   * Postgres is the source of truth; a signed, one-minute cookie keeps that to
   * one lookup per user per minute.
   */
  async function getSessionFlags() {
    if (flagsPromise) return flagsPromise

    flagsPromise = (async () => {
      if (!session) return { isAdmin: false, suspended: false }

      const cached = request.cookies.get(SESSION_FLAGS_COOKIE_NAME)?.value
      if (cached) {
        const flags = await verifySessionFlagsJwt(cached, session.sub)
        if (flags) return flags
      }

      const cookie = request.headers.get("cookie") ?? ""
      const res = await fetch(new URL("/api/auth/session-summary", request.nextUrl.origin), {
        headers: { cookie },
        cache: "no-store",
      }).catch(() => null)

      if (!res?.ok) {
        // Source of truth unreachable. Fall back to the session's own claims
        // rather than signing every user out because one lookup failed.
        return {
          isAdmin: session.isAdmin ?? false,
          suspended: session.suspended ?? false,
        }
      }

      const body = (await res.json().catch(() => null)) as
        | { isAdmin?: boolean; suspended?: boolean }
        | null
      const flags = {
        isAdmin: Boolean(body?.isAdmin),
        suspended: Boolean(body?.suspended),
      }
      refreshedFlagsToken = await signSessionFlagsJwt(session.sub, flags)
      return flags
    })()

    return flagsPromise
  }

  /** Carry a freshly-read set of flags back to the browser as the cache cookie. */
  function withFlagsCookie(res: NextResponse) {
    if (refreshedFlagsToken) {
      res.headers.append(
        "Set-Cookie",
        buildSessionFlagsSetCookie(refreshedFlagsToken, SESSION_FLAGS_TTL_SECONDS),
      )
    }
    return res
  }

  /** End the session outright — a suspended user is signed out, not just blocked. */
  function signOut(res: NextResponse) {
    res.headers.append("Set-Cookie", clearSessionCookieHeader())
    res.headers.append("Set-Cookie", clearSessionFlagsCookieHeader())
    return res
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
    if (flags.suspended) {
      const loginUrl = new URL("/login", request.url)
      loginUrl.searchParams.set("error", "suspended")
      return signOut(NextResponse.redirect(loginUrl))
    }
    return withFlagsCookie(NextResponse.next({ request: { headers: request.headers } }))
  }

  // The API surface is gated too. Blocking only the dashboard would leave a
  // suspended user's extension and background calls working normally.
  if (user && isProtectedApi(pathname)) {
    const flags = await getSessionFlags()
    if (flags.suspended) {
      return signOut(
        NextResponse.json(
          { error: "Account suspended", code: "ACCOUNT_SUSPENDED" },
          { status: 403 },
        ),
      )
    }
    return withFlagsCookie(NextResponse.next({ request: { headers: request.headers } }))
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const flags = await getSessionFlags()
    if (flags.suspended) {
      // Do not bounce a suspended user to /dashboard: the gate above would send
      // them straight back here, and the two would ping-pong forever. Drop the
      // dead session and let them see the sign-in page.
      return signOut(NextResponse.next({ request: { headers: request.headers } }))
    }
    const destination = flags.isAdmin ? "/admin" : "/dashboard"
    return withFlagsCookie(NextResponse.redirect(new URL(destination, request.url)))
  }

  return NextResponse.next({ request: { headers: request.headers } })
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/embed/v1/:path*",
    "/login",
    "/signup",
    "/api/cron/:path*",
    "/api/crawl/:path*",
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

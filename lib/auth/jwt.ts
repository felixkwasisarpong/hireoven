import { SignJWT, jwtVerify } from "jose"
import { SESSION_COOKIE_NAME, SESSION_FLAGS_TTL_SECONDS } from "@/lib/auth/constants"

const ALG = "HS256"

/** Token kinds, so one flavour of token cannot be presented as another. */
const SESSION_TOKEN_TYPE = "session"
const FLAGS_TOKEN_TYPE = "flags"

function getSecretKey(): Uint8Array {
  const raw = process.env.AUTH_SESSION_SECRET?.trim()
  if (!raw || raw.length < 32) {
    throw new Error("AUTH_SESSION_SECRET must be set and at least 32 characters")
  }
  return new TextEncoder().encode(raw)
}

export type AppSessionClaims = {
  sub: string
  email: string | null
  isAdmin?: boolean
  suspended?: boolean
}

export async function signSessionJwt(
  claims: AppSessionClaims,
  maxAgeSeconds = 60 * 60 * 24 * 14
): Promise<string> {
  return new SignJWT({
    email: claims.email,
    is_admin: claims.isAdmin ?? false,
    suspended: claims.suspended ?? false,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSecretKey())
}

export async function verifySessionJwt(token: string): Promise<AppSessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: [ALG] })
    // Untyped tokens are the pre-existing session cookies; only a token that
    // announces itself as something else is refused.
    if (typeof payload.typ === "string" && payload.typ !== SESSION_TOKEN_TYPE) return null
    const sub = payload.sub
    if (!sub || typeof sub !== "string") return null
    const email = typeof payload.email === "string" ? payload.email : null
    const isAdmin = typeof payload.is_admin === "boolean" ? payload.is_admin : undefined
    const suspended = typeof payload.suspended === "boolean" ? payload.suspended : undefined
    return { sub, email, isAdmin, suspended }
  } catch {
    return null
  }
}

/** Returns the number of seconds remaining on the session token, or 0 if expired/invalid. */
export async function getSessionTokenSecondsLeft(token: string): Promise<number> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: [ALG] })
    const exp = typeof payload.exp === "number" ? payload.exp : 0
    return Math.max(0, exp - Math.floor(Date.now() / 1000))
  } catch {
    return 0
  }
}

export type SessionFlags = {
  isAdmin: boolean
  suspended: boolean
}

/**
 * Sign the cached account flags. Signed rather than stored as plain JSON so a
 * user cannot hand themselves `suspended: false`, and bound to `sub` so the
 * cookie cannot be replayed against another account.
 */
export async function signSessionFlagsJwt(
  sub: string,
  flags: SessionFlags,
  maxAgeSeconds = SESSION_FLAGS_TTL_SECONDS
): Promise<string> {
  return new SignJWT({ typ: FLAGS_TOKEN_TYPE, is_admin: flags.isAdmin, suspended: flags.suspended })
    .setProtectedHeader({ alg: ALG })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSecretKey())
}

/** Returns the cached flags, or null if absent, expired, or for another user. */
export async function verifySessionFlagsJwt(
  token: string,
  expectedSub: string
): Promise<SessionFlags | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: [ALG] })
    // Session tokens carry `sub`, `is_admin` and `suspended` too, and last two
    // weeks. Without this check a user could paste their own session cookie in
    // as the flags cookie and pin `suspended: false` well past its one-minute
    // lifetime — the exact staleness this cache exists to bound.
    if (payload.typ !== FLAGS_TOKEN_TYPE) return null
    if (payload.sub !== expectedSub) return null
    if (typeof payload.is_admin !== "boolean" || typeof payload.suspended !== "boolean") {
      return null
    }
    return { isAdmin: payload.is_admin, suspended: payload.suspended }
  } catch {
    return null
  }
}

export type OAuthStateClaims = {
  next: string
}

export async function signOAuthStateJwt(claims: OAuthStateClaims, maxAgeSeconds = 600): Promise<string> {
  return new SignJWT({ next: claims.next })
    .setProtectedHeader({ alg: ALG })
    .setSubject("oauth")
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSecretKey())
}

export async function verifyOAuthStateJwt(token: string): Promise<OAuthStateClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: [ALG] })
    if (payload.sub !== "oauth") return null
    const next = typeof payload.next === "string" ? payload.next : "/dashboard"
    if (!next.startsWith("/") || next.startsWith("//")) return { next: "/dashboard" }
    return { next }
  } catch {
    return null
  }
}

export function readSessionTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(";").map((p) => p.trim())
  for (const part of parts) {
    if (part.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return decodeURIComponent(part.slice(SESSION_COOKIE_NAME.length + 1))
    }
  }
  return null
}

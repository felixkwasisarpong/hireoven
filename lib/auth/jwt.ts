import { SignJWT, jwtVerify } from "jose"
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants"

const ALG = "HS256"

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

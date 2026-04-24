import { SESSION_COOKIE_NAME } from "@/lib/auth/constants"

const isProd = process.env.NODE_ENV === "production"

function secureSuffix(): string {
  return isProd ? "; Secure" : ""
}

export function buildSessionSetCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureSuffix()}`
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureSuffix()}`
}

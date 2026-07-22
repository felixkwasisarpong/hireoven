import { NextResponse } from "next/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Public, unauthenticated pageview beacon. Fire-and-forget: always answers 204
// so a tracking failure never surfaces to the visitor. Privacy-light — stores
// an anonymous first-party id, the path, and the referrer host only.

const NO_CONTENT = new NextResponse(null, { status: 204 })

/** Reduce a referrer to its hostname; drop empty / unparseable referrers. */
function referrerHost(referrer: unknown): string | null {
  if (typeof referrer !== "string" || !referrer.trim()) return null
  try {
    return new URL(referrer).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  if (!hasPostgresEnv()) return NO_CONTENT

  let body: { path?: unknown; visitorId?: unknown; referrer?: unknown }
  try {
    body = await request.json()
  } catch {
    return NO_CONTENT
  }

  const path = typeof body.path === "string" ? body.path.slice(0, 512) : ""
  const visitorId = typeof body.visitorId === "string" ? body.visitorId.slice(0, 64) : ""
  if (!path || !visitorId) return NO_CONTENT

  const host = referrerHost(body.referrer)

  try {
    await getPostgresPool().query(
      `INSERT INTO page_views (visitor_id, path, referrer_host) VALUES ($1, $2, $3)`,
      [visitorId, path, host],
    )
  } catch {
    // Table missing / transient DB error — never break the beacon.
  }
  return NO_CONTENT
}

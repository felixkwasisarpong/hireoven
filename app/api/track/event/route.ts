import { NextResponse } from "next/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Public, unauthenticated funnel-event beacon for the /find ad landing page.
// Fire-and-forget: always answers 204 so a tracking failure never surfaces to
// the visitor. Mirrors /api/track/pageview. Writes to funnel_events (see
// scripts/migrations/add-funnel-events.sql) and no-ops gracefully if the table
// isn't there yet.

const NO_CONTENT = new NextResponse(null, { status: 204 })

// Allowlist so the public endpoint can't be used to write arbitrary event names.
const ALLOWED = new Set([
  "find_landing_view",
  "find_role_submitted",
  "find_matches_shown",
  "find_signup_clicked",
])

export async function POST(request: Request) {
  if (!hasPostgresEnv()) return NO_CONTENT

  let body: { name?: unknown; visitorId?: unknown; role?: unknown; path?: unknown }
  try {
    body = await request.json()
  } catch {
    return NO_CONTENT
  }

  const name = typeof body.name === "string" ? body.name.slice(0, 64) : ""
  if (!name || !ALLOWED.has(name)) return NO_CONTENT

  const visitorId = typeof body.visitorId === "string" ? body.visitorId.slice(0, 64) : null
  const role = typeof body.role === "string" ? body.role.slice(0, 80) : null
  const path = typeof body.path === "string" ? body.path.slice(0, 256) : null

  try {
    await getPostgresPool().query(
      `INSERT INTO funnel_events (visitor_id, name, role, path) VALUES ($1, $2, $3, $4)`,
      [visitorId, name, role, path],
    )
  } catch {
    // Table missing / transient DB error — never break the beacon.
  }
  return NO_CONTENT
}

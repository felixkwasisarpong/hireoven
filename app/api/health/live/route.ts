import { NextResponse } from "next/server"

/**
 * Liveness probe — "is this process serving HTTP?" and nothing more.
 *
 * Deliberately separate from /api/health, which is a *readiness/diagnostic*
 * endpoint: it runs three queries including COUNT(*) over ~121k companies and
 * returns 500 whenever Postgres is unreachable. That is the right behaviour for
 * a status page and the wrong behaviour for a container healthcheck, for two
 * reasons:
 *
 *   1. Cost. Coolify's configured interval is 5s, so pointing the probe at the
 *      deep check bills Postgres ~17k count queries a day, forever, on a box
 *      that also hosts that Postgres.
 *
 *   2. Blast radius. A healthcheck that fails on DB trouble makes the proxy pull
 *      a perfectly healthy app out of rotation, converting a slow database into
 *      a hard outage — and during a rolling update it would block the new
 *      container from ever going live.
 *
 * So this touches nothing: no database, no object storage, no filesystem. If the
 * Next.js server can route a request and return, the container is live.
 *
 * force-dynamic so the answer always comes from the running server rather than
 * a build-time cached response, which would report healthy even for a wedged
 * process.
 */

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  return NextResponse.json(
    { status: "ok", role: process.env.HIREOVEN_RUNTIME_ROLE ?? "web" },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  )
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } })
}

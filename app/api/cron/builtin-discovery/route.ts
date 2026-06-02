/**
 * GET /api/cron/builtin-discovery
 *
 * Built In company-name discovery. Unlike Glassdoor (robots-blocked), Built In
 * permits /companies in robots.txt and server-renders the grid, so this runs on
 * a plain fetch — no browser. Paginated, robots-checked, rate-limited; each
 * company is enqueued as a sentinel row for the resolver.
 *
 * Disable with BUILTIN_DISCOVERY_DISABLED=true.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { runBuiltinDiscoveryWorker } from "@/lib/harvester/discovery/builtin/worker"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const pool = getPostgresPool()
  const summary = await runBuiltinDiscoveryWorker({ pool })
  return NextResponse.json(summary, { status: summary.ok ? 200 : 503 })
}

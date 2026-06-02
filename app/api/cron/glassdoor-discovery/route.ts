/**
 * GET /api/cron/glassdoor-discovery
 *
 * Cron entry point for Glassdoor company-name-only discovery.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { runGlassdoorDiscoveryWorker } from "@/lib/harvester/discovery/glassdoor/worker"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const pool = getPostgresPool()
  const summary = await runGlassdoorDiscoveryWorker({ pool })
  return NextResponse.json(summary, { status: summary.ok ? 200 : 503 })
}

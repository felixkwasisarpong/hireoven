/**
 * GET /api/cron/remoteok-ingest
 *
 * Pulls the full RemoteOK feed (keyless) and upserts via the shared aggregator
 * pipeline. RemoteOK returns remote-only roles across all categories in one
 * call, so there are no query params to tune.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { searchRemoteOkJobs } from "@/lib/sources/remoteok"
import { ingestAggregatorJobs } from "@/lib/jobs/aggregator-ingest"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const { jobs } = await searchRemoteOkJobs({})
    const pool = getPostgresPool()
    const stats = await ingestAggregatorJobs(pool, "remoteok", jobs)
    return NextResponse.json({ ok: true, ...stats })
  } catch (err) {
    console.error("[remoteok-ingest] failed:", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

/**
 * GET /api/cron/arbeitnow-ingest
 *
 * Pulls jobs from the Arbeitnow job-board API (keyless, EU-focused) and upserts
 * via the shared aggregator pipeline.
 *
 * Env:
 *   ARBEITNOW_MAX_PAGES — pages to pull (default: 5)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { searchArbeitnowAllPages } from "@/lib/sources/arbeitnow"
import { ingestAggregatorJobs } from "@/lib/jobs/aggregator-ingest"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const url = new URL(request.url)
  const maxPages = Number(url.searchParams.get("pages") ?? process.env.ARBEITNOW_MAX_PAGES ?? "5")

  try {
    const jobs = await searchArbeitnowAllPages({}, maxPages)
    const pool = getPostgresPool()
    const stats = await ingestAggregatorJobs(pool, "arbeitnow", jobs)
    return NextResponse.json({ ok: true, ...stats })
  } catch (err) {
    console.error("[arbeitnow-ingest] failed:", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

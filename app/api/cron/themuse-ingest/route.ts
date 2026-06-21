/**
 * GET /api/cron/themuse-ingest
 *
 * Pulls jobs from The Muse public API (keyless; optional THE_MUSE_API_KEY just
 * raises the rate limit) and upserts them via the shared aggregator pipeline.
 *
 * Env:
 *   THE_MUSE_API_KEY        — optional (higher rate limit)
 *   THEMUSE_MAX_PAGES       — pages to pull (default: 5)
 *   THEMUSE_CATEGORY        — optional Muse category filter
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { searchTheMuseAllPages } from "@/lib/sources/themuse"
import { ingestAggregatorJobs } from "@/lib/jobs/aggregator-ingest"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const url = new URL(request.url)
  const maxPages = Number(url.searchParams.get("pages") ?? process.env.THEMUSE_MAX_PAGES ?? "5")
  const category = url.searchParams.get("category") ?? process.env.THEMUSE_CATEGORY ?? undefined

  try {
    const jobs = await searchTheMuseAllPages({ category }, maxPages)
    const pool = getPostgresPool()
    const stats = await ingestAggregatorJobs(pool, "themuse", jobs)
    return NextResponse.json({ ok: true, ...stats })
  } catch (err) {
    console.error("[themuse-ingest] failed:", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

/**
 * GET /api/cron/jooble-ingest
 *
 * Pulls jobs from Jooble (POST API, per-key) across a set of keyword queries
 * and upserts via the shared aggregator pipeline. Jooble returns short snippets
 * rather than full descriptions, so thin results are hidden as low-quality.
 *
 * Env:
 *   JOOBLE_API_KEY        — required (https://jooble.org/api/about)
 *   JOOBLE_SEARCH_QUERIES — comma-separated keywords (default list below)
 *   JOOBLE_LOCATION       — optional location filter
 *   JOOBLE_MAX_QUERIES    — max queries per run (default: 8)
 *   JOOBLE_PAGES_PER_QUERY — pages to walk per query (default: 3)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { searchJoobleAllPages, type JoobleJob } from "@/lib/sources/jooble"
import { ingestAggregatorJobs } from "@/lib/jobs/aggregator-ingest"
import { counter } from "@/lib/observability/metrics"

export const runtime = "nodejs"
export const maxDuration = 300

const DEFAULT_QUERIES = [
  "software engineer",
  "data engineer",
  "product manager",
  "devops engineer",
  "data scientist",
  "frontend developer",
  "backend developer",
  "machine learning engineer",
]

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!process.env.JOOBLE_API_KEY?.trim()) {
    return NextResponse.json({ ok: false, message: "JOOBLE_API_KEY not set" })
  }

  const url = new URL(request.url)
  const queryOverride = url.searchParams.get("q")
  const location = url.searchParams.get("location") ?? process.env.JOOBLE_LOCATION ?? undefined
  const maxQueries = Number(url.searchParams.get("maxQueries") ?? process.env.JOOBLE_MAX_QUERIES ?? "8")
  const maxPages = Math.max(1, Number(url.searchParams.get("maxPages") ?? process.env.JOOBLE_PAGES_PER_QUERY ?? "3"))
  const queries = queryOverride
    ? [queryOverride]
    : (process.env.JOOBLE_SEARCH_QUERIES ?? "")
        .split(",")
        .map((q) => q.trim())
        .filter(Boolean)
        .concat(DEFAULT_QUERIES)
        .filter((q, i, arr) => arr.indexOf(q) === i)
        .slice(0, maxQueries)

  const all: JoobleJob[] = []
  let queryErrors = 0
  let pagesFetched = 0
  for (const keywords of queries) {
    try {
      const { jobs, pagesFetched: pages } = await searchJoobleAllPages({ keywords, location, maxPages })
      all.push(...jobs)
      pagesFetched += pages
    } catch (err) {
      console.error(`[jooble-ingest] query "${keywords}" failed:`, err)
      queryErrors++
      counter("source.fetch.error", { source: "jooble" })
    }
  }

  try {
    const pool = getPostgresPool()
    const stats = await ingestAggregatorJobs(pool, "jooble", all, { minDescriptionChars: 300 })
    return NextResponse.json({ ok: true, queryErrors, pagesFetched, ...stats })
  } catch (err) {
    console.error("[jooble-ingest] ingest failed:", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

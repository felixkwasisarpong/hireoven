/**
 * GET /api/cron/careerjet-ingest
 *
 * Pulls US jobs from CareerJet's free affiliate API.
 * Register at https://www.careerjet.com/partners/api/ to get an affiliate ID.
 *
 * Persistence is delegated to the shared aggregator pipeline
 * (lib/jobs/aggregator-ingest). The query-loop fetch stays here, and the
 * legacy external_id scheme (`careerjet:<base64(url)>`) is preserved so this
 * migration does not re-ingest existing rows.
 *
 * Env:
 *   CAREERJET_AFFILIATE_ID   — required (free, register at careerjet.com)
 *   CAREERJET_SEARCH_QUERIES — comma-separated keywords (default list below)
 *   CAREERJET_MAX_JOBS       — max jobs per query page (default: 99)
 *   CAREERJET_MAX_PAGES      — pages per query (default: 3)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { ingestAggregatorJobs, type AggregatorJob } from "@/lib/jobs/aggregator-ingest"

export const runtime = "nodejs"
export const maxDuration = 300

const DEFAULT_QUERIES = [
  "software engineer",
  "data engineer",
  "product manager",
  "devops engineer",
  "machine learning engineer",
  "registered nurse",
  "financial analyst",
  "operations manager",
  "sales manager",
  "marketing manager",
  "project manager",
  "accountant",
  "human resources manager",
  "business analyst",
  "customer success manager",
  "supply chain manager",
  "security engineer",
  "cloud engineer",
  "data scientist",
  "solutions architect",
]

type CareerJetJob = {
  date: string
  title: string
  locations: string
  company: string
  salary: string
  description: string
  url: string
  site: string
}

type CareerJetResponse = {
  type: string
  hits: number
  jobs?: CareerJetJob[]
  error?: string
}

// Legacy external_id scheme — keep identical so migrated runs match existing rows.
function careerjetExternalKey(url: string): string {
  return Buffer.from(url).toString("base64").slice(0, 64)
}

async function fetchCareerJetPage(
  keywords: string,
  affiliateId: string,
  page: number,
  pageSize: number
): Promise<CareerJetJob[]> {
  const params = new URLSearchParams({
    keywords,
    location: "USA",
    locale_code: "en_US",
    affid: affiliateId,
    format: "json",
    pagesize: String(pageSize),
    page: String(page),
    sort: "date",
  })
  const url = `https://public.api.careerjet.com/search?${params}`
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Hireoven/1.0" },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as CareerJetResponse
    return data.jobs ?? []
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const affiliateId = process.env.CAREERJET_AFFILIATE_ID
  if (!affiliateId) {
    return NextResponse.json({ skipped: true, reason: "CAREERJET_AFFILIATE_ID not configured" })
  }

  const sp = request.nextUrl.searchParams
  const maxJobsPerQuery = Number(sp.get("maxJobs") ?? process.env.CAREERJET_MAX_JOBS ?? "99")
  const maxPages = Number(sp.get("maxPages") ?? process.env.CAREERJET_MAX_PAGES ?? "3")
  const queries = sp.get("q")
    ? [sp.get("q")!]
    : (process.env.CAREERJET_SEARCH_QUERIES ?? "")
        .split(",")
        .map((q) => q.trim())
        .filter(Boolean)
        .concat(DEFAULT_QUERIES)
        .filter((q, i, arr) => arr.indexOf(q) === i)

  // Dedupe across queries by apply URL (CareerJet has no native id).
  const byUrl = new Map<string, CareerJetJob>()
  let queriesFetched = 0
  let fetchErrors = 0
  for (const q of queries) {
    try {
      for (let page = 1; page <= maxPages; page++) {
        const jobs = await fetchCareerJetPage(q, affiliateId, page, maxJobsPerQuery)
        if (jobs.length === 0) break
        for (const job of jobs) {
          if (!job.url) continue
          if (!byUrl.has(job.url)) byUrl.set(job.url, job)
        }
        if (jobs.length < maxJobsPerQuery) break
      }
      queriesFetched++
    } catch (err) {
      console.error(`[careerjet-ingest] query "${q}" failed:`, err)
      fetchErrors++
    }
  }

  const collected: AggregatorJob[] = [...byUrl.entries()].map(([url, job]) => ({
    id: careerjetExternalKey(url),
    title: job.title,
    company: job.company,
    location: job.locations || "",
    description: job.description,
    applyUrl: job.url,
    postedAt: job.date,
    isRemote: /remote/i.test(job.locations) || /remote/i.test(job.title),
    salaryCurrency: "USD",
    publisher: job.site,
  }))

  try {
    const pool = getPostgresPool()
    const stats = await ingestAggregatorJobs(pool, "careerjet", collected)
    return NextResponse.json({ ok: true, queriesFetched, fetchErrors, ...stats })
  } catch (err) {
    console.error("[careerjet-ingest] ingest failed:", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

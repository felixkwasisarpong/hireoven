/**
 * GET /api/cron/careerjet-ingest
 *
 * Pulls US and Canada jobs from CareerJet's free affiliate API.
 * Register at https://www.careerjet.com/partners/api/ to get an affiliate ID.
 *
 * Persistence is delegated to the shared aggregator pipeline
 * (lib/jobs/aggregator-ingest). The query-loop fetch stays here, and the
 * legacy external_id scheme (`careerjet:<base64(url)>`) is preserved so this
 * migration does not re-ingest existing rows.
 *
 * Env:
 *   CAREERJET_AFFILIATE_ID   — required (free, register at careerjet.com)
 *   CAREERJET_AFFID          — legacy alias, also accepted
 *   CAREERJET_REFERER        — optional; Referer sent to the v4 API (must match the
 *                              affiliate's registered domain). Defaults to
 *                              NEXT_PUBLIC_APP_URL, else https://hireoven.com
 *   CAREERJET_USER_IP        — optional fallback user_ip for API attribution
 *   CAREERJET_SEARCH_QUERIES — comma-separated keywords (default list below)
 *   CAREERJET_COUNTRIES      — comma-separated markets: us,ca (default: us,ca)
 *   CAREERJET_MAX_JOBS       — max jobs per query (default: 99, API max per page)
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
  message?: string
  pages?: number
  jobs?: CareerJetJob[]
  error?: string
}

type CareerJetCountry = {
  key: "us" | "ca"
  location: string
  localeCode: string
}

const CAREERJET_COUNTRIES: Record<CareerJetCountry["key"], CareerJetCountry> = {
  us: { key: "us", location: "USA", localeCode: "en_US" },
  ca: { key: "ca", location: "Canada", localeCode: "en_CA" },
}

function parseCareerJetCountries(raw: string | null | undefined): CareerJetCountry[] {
  const requested = (raw ?? "us,ca")
    .split(",")
    .map((country) => country.trim().toLowerCase())
    .filter((country): country is CareerJetCountry["key"] => country === "us" || country === "ca")
  const unique = [...new Set(requested)]
  const keys: CareerJetCountry["key"][] = unique.length ? unique : ["us", "ca"]
  return keys.map((country) => CAREERJET_COUNTRIES[country])
}

type CareerJetAggregatorJob = AggregatorJob & {
  sourceCountry: CareerJetCountry["key"]
  salaryRaw: string
}

// Legacy external_id scheme — keep identical so migrated runs match existing rows.
function careerjetExternalKey(url: string): string {
  return Buffer.from(url).toString("base64").slice(0, 64)
}

async function fetchCareerJetPage(
  keywords: string,
  affiliateId: string,
  country: CareerJetCountry,
  page: number,
  pageSize: number,
  userIp: string,
  userAgent: string,
  referer: string
): Promise<CareerJetJob[]> {
  const params = new URLSearchParams({
    keywords,
    location: country.location,
    locale_code: country.localeCode,
    page_size: String(pageSize),
    page: String(page),
    sort: "date",
    user_ip: userIp,
    user_agent: userAgent,
  })
  const url = `https://search.api.careerjet.net/v4/query?${params}`
  const credentials = Buffer.from(`${affiliateId}:`).toString("base64")
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
      "User-Agent": userAgent,
      // CareerJet v4 rejects requests without a Referer (the domain registered
      // with the affiliate account) — 403 "Undeclared referrer".
      Referer: referer,
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`CareerJet API ${res.status} for "${keywords}" (${country.key}): ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as CareerJetResponse
  if (data.error || data.type?.toLowerCase() === "error") {
    throw new Error(`CareerJet API error for "${keywords}" (${country.key}): ${data.error ?? data.type}`)
  }
  if (data.type === "LOCATIONS") {
    throw new Error(`CareerJet location mode for "${keywords}" (${country.key}): ${data.message ?? "ambiguous location"}`)
  }
  return data.jobs ?? []
}

function requestIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return forwarded || process.env.CAREERJET_USER_IP || "127.0.0.1"
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const affiliateId = process.env.CAREERJET_AFFILIATE_ID ?? process.env.CAREERJET_AFFID
  if (!affiliateId) {
    return NextResponse.json({
      skipped: true,
      reason: "CAREERJET_AFFILIATE_ID (or CAREERJET_AFFID) not configured",
    })
  }

  const sp = request.nextUrl.searchParams
  const maxJobsPerQuery = Number(sp.get("maxJobs") ?? process.env.CAREERJET_MAX_JOBS ?? "99")
  const maxPages = Number(sp.get("maxPages") ?? process.env.CAREERJET_MAX_PAGES ?? "3")
  const userIp = requestIp(request)
  const userAgent = request.headers.get("user-agent") || "Hireoven/1.0"
  // CareerJet v4 requires a Referer matching the affiliate's registered domain.
  const referer =
    process.env.CAREERJET_REFERER ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://hireoven.com"
  const countryOverride = sp.get("country")
  const countries = countryOverride
    ? parseCareerJetCountries(countryOverride)
    : parseCareerJetCountries(process.env.CAREERJET_COUNTRIES)
  const queries = sp.get("q")
    ? [sp.get("q")!]
    : (process.env.CAREERJET_SEARCH_QUERIES ?? "")
        .split(",")
        .map((q) => q.trim())
        .filter(Boolean)
        .concat(DEFAULT_QUERIES)
        .filter((q, i, arr) => arr.indexOf(q) === i)

  // Dedupe across queries/countries by apply URL (CareerJet has no native id).
  const byUrl = new Map<string, { job: CareerJetJob; country: CareerJetCountry }>()
  let queriesFetched = 0
  let fetchErrors = 0
  for (const q of queries) {
    for (const country of countries) {
      try {
        for (let page = 1; page <= maxPages; page++) {
          const jobs = await fetchCareerJetPage(q, affiliateId, country, page, maxJobsPerQuery, userIp, userAgent, referer)
          if (jobs.length === 0) break
          for (const job of jobs) {
            if (!job.url) continue
            if (!byUrl.has(job.url)) byUrl.set(job.url, { job, country })
          }
          if (jobs.length < maxJobsPerQuery) break
        }
        queriesFetched++
      } catch (err) {
        console.error(`[careerjet-ingest] query "${q}" (${country.key}) failed:`, err)
        fetchErrors++
      }
    }
  }

  if (byUrl.size === 0 && fetchErrors > 0) {
    return NextResponse.json({
      ok: false,
      error: "CareerJet upstream fetch failed before any jobs were collected",
      countries: countries.map((country) => country.key),
      queriesFetched,
      fetchErrors,
    }, { status: 502 })
  }

  const collected: CareerJetAggregatorJob[] = [...byUrl.entries()].map(([url, entry]) => ({
    id: careerjetExternalKey(url),
    title: entry.job.title,
    company: entry.job.company,
    location: entry.job.locations || "",
    description: entry.job.description,
    applyUrl: entry.job.url,
    postedAt: entry.job.date,
    isRemote: /remote/i.test(entry.job.locations) || /remote/i.test(entry.job.title),
    salaryCurrency: entry.country.key === "ca" ? "CAD" : "USD",
    publisher: entry.job.site,
    sourceCountry: entry.country.key,
    salaryRaw: entry.job.salary,
  }))

  try {
    const pool = getPostgresPool()
    const stats = await ingestAggregatorJobs(pool, "careerjet", collected, {
      rawExtra: (job) => {
        const careerjetJob = job as CareerJetAggregatorJob
        return { country: careerjetJob.sourceCountry, salary_raw: careerjetJob.salaryRaw }
      },
    })
    return NextResponse.json({
      ok: true,
      countries: countries.map((country) => country.key),
      queriesFetched,
      fetchErrors,
      ...stats,
    })
  } catch (err) {
    console.error("[careerjet-ingest] ingest failed:", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

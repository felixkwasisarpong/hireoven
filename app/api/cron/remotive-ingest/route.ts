/**
 * GET /api/cron/remotive-ingest
 *
 * Pulls remote jobs from Remotive (https://remotive.io/api/remote-jobs).
 * Free, no API key required. Returns remote-only roles across all categories.
 *
 * Persistence is delegated to the shared aggregator pipeline
 * (lib/jobs/aggregator-ingest). The category-loop fetch and Remotive-specific
 * parsing (salary string, tags→skills) stay here; external_id continuity is
 * preserved (`remotive:<numeric id>`).
 *
 * Env:
 *   REMOTIVE_CATEGORIES — comma-separated categories (default list below)
 *   REMOTIVE_LIMIT      — jobs per category request (default: 100)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { ingestAggregatorJobs, type AggregatorJob } from "@/lib/jobs/aggregator-ingest"

export const runtime = "nodejs"
export const maxDuration = 300

const DEFAULT_CATEGORIES = [
  "software-dev",
  "devops-sysadmin",
  "product",
  "design",
  "data",
  "qa",
  "security",
  "sales",
  "marketing",
  "finance-legal",
  "hr",
  "customer-support",
  "writing",
  "all-others",
]

type RemotiveJob = {
  id: number
  url: string
  title: string
  company_name: string
  company_logo: string | null
  category: string
  tags: string[]
  job_type: string | null
  publication_date: string
  candidate_required_location: string
  salary: string
  description: string
}

async function fetchRemotiveJobs(category: string, limit: number): Promise<RemotiveJob[]> {
  const url = `https://remotive.io/api/remote-jobs?category=${encodeURIComponent(category)}&limit=${limit}`
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Hireoven/1.0" },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { jobs?: RemotiveJob[] }
    return data.jobs ?? []
  } catch {
    return []
  }
}

function parseSalary(salaryStr: string): { min?: number; max?: number } {
  if (!salaryStr) return {}
  const numbers = salaryStr.replace(/,/g, "").match(/\d+/g)?.map(Number) ?? []
  if (numbers.length === 0) return {}
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0] }
  return { min: Math.min(...numbers), max: Math.max(...numbers) }
}

function mapJobType(jobType: string | null): string | undefined {
  if (!jobType) return undefined
  const t = jobType.toLowerCase()
  if (t.includes("full")) return "fulltime"
  if (t.includes("part")) return "parttime"
  if (t.includes("contract")) return "contract"
  if (t.includes("intern")) return "internship"
  return undefined
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const limitPerCategory = Number(sp.get("limit") ?? process.env.REMOTIVE_LIMIT ?? "100")
  const categories = (sp.get("categories") ?? process.env.REMOTIVE_CATEGORIES ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .concat(DEFAULT_CATEGORIES)
    .filter((c, i, arr) => arr.indexOf(c) === i)

  const collected: AggregatorJob[] = []
  let categoriesFetched = 0
  let fetchErrors = 0
  for (const cat of categories) {
    try {
      const jobs = await fetchRemotiveJobs(cat, limitPerCategory)
      categoriesFetched++
      for (const job of jobs) {
        const { min, max } = parseSalary(job.salary)
        collected.push({
          id: String(job.id),
          title: job.title,
          company: job.company_name,
          companyLogo: job.company_logo ?? undefined,
          location: job.candidate_required_location || "Remote",
          description: job.description,
          applyUrl: job.url,
          postedAt: job.publication_date,
          isRemote: true,
          employmentType: mapJobType(job.job_type),
          salaryMin: min,
          salaryMax: max,
          salaryCurrency: "USD",
          skills: job.tags ?? [],
        })
      }
    } catch (err) {
      console.error(`[remotive-ingest] category "${cat}" failed:`, err)
      fetchErrors++
    }
  }

  try {
    const pool = getPostgresPool()
    const stats = await ingestAggregatorJobs(pool, "remotive", collected)
    return NextResponse.json({ ok: true, categoriesFetched, fetchErrors, ...stats })
  } catch (err) {
    console.error("[remotive-ingest] ingest failed:", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

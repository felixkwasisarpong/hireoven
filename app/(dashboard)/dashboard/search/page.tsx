import { headers } from "next/headers"
import type { Company, JobWithCompany } from "@/types"
import SearchPageClient from "./SearchPageClient"

export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

type SearchInitialData = {
  initialQuery: string
  initialJobs: JobWithCompany[]
  initialCompanies: Company[]
  initialJobTotal: number
  initialLoaded: boolean
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function resolveOrigin(requestHeaders: Headers): string {
  const forwardedHost = requestHeaders.get("x-forwarded-host")
  const host = forwardedHost ?? requestHeaders.get("host")
  const forwardedProto = requestHeaders.get("x-forwarded-proto")

  if (host) {
    const proto = forwardedProto ?? (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https")
    return `${proto}://${host}`
  }

  const envOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (envOrigin) return envOrigin.replace(/\/$/, "")

  return "http://localhost:3000"
}

async function getSearchInitialData(query: string): Promise<SearchInitialData> {
  const normalizedQuery = query.trim()

  if (!normalizedQuery) {
    return {
      initialQuery: query,
      initialJobs: [],
      initialCompanies: [],
      initialJobTotal: 0,
      initialLoaded: true,
    }
  }

  const fallback: SearchInitialData = {
    initialQuery: query,
    initialJobs: [],
    initialCompanies: [],
    initialJobTotal: 0,
    initialLoaded: false,
  }

  try {
    const requestHeaders = await headers()
    const origin = resolveOrigin(requestHeaders)

    const jobsParams = new URLSearchParams()
    jobsParams.set("q", normalizedQuery)
    jobsParams.set("limit", "20")
    jobsParams.set("offset", "0")

    const companiesParams = new URLSearchParams()
    companiesParams.set("q", normalizedQuery)
    companiesParams.set("limit", "10")
    companiesParams.set("sort", "job_count")

    const [jobsRes, companiesRes] = await Promise.all([
      fetch(`${origin}/api/jobs?${jobsParams.toString()}`, { cache: "no-store" }),
      fetch(`${origin}/api/companies?${companiesParams.toString()}`, { cache: "no-store" }),
    ])

    if (!jobsRes.ok || !companiesRes.ok) return fallback

    const jobsPayload = (await jobsRes.json()) as { jobs?: JobWithCompany[]; total?: number }
    const companiesPayload = (await companiesRes.json()) as { companies?: Company[] }

    return {
      initialQuery: query,
      initialJobs: Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [],
      initialCompanies: Array.isArray(companiesPayload.companies) ? companiesPayload.companies : [],
      initialJobTotal: Number.isFinite(jobsPayload.total) ? Number(jobsPayload.total) : 0,
      initialLoaded: true,
    }
  } catch {
    return fallback
  }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const query = firstValue(params.q) ?? ""
  const initialData = await getSearchInitialData(query)

  return <SearchPageClient {...initialData} />
}

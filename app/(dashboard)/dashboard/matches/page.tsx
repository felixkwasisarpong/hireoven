import { headers } from "next/headers"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import type { JobWithMatchScore } from "@/types"
import MatchesPageClient from "./MatchesPageClient"

export const dynamic = "force-dynamic"

const SYSTEM_ALERT_NAME = "System: strong matches"
const INITIAL_THRESHOLD = 70

type MatchFeedPayload = {
  jobs?: JobWithMatchScore[]
}

type ResumeGateRow = {
  id: string
}

type AlertStateRow = {
  is_active: boolean
}

type MatchesInitialData = {
  initialThreshold: number
  initialHasParsedResume: boolean
  initialJobs: JobWithMatchScore[]
  initialJobsLoaded: boolean
  initialNotifyEnabled: boolean
  initialNotifyLoaded: boolean
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

async function fetchHasParsedResume(userId: string): Promise<boolean> {
  const pool = getPostgresPool()
  const result = await pool.query<ResumeGateRow>(
    `SELECT id
     FROM resumes
     WHERE user_id = $1::uuid
       AND parse_status = 'complete'
     ORDER BY is_primary DESC, updated_at DESC
     LIMIT 1`,
    [userId],
  )
  return result.rows.length > 0
}

async function fetchInitialNotifyEnabled(userId: string): Promise<boolean> {
  const pool = getPostgresPool()
  const result = await pool.query<AlertStateRow>(
    `SELECT is_active
     FROM job_alerts
     WHERE user_id = $1::uuid
       AND name = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, SYSTEM_ALERT_NAME],
  )
  return Boolean(result.rows[0]?.is_active)
}

async function fetchInitialMatchJobs(requestHeaders: Headers): Promise<JobWithMatchScore[]> {
  const origin = resolveOrigin(requestHeaders)
  const cookieHeader = requestHeaders.get("cookie") ?? ""
  const params = new URLSearchParams({
    limit: "40",
    within: "24h",
    sort: "match",
    computeScores: "1",
    minScore: String(INITIAL_THRESHOLD),
  })

  const response = await fetch(`${origin}/api/match/feed?${params.toString()}`, {
    cache: "no-store",
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  })

  if (!response.ok) return []
  const payload = (await response.json()) as MatchFeedPayload
  return Array.isArray(payload.jobs) ? payload.jobs : []
}

async function getInitialData(): Promise<MatchesInitialData> {
  const fallback: MatchesInitialData = {
    initialThreshold: INITIAL_THRESHOLD,
    initialHasParsedResume: false,
    initialJobs: [],
    initialJobsLoaded: false,
    initialNotifyEnabled: false,
    initialNotifyLoaded: false,
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return fallback

    const requestHeaders = await headers()
    const hasParsedResume = await fetchHasParsedResume(user.id)

    const [jobsResult, notifyResult] = await Promise.allSettled([
      hasParsedResume ? fetchInitialMatchJobs(requestHeaders) : Promise.resolve([]),
      fetchInitialNotifyEnabled(user.id),
    ])

    return {
      initialThreshold: INITIAL_THRESHOLD,
      initialHasParsedResume: hasParsedResume,
      initialJobs: jobsResult.status === "fulfilled" ? jobsResult.value : [],
      initialJobsLoaded: jobsResult.status === "fulfilled",
      initialNotifyEnabled: notifyResult.status === "fulfilled" ? notifyResult.value : false,
      initialNotifyLoaded: notifyResult.status === "fulfilled",
    }
  } catch {
    return fallback
  }
}

export default async function MatchesPage() {
  const initialData = await getInitialData()
  return <MatchesPageClient {...initialData} />
}
